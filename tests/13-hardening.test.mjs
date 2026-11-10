// Hardening round 3: a lockout that cannot trap the real person, one-time password expiry, password
// re-confirmation for destructive actions, per-field limits for roles that only touch a module as part
// of their job, photos kept out of the data load, two-step sign-in, owner recovery and encrypted backups.
// Run with `npm run test:db` (it starts the servers and the test database these tests use).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  Client,
  DATABASE_URL,
  OWNER,
  PNG,
  STAFF_PASSWORD,
  THROTTLED_BASE,
  asOwner,
  createStaff,
  loadStores,
  log,
  one,
  pool,
  reauthToken,
  roleIds,
  rows,
  shopFixture,
  stores,
  today,
} from "./helpers.mjs";
import { counterAt, hotp } from "../lib/auth/totp.js";

const wrong = (username, password = "wrong-guess-1") => new Client().post("/api/auth/login", { username, password });
const lockOut = async (username) => {
  for (let i = 0; i < 5; i++) await wrong(username, `wrong-${i}`);
};
const user = (username) => one(`SELECT * FROM auth_users WHERE username = ?`, [username]);
const root = fileURLToPath(new URL("..", import.meta.url));
const script = (name, args, env = {}) =>
  spawnSync(process.execPath, [path.join(root, "scripts", name), ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL, ...env },
    encoding: "utf8",
  });

/* ===================================================================== lockout */
describe("a lockout that cannot trap the real person", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
  });

  test("LOCK-1 one wrong guess after a quiet quarter of an hour does not add up to a lock", async () => {
    await createStaff(owner, { username: "quiet", roles: ["sales"] });
    await pool.query(`UPDATE auth_users SET failed_login_count = 4, updated_at = NOW(6) - INTERVAL 20 MINUTE WHERE username = 'quiet'`);
    assert.equal((await wrong("quiet")).status, 401);
    const u = await user("quiet");
    log(`4 old failures + 1 new one -> failed_login_count=${u.failed_login_count}, locked_until=${u.locked_until}`);
    assert.equal(u.failed_login_count, 1, "the old failures were forgotten");
    assert.equal(u.locked_until, null);
    // ... while failures that are recent do add up
    await pool.query(`UPDATE auth_users SET failed_login_count = 4, updated_at = NOW(6) WHERE username = 'quiet'`);
    assert.equal((await wrong("quiet")).status, 401);
    assert.notEqual((await user("quiet")).locked_until, null, "5 recent failures lock it");
  });

  test("LOCK-2 a browser that has signed in before can still sign in while the account is locked; a stranger cannot", async () => {
    await createStaff(owner, { username: "kay", roles: ["sales"] });
    const mine = new Client();
    mine.keepDevice = true;
    await mine.login("kay", STAFF_PASSWORD);
    assert.ok(mine.device, "the sign-in left a known-browser cookie");
    await lockOut("kay");
    const stranger = await new Client().post("/api/auth/login", { username: "kay", password: STAFF_PASSWORD });
    const forged = await new Client().post("/api/auth/login", { username: "kay", password: STAFF_PASSWORD }, {
      cookie: `learnex_device=${(await user("kay")).id}.not-a-real-signature`,
    });
    const again = await mine.post("/api/auth/login", { username: "kay", password: STAFF_PASSWORD });
    log(`locked account: stranger with the right password -> ${stranger.status}; forged cookie -> ${forged.status}; known browser -> ${again.status}`);
    assert.equal(stranger.status, 429);
    assert.equal(forged.status, 429);
    assert.equal(again.status, 200);
    // a wrong password from the known browser is just a wrong password, and is counted
    const counted = (await user("kay")).failed_login_count;
    assert.equal((await mine.post("/api/auth/login", { username: "kay", password: "nope-nope-1" })).status, 401);
    assert.equal((await user("kay")).failed_login_count, counted + 1, "counted");
  });

  test("LOCK-3 a changed password makes the known-browser cookie worthless", async () => {
    const staff = await createStaff(owner, { username: "lee", roles: ["sales"] });
    const mine = new Client();
    mine.keepDevice = true;
    await mine.login("lee", STAFF_PASSWORD);
    const reset = await owner.post(`/api/user/${staff.userId}/password`);
    assert.equal(reset.status, 200);
    await lockOut("lee");
    const r = await mine.post("/api/auth/login", { username: "lee", password: reset.body.temporaryPassword });
    log(`after a password reset the old cookie no longer opens a locked account -> ${r.status}`);
    assert.equal(r.status, 429);
  });

  test("LOCK-4 many failures from a known browser stop at its own limit (25)", async () => {
    await createStaff(owner, { username: "mia", roles: ["sales"] });
    const mine = new Client();
    mine.keepDevice = true;
    await mine.login("mia", STAFF_PASSWORD);
    await lockOut("mia");
    await pool.query(`UPDATE auth_users SET failed_login_count = 25 WHERE username = 'mia'`);
    const r = await mine.post("/api/auth/login", { username: "mia", password: STAFF_PASSWORD });
    assert.equal(r.status, 429, "at 25 failures even the known browser waits");
  });
});

/* ================================================== one-time passwords, clean-up */
describe("one-time passwords expire; sessions and failed sign-ins do not pile up", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
  });

  test("TEMP-1 a one-time password stops working after 72 hours, and the user list says so", async () => {
    const made = await owner.post("/api/user", { username: "slow", name: "Slow", roleIds: [(await roleIds()).sales] });
    assert.equal(made.status, 200);
    await pool.query(`UPDATE auth_users SET password_changed_at = NOW(6) - INTERVAL 4 DAY WHERE username = 'slow'`);
    const listed = (await owner.get("/api/user")).body.users.find((u) => u.username === "slow");
    const late = await new Client().post("/api/auth/login", { username: "slow", password: made.body.temporaryPassword });
    log(`4 days old -> ${late.status} ${late.body.code}; listed as expired: ${listed.oneTimePasswordExpired}`);
    assert.equal(late.status, 403);
    assert.equal(late.body.code, "temp_password_expired");
    assert.equal(listed.oneTimePasswordExpired, true);
    await pool.query(`UPDATE auth_users SET password_changed_at = NOW(6) - INTERVAL 1 DAY WHERE username = 'slow'`);
    assert.equal((await new Client().post("/api/auth/login", { username: "slow", password: made.body.temporaryPassword })).status, 200);
    // an administrator can issue a fresh one
    assert.equal((await owner.post(`/api/user/${made.body.id}/password`)).status, 200);
  });

  test("SESS-1 signing in clears out sessions that ended without a sign-out (and keeps live ones)", async () => {
    const id = Number((await user(OWNER.username)).id);
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, expires_at, absolute_expires_at) VALUES
        ('expired-session-test', ?, NOW(6) - INTERVAL 1 DAY, NOW(6) + INTERVAL 1 DAY),
        ('too-old-session-test', ?, NOW(6) + INTERVAL 1 DAY, NOW(6) - INTERVAL 1 HOUR),
        ('live-session-test', ?, NOW(6) + INTERVAL 1 DAY, NOW(6) + INTERVAL 2 DAY)`,
      [id, id, id],
    );
    // the third server clears on every sign-in (AUTH_PRUNE_MINUTES=0); its own address, so its sign-in limit is not shared
    const c = new Client(THROTTLED_BASE);
    const r = await c.post("/api/auth/login", { username: OWNER.username, password: OWNER.password }, { "x-forwarded-for": "198.51.100.90" });
    assert.equal(r.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const left = (await rows(`SELECT id FROM auth_sessions WHERE id LIKE '%-session-test'`)).map((x) => x.id);
    log(`left after the clean-up: ${left.join(", ")}`);
    assert.deepEqual(left, ["live-session-test"]);
  });

  test("FLOOD-1 a flood of sign-ins for names that do not exist writes only a few log entries", async () => {
    const tag = `flood${Date.now()}-`;
    await Promise.all(Array.from({ length: 50 }, (_, i) => wrong(`${tag}${i}`)));
    const written = (await one(`SELECT count(*) AS n FROM audit_log WHERE action = 'auth.login_failed' AND target LIKE ?`, [`${tag}%`])).n;
    log(`50 failed sign-ins for unknown names -> ${written} log entries`);
    assert.ok(Number(written) <= 30, `${written} entries`);
  });
});

/* ========================================================= password re-confirmation */
describe("restore, clear and reset need the password typed again", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
    await loadStores(shopFixture());
  });
  const productCount = async () => (await stores()).products.length;

  test("RE-1 the factory reset without a fresh confirmation is refused and deletes nothing", async () => {
    const r = await owner.post("/api/learnex/reset", {});
    log(`reset without proof -> ${r.status} ${r.body.code}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "reauth_required");
    assert.equal(await productCount(), 3);
  });

  test("RE-2 a wrong password gets no proof; a forged or foreign proof is useless", async () => {
    assert.equal((await owner.post("/api/auth/reauth", { password: "not-my-password" })).status, 403);
    const other = await new Client().login(OWNER.username, OWNER.password); // a second sign-in = another session
    const foreign = await reauthToken(other, OWNER.password, true);
    assert.ok(foreign);
    const forged = `${Date.now() + 60_000}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    for (const token of [foreign, forged, "garbage"]) {
      const r = await owner.post("/api/learnex/reset", {}, { "x-reauth": token });
      assert.equal(r.status, 403, `token ${token.slice(0, 12)}…`);
    }
    assert.equal(await productCount(), 3);
  });

  test("RE-3 replacing a module that holds data, or deleting all of its records at once, needs the proof even for the owner", async () => {
    const products = (await stores()).products;
    const replace = { changes: [{ store: "products", replace: true, upserts: products, order: products.map((p) => p.id) }] };
    const bare = await owner.post("/api/learnex/sync", replace);
    assert.equal(bare.status, 403);
    assert.equal(bare.body.code, "reauth_required");
    const token = await reauthToken(owner, OWNER.password, true);
    const proved = await owner.post("/api/learnex/sync", replace, { "x-reauth": token });
    assert.equal(proved.status, 200, JSON.stringify(proved.body));

    // 12 customers, then all of them deleted in one request
    const customers = Array.from({ length: 12 }, (_, i) => ({ id: 5000 + i, name: `Bulk ${i}`, orders: 0, spent: 0, outstanding: 0 }));
    const add = await owner.post("/api/learnex/sync", { changes: [{ store: "customers", replace: true, upserts: customers, order: customers.map((c) => c.id) }] }, { "x-reauth": token });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const wipe = { changes: [{ store: "customers", deletes: customers.map((c) => c.id), upserts: [], order: [] }] };
    const refused = await owner.post("/api/learnex/sync", wipe);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "reauth_required");
    assert.equal((await stores()).customers.length, 12, "nothing was deleted");
    assert.equal((await owner.post("/api/learnex/sync", wipe, { "x-reauth": token })).status, 200);
    assert.equal((await stores()).customers.length, 0);
  });

  test("RE-4 a first save of a module nobody has saved yet still needs no proof (the app starts that way)", async () => {
    await loadStores({ ...shopFixture(), suppliers: undefined });
    await pool.query(`DELETE FROM store_state WHERE store = 'suppliers'`);
    const first = await owner.post("/api/learnex/sync", {
      changes: [{ store: "suppliers", replace: true, upserts: [{ id: 301, name: "S", purchased: 0 }], order: [301] }],
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
  });

  test("RE-5 the reset works with a fresh proof, and is logged", async () => {
    const token = await reauthToken(owner, OWNER.password, true);
    const r = await owner.post("/api/learnex/reset", {}, { "x-reauth": token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await one(`SELECT count(*) AS n FROM products`)).n, 0);
    assert.equal((await one(`SELECT count(*) AS n FROM audit_log WHERE action = 'data.reset'`)).n >= 1, true);
    assert.equal((await one(`SELECT count(*) AS n FROM audit_log WHERE action = 'auth.reauth_failed'`)).n >= 1, true);
  });
});

/* ================================================== who may change what in a module */
describe("roles that only touch a module as part of their job", () => {
  let owner;
  let till;
  const upsert = (c, store, records, extra = {}, order) =>
    c.post("/api/learnex/sync", { changes: [{ store, upserts: records, order: order ?? records.map((r) => r.id), ...extra }] });
  before(async () => {
    owner = await asOwner();
    await loadStores(shopFixture());
    till = await createStaff(owner, { username: "till", roles: ["sales"] });
  });

  test("LIM-1 a sale may lower stock, but not change a price, a cost or a name", async () => {
    const [alpha, ...rest] = (await stores()).products;
    const order = [alpha, ...rest].map((p) => p.id);
    const ok = await upsert(till, "products", [{ ...alpha, stock: alpha.stock - 1 }], {}, order);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    for (const change of [{ price: 1 }, { cost: 0 }, { name: "Free printer" }, { min: 0 }]) {
      const r = await upsert(till, "products", [{ ...alpha, stock: alpha.stock - 1, ...change }], {}, order);
      assert.equal(r.status, 403, JSON.stringify(change));
      assert.equal(r.body.code, "limited_write");
    }
    const after = (await stores()).products.find((p) => p.id === alpha.id);
    log(`stock ${alpha.stock} -> ${after.stock}; price still ${after.price}`);
    assert.equal(after.stock, alpha.stock - 1);
    assert.equal(after.price, alpha.price);
  });

  test("LIM-2 a sale may not add or delete products", async () => {
    const products = (await stores()).products;
    const add = await upsert(till, "products", [{ id: 999, name: "New", price: 1, cost: 1, stock: 1, min: 0, unit: "pc", sku: "N" }], {}, [...products.map((p) => p.id), 999]);
    assert.equal(add.status, 403);
    const del = await till.post("/api/learnex/sync", { changes: [{ store: "products", deletes: [103], upserts: [], order: products.filter((p) => p.id !== 103).map((p) => p.id) }] });
    assert.equal(del.status, 403);
    assert.equal((await stores()).products.length, 3);
  });

  test("LIM-3 customers: a cashier (POS only) may change the totals, not who the customer is", async () => {
    const made = await owner.post("/api/roles", { name: "Cashier only", description: "", permissions: ["pos.use"] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const key = (await one("SELECT `key` FROM auth_roles WHERE id = ?", [made.body.id])).key;
    const cashier = await createStaff(owner, { username: "cashier", roles: [key] });
    const [acme] = (await stores()).customers;
    assert.equal((await upsert(cashier, "customers", [{ ...acme, orders: acme.orders + 1, spent: acme.spent + 500 }])).status, 200);
    const r = await upsert(cashier, "customers", [{ ...acme, name: "Someone else", orders: 5 }]);
    assert.equal(r.status, 403);
    assert.equal((await stores()).customers[0].name, acme.name);
    // a sales person manages customers, so may change anything about them
    assert.equal((await upsert(till, "customers", [{ ...acme, name: "Renamed by sales" }])).status, 200);
  });

  test("LIM-4 the ledger: lines may be added and removed, a date moved, but an amount cannot be edited", async () => {
    const line = (id, amount) => ({ id, date: today(), desc: "POS sale", type: "Income", category: "Sales", amount, account: null, kind: "revenue", attachment: null });
    assert.equal((await upsert(till, "ledger", [line("TXN-9001", 100)])).status, 200, "a new line");
    const edit = await upsert(till, "ledger", [line("TXN-9001", 1)], {}, ["TXN-9001"]);
    assert.equal(edit.status, 403);
    assert.equal(edit.body.code, "limited_write");
    assert.equal(Number((await one(`SELECT amount FROM ledger_entries WHERE id = 'TXN-9001'`)).amount), 100);
    assert.equal((await upsert(till, "ledger", [{ ...line("TXN-9001", 100), date: today() }])).status, 200, "same figures, same date is fine");
    const gone = await till.post("/api/learnex/sync", { changes: [{ store: "ledger", deletes: ["TXN-9001"], upserts: [], order: [] }] });
    assert.equal(gone.status, 200, "taking a line back (cancelling an order) is allowed");
  });

  test("LIM-5 whoever manages the module can change everything in it (inventory manager: prices; accountant: ledger)", async () => {
    const stock = await createStaff(owner, { username: "stocker", roles: ["inventory"] });
    const [alpha, ...rest] = (await stores()).products;
    assert.equal((await upsert(stock, "products", [{ ...alpha, price: 1234 }], {}, [alpha, ...rest].map((p) => p.id))).status, 200);
    const books = await createStaff(owner, { username: "books", roles: ["accountant"] });
    const ledgerLine = { id: "TXN-9100", date: today(), desc: "Rent", type: "Expense", category: "Rent", amount: 10, account: null, kind: "expense" };
    assert.equal((await upsert(books, "ledger", [ledgerLine])).status, 200);
    assert.equal((await upsert(books, "ledger", [{ ...ledgerLine, amount: 20 }])).status, 200, "the books may edit a line");
  });
});

/* ============================================================== attachments */
describe("photos are not sent with the records", () => {
  let owner;
  const dataUrl = `data:image/png;base64,${PNG.buffer.toString("base64")}`;
  const ledgerLine = (id, attachment) => ({ id, date: today(), desc: "Bill", type: "Expense", category: "Office", amount: 10, account: null, kind: "expense", attachment });
  before(async () => {
    owner = await asOwner();
    await loadStores({ ...shopFixture(), ledger: [ledgerLine("TXN-A1", { name: "bill.png", type: "image/png", dataUrl }), ledgerLine("TXN-A2", null)] });
  });

  test("ATT-1 /data carries a small stand-in, never the file", async () => {
    const r = await owner.get("/api/learnex/data");
    const a = r.body.stores.ledger.find((t) => t.id === "TXN-A1").attachment;
    log(`stand-in: ${JSON.stringify(a)}`);
    assert.deepEqual(a, { name: "bill.png", type: "image/png", size: a.size, stored: true });
    assert.ok(a.size > 100);
    assert.equal(JSON.stringify(r.body).includes("base64"), false);
    assert.equal(r.body.stores.ledger.find((t) => t.id === "TXN-A2").attachment, undefined);
  });

  test("ATT-2 the file is downloaded on demand, byte for byte, as an attachment", async () => {
    const res = await fetch(`${BASE}/api/learnex/attachment?store=ledger&id=TXN-A1`, { headers: { cookie: owner.cookie } });
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("content-disposition"), /^attachment; filename="bill\.png"$/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(bytes.equals(PNG.buffer));
    const none = await owner.get("/api/learnex/attachment?store=ledger&id=TXN-A2");
    assert.equal(none.status, 404);
    assert.equal((await owner.get("/api/learnex/attachment?store=ledger")).status, 400);
    assert.equal((await owner.get("/api/learnex/attachment?store=users&id=1")).status, 404);
  });

  test("ATT-3 only people who may see that module can download its files", async () => {
    assert.equal((await new Client().get("/api/learnex/attachment?store=ledger&id=TXN-A1")).status, 401);
    const made = await owner.post("/api/roles", { name: "Customers only", description: "", permissions: ["customers.manage"] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const r = await owner.post("/api/user", { username: "nosy", name: "Nosy", roleIds: [made.body.id] });
    const nosy = await new Client().login("nosy", r.body.temporaryPassword);
    await nosy.post("/api/auth/password", { currentPassword: r.body.temporaryPassword, newPassword: STAFF_PASSWORD });
    const denied = await nosy.get("/api/learnex/attachment?store=ledger&id=TXN-A1");
    assert.equal(denied.status, 403);
  });

  test("ATT-4 saving a record that holds only the stand-in keeps the stored file", async () => {
    const loaded = (await owner.get("/api/learnex/data")).body.stores.ledger;
    const a1 = loaded.find((t) => t.id === "TXN-A1");
    const r = await owner.post("/api/learnex/sync", {
      changes: [{ store: "ledger", upserts: [{ ...a1, desc: "Bill (edited)" }], order: loaded.map((t) => t.id) }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = await one(`SELECT description, attachment FROM ledger_entries WHERE id = 'TXN-A1'`);
    assert.equal(row.description, "Bill (edited)");
    const stored = JSON.parse(row.attachment);
    assert.equal(stored.dataUrl, dataUrl, "the file is still there");
    assert.equal(stored.stored, undefined, "the stand-in was never written as a file");
  });

  test("ATT-5 a stand-in on a record that has no file becomes 'no attachment' (it is never stored as a file)", async () => {
    const loaded = (await owner.get("/api/learnex/data")).body.stores.ledger;
    const fake = { name: "x.png", type: "image/png", size: 5, stored: true };
    const r = await owner.post("/api/learnex/sync", {
      changes: [{ store: "ledger", upserts: [ledgerLine("TXN-A3", fake)], order: [...loaded.map((t) => t.id), "TXN-A3"] }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number((await one(`SELECT attachment IS NULL AS none FROM ledger_entries WHERE id = 'TXN-A3'`)).none), 1);
  });

  test("ATT-6 a file over 2.5 MB is refused for roles that cannot restore a backup", async () => {
    const till = await createStaff(owner, { username: "photo", roles: ["accountant"] });
    const big = `data:image/png;base64,${"A".repeat(3_800_000)}`;
    const r = await till.post("/api/learnex/sync", {
      changes: [{ store: "ledger", upserts: [ledgerLine("TXN-A9", { name: "big.png", type: "image/png", dataUrl: big })], order: ["TXN-A9"] }],
    });
    log(`3.8 MB of base64 -> ${r.status} ${r.body.error}`);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /2\.5 MB/);
  });
});

/* ============================================================ two-step sign-in */
describe("two-step sign-in", () => {
  let owner;
  let secret;
  let first; // the counter the enabling code used
  let recovery;
  let emma;
  before(async () => {
    owner = await asOwner();
    emma = await createStaff(owner, { username: "emma", roles: ["sales"] });
  });
  const code = (offset = 0) => hotp(secret, counterAt() + offset);

  test("MFA-1 it is available on this server and off by default", async () => {
    const r = await emma.get("/api/auth/mfa");
    assert.deepEqual(r.body, { available: true, enabled: false, recoveryCodesLeft: 0 });
  });

  test("MFA-2 setting it up needs the password; the first code from the app switches it on and shows 8 recovery codes once", async () => {
    assert.equal((await emma.post("/api/auth/mfa/setup", { password: "not-it" })).status, 403);
    const setup = await emma.post("/api/auth/mfa/setup", { password: STAFF_PASSWORD });
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    secret = setup.body.secret;
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.body.uri, /^otpauth:\/\/totp\/LEARNEX%20ERP%3Aemma\?secret=/);
    assert.equal((await emma.post("/api/auth/mfa/enable", { code: "000000" })).status, 400, "a wrong code does not switch it on");
    first = counterAt();
    const enabled = await emma.post("/api/auth/mfa/enable", { code: hotp(secret, first) });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    recovery = enabled.body.recoveryCodes;
    assert.equal(recovery.length, 8);
    assert.ok(recovery.every((c) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)));
    // the secret is stored encrypted, not as typed into the app
    const stored = (await one(`SELECT value FROM app_meta WHERE \`key\` = ?`, [`mfa:${emma.userId}`])).value;
    assert.equal(stored.includes(secret), false);
    assert.equal(stored.includes(recovery[0]), false, "recovery codes are stored hashed");
  });

  test("MFA-3 after the password, sign-in is not complete until the code is given", async () => {
    const c = new Client();
    const step1 = await c.post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD });
    assert.equal(step1.status, 200);
    assert.equal(step1.body.mfaRequired, true);
    assert.ok(step1.body.ticket);
    assert.equal((await c.get("/api/auth/me")).body.user, null, "no session yet");
    assert.equal((await c.post("/api/auth/mfa/verify", { ticket: step1.body.ticket, code: "123456" })).status, 401);
    assert.equal((await c.post("/api/auth/mfa/verify", { ticket: "1.2.forged", code: code(1) })).status, 401);
    const ok = await c.post("/api/auth/mfa/verify", { ticket: step1.body.ticket, code: hotp(secret, first + 1) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await c.get("/api/auth/me")).body.user.username, "emma");
    // the same code a second time is refused
    const again = new Client();
    const t2 = (await again.post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD })).body.ticket;
    const replay = await again.post("/api/auth/mfa/verify", { ticket: t2, code: hotp(secret, first + 1) });
    assert.equal(replay.status, 401, "a code works once");
  });

  test("MFA-4 a recovery code signs in once, then is used up", async () => {
    const c = new Client();
    const t = (await c.post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD })).body.ticket;
    assert.equal((await c.post("/api/auth/mfa/verify", { ticket: t, code: recovery[0] })).status, 200);
    const c2 = new Client();
    const t2 = (await c2.post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD })).body.ticket;
    assert.equal((await c2.post("/api/auth/mfa/verify", { ticket: t2, code: recovery[0] })).status, 401, "used up");
    assert.equal((await emma.get("/api/auth/mfa")).body.recoveryCodesLeft, 7);
  });

  test("MFA-5 destructive actions ask for the code as well", async () => {
    const noCode = await emma.post("/api/auth/reauth", { password: STAFF_PASSWORD });
    assert.equal(noCode.status, 403);
    assert.equal(noCode.body.code, "mfa_wrong_code");
    const ok = await emma.post("/api/auth/reauth", { password: STAFF_PASSWORD, code: recovery[1] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test("MFA-6 five wrong codes pause two-step sign-in for 15 minutes, even for the right code", async () => {
    const c = new Client();
    const t = (await c.post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD })).body.ticket;
    for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/auth/mfa/verify", { ticket: t, code: "111111" })).status, 401);
    const locked = await c.post("/api/auth/mfa/verify", { ticket: t, code: recovery[2] });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, "mfa_locked");
  });

  test("MFA-7 an administrator can switch it off for someone who lost the phone; they can then sign in with the password", async () => {
    const reset = await owner.delete(`/api/user/${emma.userId}/mfa`);
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const list = (await owner.get("/api/user")).body.users.find((u) => u.username === "emma");
    assert.equal(list.mfaEnabled, false);
    const plain = await new Client().post("/api/auth/login", { username: "emma", password: STAFF_PASSWORD });
    assert.equal(plain.status, 200);
    assert.equal(plain.body?.mfaRequired, undefined);
    assert.equal((await one(`SELECT count(*) AS n FROM audit_log WHERE action = 'user.mfa_reset'`)).n, 1);
  });

  test("MFA-8 switching it off needs the password and a code", async () => {
    const dana = await createStaff(owner, { username: "dana", roles: ["sales"] });
    const setup = await dana.post("/api/auth/mfa/setup", { password: STAFF_PASSWORD });
    const s = setup.body.secret;
    assert.equal((await dana.post("/api/auth/mfa/enable", { code: hotp(s, counterAt()) })).status, 200);
    assert.equal((await dana.post("/api/auth/mfa/disable", { password: "wrong-wrong-1", code: hotp(s, counterAt() + 1) })).status, 403);
    assert.equal((await dana.post("/api/auth/mfa/disable", { password: STAFF_PASSWORD, code: "000000" })).status, 403);
    assert.equal((await dana.post("/api/auth/mfa/disable", { password: STAFF_PASSWORD, code: hotp(s, counterAt() + 1) })).status, 200);
    assert.equal((await dana.get("/api/auth/mfa")).body.enabled, false);
  });
});

/* ============================================ owner recovery and encrypted backups */
describe("scripts", () => {
  let owner;
  let dir;
  before(async () => {
    owner = await asOwner();
    dir = mkdtempSync(path.join(os.tmpdir(), "learnex-backup-test-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("REC-1 owner:recover shows what it would do and changes nothing without --yes", async () => {
    await createStaff(owner, { username: "stranded", roles: ["sales"] });
    await lockOut("stranded");
    const before = await user("stranded");
    const r = script("owner-recover.mjs", ["stranded"]);
    log(r.stdout.trim().split("\n").join(" | "));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nothing was changed/);
    const after = await user("stranded");
    assert.equal(after.password_hash, before.password_hash);
    assert.notEqual(after.locked_until, null);
  });

  test("REC-2 with --yes it unlocks the account, ends its sessions and prints a one-time password that works once", async () => {
    const staff = await new Client().login("stranded", STAFF_PASSWORD).catch(() => null); // locked: cannot
    assert.equal(staff, null);
    const r = script("owner-recover.mjs", ["stranded", "--yes"]);
    assert.equal(r.status, 0, r.stderr);
    const temp = /\n\s{4}(\S+)\n/.exec(r.stdout)?.[1];
    assert.match(temp, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    const u = await user("stranded");
    assert.equal(u.locked_until, null);
    assert.equal(u.failed_login_count, 0);
    assert.equal(!!u.must_change_password, true);
    const c = await new Client().post("/api/auth/login", { username: "stranded", password: temp });
    assert.equal(c.status, 200);
    const me = await new Client().get("/api/auth/me");
    assert.equal(me.body.user, null);
    assert.equal((await one(`SELECT count(*) AS n FROM audit_log WHERE action = 'user.password_reset' AND details LIKE '%owner-recover%'`)).n, 1);
  });

  test("REC-3 it can enable a disabled account and remove two-step; an unknown name is an error", async () => {
    const staff = await createStaff(owner, { username: "gone", roles: ["sales"] });
    await owner.patch(`/api/user/${staff.userId}`, { status: "disabled" });
    const r = script("owner-recover.mjs", ["gone", "--yes", "--enable", "--reset-mfa"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal((await user("gone")).status, "active");
    const missing = script("owner-recover.mjs", ["nobody-by-that-name", "--yes"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No account has the username/);
  });

  test("BAK-1 a backup is encrypted, verifies with the passphrase, and is refused with a wrong one or when damaged", async () => {
    const env = { BACKUP_PASSPHRASE: "correct horse battery staple" };
    const file = path.join(dir, "test.json.enc");
    const made = script("db-backup.mjs", ["backup", file], env);
    assert.equal(made.status, 0, made.stderr + made.stdout);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(0, 5).toString(), "LXBK1");
    assert.equal(bytes.includes(Buffer.from(OWNER.email)), false, "no readable e-mail address in the file");
    assert.equal(bytes.includes(Buffer.from("scrypt$")), false, "no readable password hash in the file");
    const ok = script("db-backup.mjs", ["verify", file], env);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Verified: every table matches/);
    const bad = script("db-backup.mjs", ["verify", file], { BACKUP_PASSPHRASE: "some other passphrase" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Could not decrypt/);
    const cut = path.join(dir, "cut.json.enc");
    writeFileSync(cut, bytes.subarray(0, bytes.length - 40));
    assert.equal(script("db-backup.mjs", ["verify", cut], env).status, 1);
    const flipped = Buffer.from(bytes);
    flipped[100] ^= 1;
    const tampered = path.join(dir, "flipped.json.enc");
    writeFileSync(tampered, flipped);
    assert.equal(script("db-backup.mjs", ["verify", tampered], env).status, 1);
  });

  test("BAK-2 without a passphrase a backup is not written unless --plain is asked for", async () => {
    const refused = script("db-backup.mjs", ["backup", path.join(dir, "none.json.enc")], { BACKUP_PASSPHRASE: "" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /BACKUP_PASSPHRASE/);
    const plainFile = path.join(dir, "plain.json");
    const plain = script("db-backup.mjs", ["backup", plainFile, "--plain"], { BACKUP_PASSPHRASE: "" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /NOT encrypted/);
    assert.equal(JSON.parse(readFileSync(plainFile, "utf8")).format, "learnex-db-backup/1");
  });
});
