import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BASE,
  Client,
  OWNER,
  SETUP_CODE,
  STAFF_PASSWORD,
  asOwner,
  backupData,
  createStaff,
  launchBrowser,
  log,
  nav,
  newPage,
  one,
  pool,
  resetAuth,
  roleIds,
  rows,
  takeConsoleProblems,
  waitSaved,
  wipeDatabase,
} from "./helpers.mjs";

after(() => pool.end());

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const PROTECTED = [
  ["GET", "/api/learnex/data"],
  ["POST", "/api/learnex/sync"],
  ["POST", "/api/learnex/import"],
  ["POST", "/api/learnex/reset"],
  ["GET", "/api/user"],
  ["POST", "/api/user"],
  ["PATCH", "/api/user/1"],
  ["PUT", "/api/user/1/role"],
  ["POST", "/api/user/1/password"],
  ["DELETE", "/api/user/1/sessions"],
  ["GET", "/api/roles"],
  ["POST", "/api/roles"],
  ["PATCH", "/api/roles/1"],
  ["DELETE", "/api/roles/1"],
  ["GET", "/api/audit"],
  ["POST", "/api/auth/password"],
];

describe("first run: creating the owner account", () => {
  before(resetAuth);

  test("AUTH-1 a brand-new install asks for the owner account", async () => {
    const r = await new Client().get("/api/auth/me");
    log("GET /api/auth/me ->", JSON.stringify(r.body));
    assert.deepEqual(r.body, { user: null, setupRequired: true, setupAvailable: true });
  });

  test("AUTH-2 every protected endpoint refuses requests without a session (401)", async () => {
    const anon = new Client();
    const results = [];
    for (const [method, path] of PROTECTED) {
      const r = await anon.call(method, path, method === "GET" || method === "DELETE" ? undefined : {});
      results.push(`${method} ${path} -> ${r.status}`);
      assert.equal(r.status, 401, `${method} ${path}`);
    }
    log(`${results.length} endpoints:`, results.join(" | "));
  });

  test("AUTH-3 the owner can't be created with a wrong setup code or a weak password", async () => {
    const anon = new Client();
    const wrong = await anon.post("/api/auth/register", { ...OWNER, setupCode: "guess" });
    const weak = await anon.post("/api/auth/register", {
      ...OWNER,
      setupCode: SETUP_CODE,
      password: "short",
    });
    const same = await anon.post("/api/auth/register", {
      ...OWNER,
      setupCode: SETUP_CODE,
      username: "shopkeeper1",
      password: "ShopKeeper1",
    });
    log(`wrong code -> ${wrong.status} "${wrong.body.error}"`);
    log(`weak password -> ${weak.status} "${weak.body.error}"`);
    log(`password = username -> ${same.status} "${same.body.error}"`);
    assert.equal(wrong.status, 403);
    assert.equal(weak.status, 400);
    assert.equal(same.status, 400);
    assert.match(same.body.error, /same as the username/);
    assert.equal((await one(`SELECT count(*) AS n FROM auth_users`)).n, 0);
  });

  test("AUTH-4 the right setup code creates the owner, the default roles, and signs in with a safe cookie", async () => {
    const owner = new Client();
    const r = await owner.post("/api/auth/register", { ...OWNER, setupCode: SETUP_CODE });
    const cookie = r.setCookie.find((c) => c.includes("learnex_session"));
    const me = await owner.get("/api/auth/me");
    const roles = await rows("SELECT `key`, name, is_system FROM auth_roles ORDER BY id");
    log("Set-Cookie:", cookie.replace(/=[^;]+/, "=<token>"));
    log(
      "signed in as:",
      me.body.user.name,
      "| roles:",
      me.body.user.roles.map((x) => x.name).join(", "),
      "| permissions:",
      me.body.user.permissions.length,
    );
    log("default roles:", roles.map((x) => x.name + (x.is_system ? " (system)" : "")).join(", "));
    assert.equal(r.status, 200);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/i, "plain-HTTP server: a Secure cookie would never be sent back");
    const expires = new Date(cookie.match(/Expires=([^;]+)/i)[1]).getTime();
    assert.ok(Math.abs(expires - (Date.now() + 7 * 864e5)) < 60_000, "cookie lasts the 7-day absolute limit");
    assert.equal(me.body.user.isOwner, true);
    assert.deepEqual(
      roles.map((x) => x.key),
      ["owner", "administrator", "sales", "inventory", "accountant"],
    );
  });

  test("AUTH-5 registration closes once the owner exists", async () => {
    const r = await new Client().post("/api/auth/register", {
      setupCode: SETUP_CODE,
      name: "Intruder",
      username: "intruder",
      password: "Intruder-123",
    });
    log(`second registration -> ${r.status} "${r.body.error}"`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "setup_done");
  });

  test("AUTH-6 passwords are stored as scrypt hashes and session tokens only as SHA-256", async () => {
    const owner = await new Client().login(OWNER.username, OWNER.password);
    const token = owner.cookie.split("=")[1];
    const u = await one(`SELECT password_hash FROM auth_users WHERE username = ?`, [OWNER.username]);
    const s = await rows(`SELECT id FROM auth_sessions`);
    log("stored password:", u.password_hash.split("$").slice(0, 4).join("$") + "$<salt>$<hash>");
    log(
      `session ids in DB: ${s.length}; cookie token itself stored: ${s.some((x) => x.id === token)}; its SHA-256 stored: ${s.some((x) => x.id === sha256(token))}`,
    );
    assert.match(u.password_hash, /^scrypt\$65536\$8\$2\$/);
    assert.ok(!u.password_hash.includes(OWNER.password));
    assert.ok(!s.some((x) => x.id === token));
    assert.ok(s.some((x) => x.id === sha256(token)));
  });

  test("AUTH-40 two first-run registrations at the same moment create only one owner", async () => {
    await resetAuth();
    const [a, b] = await Promise.all([
      new Client().post("/api/auth/register", { ...OWNER, setupCode: SETUP_CODE }),
      new Client().post("/api/auth/register", {
        ...OWNER,
        username: "owner2",
        email: "owner2@learnex.test",
        setupCode: SETUP_CODE,
      }),
    ]);
    const accounts = await rows(`SELECT username FROM auth_users`);
    log(
      `registrations -> ${a.status} / ${b.status}; accounts created: ${accounts.map((u) => u.username).join(", ")}`,
    );
    assert.deepEqual([a.status, b.status].sort(), [200, 403]);
    assert.equal(accounts.length, 1);
  });
});

describe("signing in", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
    await createStaff(owner, { username: "lockme", roles: ["sales"] });
  });

  test("AUTH-7 a wrong password and an unknown username get the same answer", async () => {
    const wrong = await new Client().post("/api/auth/login", {
      username: OWNER.username,
      password: "nope-nope-1",
    });
    const unknown = await new Client().post("/api/auth/login", {
      username: "nobody",
      password: "nope-nope-1",
    });
    log(
      `wrong password -> ${wrong.status} "${wrong.body.error}" | unknown user -> ${unknown.status} "${unknown.body.error}"`,
    );
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test("AUTH-8 sign-in works with the email address too, case-insensitively", async () => {
    const r = await new Client().post("/api/auth/login", {
      username: OWNER.email.toUpperCase(),
      password: OWNER.password,
    });
    log(`login as ${OWNER.email.toUpperCase()} -> ${r.status}`);
    assert.equal(r.status, 200);
  });

  test("AUTH-9 five wrong passwords lock the account — even the right password is refused while locked", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++)
      statuses.push(
        (await new Client().post("/api/auth/login", { username: "lockme", password: "wrong-" + i })).status,
      );
    const right = await new Client().post("/api/auth/login", {
      username: "lockme",
      password: STAFF_PASSWORD,
    });
    const u = await one(
      `SELECT failed_login_count, locked_until > NOW(6) AS locked FROM auth_users WHERE username = 'lockme'`,
    );
    log(
      `5 wrong attempts -> ${statuses.join(", ")}; then correct password -> ${right.status} "${right.body.error}"`,
    );
    log(`DB: failed_login_count=${u.failed_login_count}, locked=${u.locked}`);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
    assert.equal(right.status, 429);
    assert.equal(u.locked, 1);
  });

  test("AUTH-10 an administrator's password reset unlocks the account and issues a one-time password", async () => {
    const id = (await one(`SELECT id FROM auth_users WHERE username = 'lockme'`)).id;
    const r = await owner.post(`/api/user/${id}/password`);
    const login = await new Client().post("/api/auth/login", {
      username: "lockme",
      password: r.body.temporaryPassword,
    });
    const u = await one(`SELECT must_change_password, locked_until FROM auth_users WHERE id = ?`, [id]);
    log(
      `reset -> ${r.status}, one-time password format: ${r.body.temporaryPassword.replace(/[A-Za-z0-9]/g, "x")}; sign-in with it -> ${login.status}; must change: ${u.must_change_password}`,
    );
    assert.match(r.body.temporaryPassword, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    assert.equal(login.status, 200);
    assert.equal(u.must_change_password, true);
    assert.equal(u.locked_until, null);
  });

  test("AUTH-11 signing out ends the session on the server (the old cookie stops working)", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    const saved = c.cookie;
    await c.post("/api/auth/logout");
    const reuse = new Client();
    reuse.cookie = saved;
    const r = await reuse.get("/api/learnex/data");
    log(`after sign-out, the old cookie -> ${r.status}`);
    assert.equal(r.status, 401);
  });

  test("AUTH-12 an idle session expires (12h) and is deleted", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    const id = sha256(c.cookie.split("=")[1]);
    await pool.query(`UPDATE auth_sessions SET expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?`, [id]);
    const r = await c.get("/api/learnex/data");
    const left = await one(`SELECT count(*) AS n FROM auth_sessions WHERE id = ?`, [id]);
    log(`idle-expired session -> ${r.status}; row left in DB: ${left.n}`);
    assert.equal(r.status, 401);
    assert.equal(left.n, 0);
  });

  test("AUTH-13 the 7-day absolute limit is enforced even while the session is in use", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    const id = sha256(c.cookie.split("=")[1]);
    await pool.query(
      `UPDATE auth_sessions SET absolute_expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?`,
      [id],
    );
    const r = await c.get("/api/learnex/data");
    log(`session past its absolute limit -> ${r.status}`);
    assert.equal(r.status, 401);
  });

  test("AUTH-14 using a session slides its idle expiry forward (but never past the absolute limit)", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    const id = sha256(c.cookie.split("=")[1]);
    await pool.query(
      `UPDATE auth_sessions SET last_seen_at = NOW(6) - INTERVAL 2 HOUR, expires_at = NOW(6) + INTERVAL 10 HOUR WHERE id = ?`,
      [id],
    );
    await c.get("/api/auth/me");
    const s = await one(
      `SELECT TIMESTAMPDIFF(MICROSECOND, NOW(6), expires_at) / 3600e6 AS hours_left, expires_at <= absolute_expires_at AS within FROM auth_sessions WHERE id = ?`,
      [id],
    );
    log(
      `idle expiry after use: ${Number(s.hours_left).toFixed(2)} hours left (was 10); within absolute limit: ${s.within}`,
    );
    assert.ok(Number(s.hours_left) > 11.9);
    assert.equal(s.within, 1);
  });
});

describe("staff accounts and one-time passwords", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
    await new Client().get("/"); // warm up
  });

  test("AUTH-15 a new staff member must replace the one-time password before using the system", async () => {
    const ids = await roleIds();
    const created = await owner.post("/api/user", {
      name: "Nimal Silva",
      username: "nimal",
      roleIds: [ids.sales],
    });
    const staff = await new Client().login("nimal", created.body.temporaryPassword);
    const me = await staff.get("/api/auth/me");
    const blocked = await staff.get("/api/learnex/data");
    const changed = await staff.post("/api/auth/password", {
      currentPassword: created.body.temporaryPassword,
      newPassword: STAFF_PASSWORD,
    });
    const allowed = await staff.get("/api/learnex/data");
    const oldPw = await new Client().post("/api/auth/login", {
      username: "nimal",
      password: created.body.temporaryPassword,
    });
    log(
      `created -> ${created.status}; mustChangePassword=${me.body.user.mustChangePassword}; data before change -> ${blocked.status} (${blocked.body.code})`,
    );
    log(
      `password change -> ${changed.status}; data after -> ${allowed.status}; one-time password afterwards -> ${oldPw.status}`,
    );
    assert.equal(me.body.user.mustChangePassword, true);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "password_change_required");
    assert.equal(changed.status, 200);
    assert.equal(allowed.status, 200);
    assert.equal(oldPw.status, 401);
  });

  test("AUTH-16 usernames are unique regardless of case", async () => {
    const ids = await roleIds();
    const r = await owner.post("/api/user", { name: "Dup", username: "NIMAL", roleIds: [ids.sales] });
    log(`create "NIMAL" when "nimal" exists -> ${r.status} "${r.body.error}"`);
    assert.equal(r.status, 409);
  });

  test("AUTH-17 changing your own password signs out your other devices", async () => {
    const pc1 = await new Client().login("nimal", STAFF_PASSWORD);
    const pc2 = await new Client().login("nimal", STAFF_PASSWORD);
    const r = await pc1.post("/api/auth/password", {
      currentPassword: STAFF_PASSWORD,
      newPassword: "Nimal-new-pass-1",
    });
    const pc1After = await pc1.get("/api/auth/me");
    const pc2After = await pc2.get("/api/learnex/data");
    log(
      `change -> ${r.status}; this device still signed in: ${!!pc1After.body.user}; other device -> ${pc2After.status}`,
    );
    assert.ok(pc1After.body.user);
    assert.equal(pc2After.status, 401);
    await pc1.post("/api/auth/password", {
      currentPassword: "Nimal-new-pass-1",
      newPassword: STAFF_PASSWORD,
    });
  });
});

describe("what each role can load and save", () => {
  let owner, sales, inventory, accountant, admin;
  before(async () => {
    owner = await asOwner();
    await wipeDatabase();
    await owner.post("/api/learnex/import", { stores: backupData() });
    sales = await createStaff(owner, { username: "cashier", roles: ["sales"] });
    inventory = await createStaff(owner, { username: "storekeeper", roles: ["inventory"] });
    accountant = await createStaff(owner, { username: "accounts", roles: ["accountant"] });
    admin = await createStaff(owner, { username: "manager", roles: ["administrator"] });
  });
  const accessOf = async (c) => (await c.get("/api/learnex/data")).body;
  const saveOne = async (c, store) => {
    const data = (await owner.get("/api/learnex/data")).body.stores[store];
    const rec = { ...data[0] };
    if (store === "settings")
      return c.post("/api/learnex/sync", { changes: [{ store, value: { ...data, businessName: "X" } }] });
    rec.name = (rec.name || rec.desc || "x") + "";
    return c.post("/api/learnex/sync", {
      changes: [{ store, upserts: [rec], order: data.map((r) => r.id) }],
    });
  };

  test("AUTH-18 Sales & POS only receives the modules its screens need", async () => {
    const d = await accessOf(sales);
    log("access:", JSON.stringify(d.access));
    log("modules returned:", Object.keys(d.stores).join(", "));
    assert.deepEqual(Object.keys(d.access).sort(), [
      "cashAccounts",
      "customers",
      "deliveryRuns",
      "ledger",
      "products",
      "salesOrders",
      "settings",
    ]);
    assert.ok(
      !("suppliers" in d.stores) &&
        !("purchaseOrders" in d.stores) &&
        !("rawMaterials" in d.stores) &&
        !("users" in d.stores),
    );
  });

  test("AUTH-19 Sales & POS can save a POS sale (orders + stock + customers + ledger) in one request", async () => {
    const all = (await owner.get("/api/learnex/data")).body.stores;
    const product = { ...all.products[0], stock: all.products[0].stock - 1 };
    const order = {
      id: "SO-AUTH1",
      invoice: "INV-AUTH1",
      customer: "Walk-in Customer",
      items: 1,
      lineItems: [{ productId: product.id, name: product.name, qty: 1, price: product.price }],
      amount: product.price,
      tax: 0,
      status: "Delivered",
      payment: "Paid",
      date: "2026-10-13",
      channel: "POS",
      amountPaid: product.price,
      payments: [{ date: "2026-10-13", amount: product.price }],
      accrued: true,
    };
    const txn = {
      id: "TXN-AUTH1",
      date: "2026-10-13",
      desc: "POS sale — INV-AUTH1",
      type: "Income",
      category: "Sales",
      amount: product.price,
      account: "CASH-MAIN",
      kind: "revenue",
      attachment: null,
    };
    const r = await sales.post("/api/learnex/sync", {
      changes: [
        { store: "products", upserts: [product], order: all.products.map((p) => p.id) },
        { store: "salesOrders", upserts: [order], order: [order.id, ...all.salesOrders.map((o) => o.id)] },
        { store: "ledger", upserts: [txn], order: [txn.id, ...all.ledger.map((t) => t.id)] },
      ],
    });
    const saved = await one(`SELECT id, amount FROM sales_orders WHERE id = 'SO-AUTH1'`);
    log(`POS-style save by cashier -> ${r.status}; order in DB: ${JSON.stringify(saved)}`);
    assert.equal(r.status, 200);
    assert.ok(saved);
  });

  test("AUTH-20 Sales & POS can't change suppliers — and the whole batch is refused", async () => {
    const all = (await owner.get("/api/learnex/data")).body.stores;
    const r = await sales.post("/api/learnex/sync", {
      changes: [
        {
          store: "customers",
          upserts: [{ ...all.customers[0], name: "SHOULD NOT SAVE" }],
          order: all.customers.map((c) => c.id),
        },
        {
          store: "suppliers",
          upserts: [{ ...all.suppliers[0], name: "Hacked" }],
          order: all.suppliers.map((s) => s.id),
        },
      ],
    });
    const cust = await one(`SELECT name FROM customers WHERE id = ?`, [all.customers[0].id]);
    log(`-> ${r.status} "${r.body.error}"; customer name still "${cust.name}"`);
    assert.equal(r.status, 403);
    assert.equal(cust.name, all.customers[0].name);
  });

  const forbiddenFor = [
    ["AUTH-21 Inventory Manager can't change customers", () => inventory, "customers"],
    ["AUTH-22 Accountant can't change products", () => accountant, "products"],
    ["AUTH-23 Sales & POS can't change business settings", () => sales, "settings"],
  ];
  for (const [name, who, store] of forbiddenFor) {
    test(name, async () => {
      const r = await saveOne(who(), store);
      log(`-> ${r.status} "${r.body.error}"`);
      assert.equal(r.status, 403);
    });
  }

  const allowedFor = [
    [
      "AUTH-24 Inventory Manager can change products and suppliers",
      () => inventory,
      ["products", "suppliers"],
    ],
    [
      "AUTH-25 Accountant can change the ledger and cash accounts",
      () => accountant,
      ["ledger", "cashAccounts"],
    ],
    ["AUTH-26 Administrator can change business settings", () => admin, ["settings"]],
  ];
  for (const [name, who, stores] of allowedFor) {
    test(name, async () => {
      for (const store of stores) {
        const r = await saveOne(who(), store);
        log(`${store} -> ${r.status}`);
        assert.equal(r.status, 200, `${store}: ${JSON.stringify(r.body)}`);
      }
    });
  }

  test("AUTH-27 only the right roles reach import, factory reset, users, roles and the activity log", async () => {
    const checks = [
      ["cashier", sales, "POST", "/api/learnex/reset", 403],
      ["cashier", sales, "POST", "/api/learnex/import", 403],
      ["cashier", sales, "GET", "/api/user", 403],
      ["cashier", sales, "GET", "/api/roles", 403],
      ["cashier", sales, "GET", "/api/audit", 403],
      ["accounts", accountant, "GET", "/api/audit", 403],
      ["manager", admin, "POST", "/api/learnex/reset", 403],
      ["manager", admin, "GET", "/api/user", 200],
      ["manager", admin, "GET", "/api/audit", 200],
    ];
    for (const [who, c, method, path, expected] of checks) {
      const r = await c.call(method, path, method === "POST" ? {} : undefined);
      log(`${who.padEnd(8)} ${method} ${path} -> ${r.status}`);
      assert.equal(r.status, expected, `${who} ${method} ${path}`);
    }
  });

  test("AUTH-28 import is refused once the database is set up (no accidental wipe)", async () => {
    const r = await owner.post("/api/learnex/import", { stores: {} });
    log(`owner import on a set-up database -> ${r.status} "${r.body.error}"`);
    assert.equal(r.status, 409);
  });
});

describe("no one can give themselves (or others) more power", () => {
  let owner, admin, adminId, ids;
  before(async () => {
    owner = await asOwner();
    admin = await createStaff(owner, { username: "manager", roles: ["administrator"] });
    adminId = admin.userId;
    ids = await roleIds();
  });

  test("AUTH-29 an administrator can't assign the Owner role", async () => {
    const r = await admin.post("/api/user", { name: "Shadow", username: "shadow", roleIds: [ids.owner] });
    log(`-> ${r.status} "${r.body.error}"`);
    assert.equal(r.status, 403);
  });

  test("AUTH-30 an administrator can't create a role with a permission they don't have (factory reset)", async () => {
    const r = await admin.post("/api/roles", { name: "Nuke", permissions: ["data.reset"] });
    log(`-> ${r.status} "${r.body.error}"`);
    assert.equal(r.status, 403);
  });

  test("AUTH-31 nobody can change their own roles or disable themselves", async () => {
    const roles = await admin.put(`/api/user/${adminId}/role`, {
      roleIds: [ids.administrator, ids.accountant],
    });
    const disable = await admin.patch(`/api/user/${adminId}`, { status: "disabled" });
    const ownerId = (await one(`SELECT id FROM auth_users WHERE username = ?`, [OWNER.username])).id;
    const ownerSelf = await owner.put(`/api/user/${ownerId}/role`, { roleIds: [ids.administrator] });
    log(
      `admin changes own roles -> ${roles.status}; admin disables self -> ${disable.status}; owner drops own owner role -> ${ownerSelf.status}`,
    );
    assert.equal(roles.status, 403);
    assert.equal(disable.status, 403);
    assert.equal(ownerSelf.status, 403);
  });

  test("AUTH-32 only an owner can touch an owner's account", async () => {
    const ownerId = (await one(`SELECT id FROM auth_users WHERE username = ?`, [OWNER.username])).id;
    const reset = await admin.post(`/api/user/${ownerId}/password`);
    const disable = await admin.patch(`/api/user/${ownerId}`, { status: "disabled" });
    const signOut = await admin.delete(`/api/user/${ownerId}/sessions`);
    log(
      `admin → owner: reset password ${reset.status}, disable ${disable.status}, sign out ${signOut.status}`,
    );
    assert.deepEqual([reset.status, disable.status, signOut.status], [403, 403, 403]);
  });

  test("AUTH-33 the Owner role itself can't be edited or deleted", async () => {
    const edit = await owner.patch(`/api/roles/${ids.owner}`, { name: "Owner", permissions: [] });
    const del = await owner.delete(`/api/roles/${ids.owner}`);
    log(`edit Owner role -> ${edit.status}; delete -> ${del.status}`);
    assert.equal(edit.status, 403);
    assert.equal(del.status, 403);
  });
});

describe("changes take effect immediately", () => {
  let owner, cashier, roleId, ownerData;
  before(async () => {
    owner = await asOwner();
    await wipeDatabase();
    await owner.post("/api/learnex/import", { stores: backupData() });
    const r = await owner.post("/api/roles", {
      name: "Temp Cashier",
      description: "test",
      permissions: ["pos.use"],
    });
    roleId = r.body.id;
    const ids = await roleIds();
    const created = await owner.post("/api/user", { name: "Temp", username: "temp", roleIds: [roleId] });
    cashier = await new Client().login("temp", created.body.temporaryPassword);
    await cashier.post("/api/auth/password", {
      currentPassword: created.body.temporaryPassword,
      newPassword: STAFF_PASSWORD,
    });
    cashier.userId = created.body.id;
    ownerData = (await owner.get("/api/learnex/data")).body.stores;
    void ids;
  });
  const sell = () =>
    cashier.post("/api/learnex/sync", {
      changes: [
        {
          store: "customers",
          upserts: [{ ...ownerData.customers[0], orders: ownerData.customers[0].orders + 1 }],
          order: ownerData.customers.map((c) => c.id),
        },
      ],
    });

  test("AUTH-34 removing a permission from a role blocks its users on their very next request", async () => {
    const before = await sell();
    await owner.patch(`/api/roles/${roleId}`, {
      name: "Temp Cashier",
      description: "test",
      permissions: ["dashboard.view"],
    });
    const after = await sell();
    log(
      `save with pos.use -> ${before.status}; after the owner removed pos.use (no re-login) -> ${after.status}`,
    );
    assert.equal(before.status, 200);
    assert.equal(after.status, 403);
  });

  test("AUTH-35 a role that people still have can't be deleted; an unused one can", async () => {
    const inUse = await owner.delete(`/api/roles/${roleId}`);
    const spare = await owner.post("/api/roles", { name: "Spare", permissions: [] });
    const del = await owner.delete(`/api/roles/${spare.body.id}`);
    log(`delete role in use -> ${inUse.status} "${inUse.body.error}"; delete unused role -> ${del.status}`);
    assert.equal(inUse.status, 409);
    assert.equal(del.status, 200);
  });

  test("AUTH-36 disabling an account signs it out everywhere and blocks sign-in", async () => {
    const r = await owner.patch(`/api/user/${cashier.userId}`, { status: "disabled" });
    const existing = await cashier.get("/api/learnex/data");
    const relogin = await new Client().post("/api/auth/login", {
      username: "temp",
      password: STAFF_PASSWORD,
    });
    const sessions = await one(`SELECT count(*) AS n FROM auth_sessions WHERE user_id = ?`, [cashier.userId]);
    log(
      `disable -> ${r.status}; existing session -> ${existing.status}; new sign-in -> ${relogin.status} "${relogin.body.error}"; sessions left: ${sessions.n}`,
    );
    assert.equal(existing.status, 401);
    assert.equal(relogin.status, 403);
    assert.equal(sessions.n, 0);
  });
});

describe("request safety", () => {
  let owner;
  before(async () => {
    owner = await asOwner();
  });

  test("AUTH-37 a request from another website is refused (CSRF), a same-site one is accepted", async () => {
    const evil = await owner.post("/api/learnex/reset", {}, { origin: "http://evil.example" });
    const ok = await owner.get("/api/auth/me", { origin: BASE });
    const sameSite = await owner.post("/api/auth/logout", {}, { origin: BASE });
    log(
      `POST reset with Origin evil.example -> ${evil.status} "${evil.body.error}"; same-origin POST -> ${sameSite.status}; GET -> ${ok.status}`,
    );
    assert.equal(evil.status, 403);
    assert.equal(sameSite.status, 200);
  });

  test("AUTH-38 API responses are never cached", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    const r = await c.get("/api/learnex/data");
    log("Cache-Control:", r.headers.get("cache-control"));
    assert.match(r.headers.get("cache-control"), /no-store/);
  });

  test("AUTH-39 the activity log records sign-ins, failures, account and role changes, and who saved data", async () => {
    const c = await new Client().login(OWNER.username, OWNER.password);
    await new Client().post("/api/auth/login", { username: OWNER.username, password: "wrong-pass-1" });
    const staff = await createStaff(c, { username: "logme", roles: ["sales"] });
    await c.post("/api/roles", { name: "Audited Role", permissions: ["reports.view"] });
    await staff.post("/api/learnex/sync", {
      changes: [{ store: "customers", upserts: [], deletes: [], order: [] }],
    });
    const r = await c.get("/api/audit?limit=50");
    const actions = r.body.entries.map((e) => `${e.username}:${e.action}`);
    log("latest entries:", actions.slice(0, 12).join(" | "));
    for (const expected of [
      "owner:auth.login",
      "owner:auth.login_failed",
      "owner:user.create",
      "logme:auth.login",
      "logme:auth.password_change",
      "owner:role.create",
      "logme:data.save",
    ]) {
      assert.ok(actions.includes(expected), `missing ${expected}`);
    }
  });
});

describe("in the browser", () => {
  let browser, owner;
  before(async () => {
    owner = await asOwner();
    await wipeDatabase();
    await owner.post("/api/learnex/import", { stores: backupData() });
    browser = await launchBrowser();
  });
  after(() => browser.close());

  test("AUTH-UI-1 a brand-new install walks the owner through account creation", async () => {
    await resetAuth();
    const page = await newPage(browser, { client: null });
    await page.goto("/");
    await page.getByText("Create the owner account").waitFor();
    await page.getByLabel("Setup code").fill(SETUP_CODE);
    await page.getByLabel("Your name").fill(OWNER.name);
    await page.getByLabel("Username").fill(OWNER.username);
    await page.getByLabel("Email (optional)").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await page.getByLabel("Repeat password").fill(OWNER.password);
    await page.getByRole("button", { name: "Create Owner Account" }).click();
    await page.locator("aside nav").waitFor();
    const header = await page.locator("header").innerText();
    log("after setup the app opens; header:", header.replace(/\s+/g, " ").trim());
    assert.match(header, /Test Owner/);
    assert.match(header, /Owner/);
    assert.deepEqual(takeConsoleProblems(page), []);
    owner = await new Client().login(OWNER.username, OWNER.password);
    await page.context().close();
  });

  test("AUTH-UI-2 sign in, wrong password message, sign out", async () => {
    const page = await newPage(browser, { client: null });
    await page.goto("/");
    await page.getByLabel("Username or email").fill(OWNER.username);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    const msg = await page.getByText("Incorrect username or password.").innerText();
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.locator("aside nav").waitFor();
    await page.getByTitle("Account").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByText("Sign in to LEARNEX ERP").waitFor();
    await page.reload();
    await page.getByText("Sign in to LEARNEX ERP").waitFor();
    log(`wrong password shows: "${msg}"; signed in; signed out; after reload still signed out`);
    takeConsoleProblems(page); // the failed sign-in logs a 401
    await page.context().close();
  });

  let created;
  test("AUTH-UI-3 the owner adds a staff member in Settings → Users & Roles and gets a one-time password", async () => {
    const page = await newPage(browser, { client: owner });
    await page.goto("/");
    await nav(page, "Settings");
    await page.locator("main button", { hasText: "Users & Roles" }).click();
    await page.getByRole("button", { name: /Add User/ }).click();
    await page
      .locator("label", { hasText: "Full name" })
      .locator("xpath=..")
      .locator("input")
      .fill("Kasun Perera");
    await page
      .locator("label", { hasText: "Username (used to sign in)" })
      .locator("xpath=..")
      .locator("input")
      .fill("kasun");
    await page.locator("label", { hasText: "Sales & POS" }).locator("input[type=checkbox]").check();
    await page.getByRole("button", { name: /Create Account/ }).click();
    const pw = await page.getByTestId("one-time-password").innerText();
    created = { username: "kasun", password: pw };
    await page.getByRole("button", { name: "Done" }).click();
    const row = await page.locator("main tr", { hasText: "Kasun Perera" }).innerText();
    log(
      `one-time password shown: ${pw.replace(/[A-Za-z0-9]/g, "x")}; table row: ${row.replace(/\s+/g, " ")}`,
    );
    assert.match(row, /Sales & POS/);
    assert.match(row, /One-time password/);
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("AUTH-UI-4 the new staff member must choose a password at first sign-in", async () => {
    const page = await newPage(browser, { client: null });
    await page.goto("/");
    await page.getByLabel("Username or email").fill(created.username);
    await page.getByLabel("Password").fill(created.password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.getByText("Choose your own password").waitFor();
    await page.getByLabel("One-time password").fill(created.password);
    await page.getByLabel("New password", { exact: true }).fill(STAFF_PASSWORD);
    await page.getByLabel("Repeat new password").fill(STAFF_PASSWORD);
    await page.getByRole("button", { name: "Save Password & Continue" }).click();
    await page.locator("aside nav").waitFor();
    log("forced password change completed; app opened");
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("AUTH-UI-5 a Sales & POS user only sees their screens, and no Backup button", async () => {
    const kasun = await new Client().login(created.username, STAFF_PASSWORD);
    const page = await newPage(browser, { client: kasun });
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    const menu = await page.locator("aside nav button").allInnerTexts();
    const header = await page.locator("header").innerText();
    log("menu:", menu.join(" | "));
    log("header:", header.replace(/\s+/g, " ").trim());
    assert.deepEqual(menu, ["Point of Sale", "Sales Orders", "Delivery Stock", "Customers"]);
    assert.match(header, /Kasun Perera/);
    assert.match(header, /Sales & POS/);
    assert.doesNotMatch(header, /Backup/);
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("AUTH-UI-6 the Sales & POS user completes a POS sale; it is saved and logged under their name", async () => {
    const kasun = await new Client().login(created.username, STAFF_PASSWORD);
    const page = await newPage(browser, { client: kasun });
    await page.goto("/");
    await nav(page, "Point of Sale");
    await page.locator("main button", { hasText: "HP 12A Toner Cartridge" }).first().click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    const toast = await page.getByText(/Sale completed/).innerText();
    await waitSaved(page);
    const invoice = toast.match(/INV-\d+/)[0];
    const order = await one(`SELECT id FROM sales_orders WHERE invoice = ?`, [invoice]);
    const entry = await one(
      `SELECT username, details FROM audit_log WHERE action = 'data.save' ORDER BY id DESC LIMIT 1`,
    );
    log(`${toast}`);
    log(
      `order ${order.id} in DB; activity log: ${entry.username} saved ${JSON.parse(entry.details)
        .changes.map((c) => c.store)
        .join(", ")}`,
    );
    assert.equal(entry.username, created.username);
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("AUTH-UI-7 every default role can open every screen it's allowed, with no errors and no refused saves", async () => {
    const roles = ["administrator", "sales", "inventory", "accountant"];
    for (const role of roles) {
      const user = await createStaff(owner, { username: "screen-" + role, roles: [role] });
      const page = await newPage(browser, { client: user });
      await page.goto("/");
      await page.locator("aside nav").waitFor();
      const menu = await page.locator("aside nav button").allInnerTexts();
      for (const label of menu) {
        await nav(page, label);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(600);
      const badgeText = await page.locator("header").innerText();
      const problems = takeConsoleProblems(page);
      log(
        `${role.padEnd(13)} ${menu.length} screens: ${menu.join(", ")}${problems.length ? " | PROBLEMS: " + problems.join("; ") : ""}`,
      );
      assert.doesNotMatch(badgeText, /Not allowed|Not saved/);
      assert.deepEqual(problems, []);
      await page.context().close();
    }
  });

  test("AUTH-UI-8 when the owner disables a signed-in user, their next action returns them to the sign-in screen", async () => {
    const victim = await createStaff(owner, { username: "leaver", roles: ["inventory"] });
    const page = await newPage(browser, { client: victim });
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    await owner.patch(`/api/user/${victim.userId}`, { status: "disabled" });
    await nav(page, "Products & Inventory");
    await page.locator("main tr", { hasText: "Canon PIXMA G3010" }).locator("button").first().click();
    await page.getByPlaceholder("0.00").nth(1).fill("12345");
    await page.locator("button", { hasText: "Save Changes" }).click();
    await page.getByText("Your session has ended").waitFor({ timeout: 10000 });
    const price = await one(`SELECT price FROM products WHERE name = 'Canon PIXMA G3010'`);
    log(
      `after being disabled, the save was refused and the sign-in screen appeared; price in DB still ${price.price}`,
    );
    assert.notEqual(Number(price.price), 12345);
    takeConsoleProblems(page);
    await page.context().close();
  });

  test("AUTH-UI-9 the Activity Log screen lists what happened, newest first", async () => {
    const page = await newPage(browser, { client: owner });
    await page.goto("/");
    await nav(page, "Settings");
    await page.locator("main button", { hasText: "Activity Log" }).click();
    await page.locator("main tbody tr", { hasText: "Saved changes to" }).first().waitFor();
    const first = await page.locator("main tbody tr").allInnerTexts();
    first.slice(0, 6).forEach((r) => log(r.replace(/\s+/g, " ")));
    assert.ok(first.some((r) => /Disabled|disabled the account/.test(r)));
    assert.ok(first.some((r) => /Saved changes to/.test(r)));
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });
});
