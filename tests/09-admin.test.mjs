// Feature tests: Settings (business profile, notifications, data tools), the
// Users & Roles and Activity Log screens, and the app shell (menu, header,
// account menu), driven in the browser.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  OWNER,
  STAFF_PASSWORD,
  asOwner,
  backupData,
  captureDialogs,
  createStaff,
  download,
  field,
  launchBrowser,
  loadStores,
  log,
  modal,
  newPage,
  openApp,
  pool,
  row,
  shopFixture,
  stores,
  toast,
  waitSaved,
} from "./helpers.mjs";

let browser, owner;
before(async () => {
  owner = await asOwner();
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
  await pool.end();
});

const settingsTab = async (page, tab) => {
  await page.locator("aside nav button", { hasText: "Settings" }).click();
  await page.locator("main button", { hasText: tab }).first().click();
};

/* ------------------------------------------------------------- Settings */

describe("Settings", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("SET-1 the business profile is saved; the currency symbol changes everywhere", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Business Profile");
    const inputs = page.locator("main input");
    await inputs.nth(0).fill("Hashil Traders");
    await inputs.nth(1).fill("12.5");
    await inputs.nth(2).fill("1000");
    await page.locator("main select").selectOption("USD ($)");
    await page.getByRole("button", { name: "Save Changes" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = (await stores()).settings;
    log(message, JSON.stringify(s));
    assert.equal(message, "Settings saved.");
    assert.deepEqual(
      [s.businessName, Number(s.taxRate), Number(s.openingCapital), s.currency],
      ["Hashil Traders", 12.5, 1000, "USD ($)"],
    );
    await page.locator("aside nav button", { hasText: "Products & Inventory" }).click();
    assert.match(await row(page, "Alpha Printer").innerText(), /\$ 600\s+\$ 1,000/);
    await page.locator("aside nav button", { hasText: "Point of Sale" }).click();
    await page.locator("main button", { hasText: "Alpha Printer" }).first().click();
    assert.match(
      await page.locator("button", { hasText: "Complete Sale" }).innerText(),
      /\$ 1,125/,
      "12.5 % tax",
    );
    await page.context().close();
  });

  test("SET-2 notification preferences are saved", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Notifications");
    const toggles = page.locator("main button.rounded-full");
    await toggles.nth(0).click(); // low stock: on -> off
    await toggles.nth(2).click(); // daily summary: off -> on
    await page.getByRole("button", { name: "Save Preferences" }).click();
    await waitSaved(page);
    const s = (await stores()).settings;
    assert.deepEqual([s.notifLowStock, s.notifOverdue, s.notifDaily], [false, true, true]);
    await page.context().close();
  });

  test("SET-3 clearing one module empties only that module", async () => {
    const data = shopFixture();
    data.ledger = [
      { id: "TXN-1", date: "2026-02-01", desc: "Rent", type: "Expense", category: "Rent", amount: 100 },
    ];
    await loadStores(data);
    const page = await openApp(browser);
    await settingsTab(page, "Data & Backup");
    const moduleRow = (label) =>
      page.locator("main div.rounded-xl", { has: page.getByText(label, { exact: true }) });
    assert.equal(
      await moduleRow("Delivery Runs").getByRole("button", { name: /Clear/ }).isDisabled(),
      true,
      "nothing to clear",
    );
    await moduleRow("Accounting Ledger").getByRole("button", { name: /Clear/ }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(message, "Accounting Ledger cleared — all other data was left untouched.");
    assert.deepEqual(s.ledger, []);
    assert.equal(s.products.length, 3);
    assert.equal(s.customers.length, 2);
    await page.context().close();
  });

  test("SET-4 restoring a file that isn't a backup changes nothing and says why", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Data & Backup");
    await page.locator("main input[type=file]").setInputFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"hello":"world"}'),
    });
    const message = await toast(page).innerText();
    log(message);
    assert.equal(message, "Couldn't restore that file — it doesn't look like a valid LEARNEX backup.");
    assert.equal((await stores()).products.length, 3);
    await page.context().close();
  });

  test("SET-5 each role only sees the settings it may use", async () => {
    const accountant = await createStaff(owner, { username: "acct-settings", roles: ["accountant"] });
    const admin = await createStaff(owner, { username: "admin-settings", roles: ["administrator"] });
    const tabsOf = async (client) => {
      const page = await newPage(browser, { client });
      await page.goto("/");
      await settingsTab(page, "Data & Backup");
      const tabs = await page.locator("main > div > div.flex.gap-2 button").allInnerTexts();
      const cards = await page.locator("main h3").allInnerTexts();
      await page.context().close();
      return { tabs, cards };
    };
    const a = await tabsOf(accountant);
    const m = await tabsOf(admin);
    log("accountant:", JSON.stringify(a));
    log("administrator:", JSON.stringify(m));
    assert.deepEqual(a.tabs, ["Data & Backup"]);
    assert.ok(
      a.cards.includes("Download Backup") &&
        !a.cards.includes("Restore from Backup") &&
        !a.cards.includes("Factory Reset"),
    );
    assert.deepEqual(m.tabs, [
      "Business Profile",
      "Users & Roles",
      "Notifications",
      "Data & Backup",
      "Activity Log",
    ]);
    assert.ok(
      m.cards.includes("Restore from Backup") &&
        !m.cards.includes("Factory Reset") &&
        !m.cards.includes("Clear a Specific Module"),
    );
  });
});

/* ------------------------------------------------------- Users & Roles */

describe("Users & Roles screen", () => {
  let staff;
  beforeEach(async () => {
    owner = await asOwner();
    await loadStores(shopFixture());
    staff = await createStaff(owner, { username: "nimal", name: "Nimal Silva", roles: ["sales"] });
  });
  const usersFromApi = async () => (await owner.get("/api/user")).body.users;
  // The checkbox of the permission (or role) whose name is exactly `name`.
  const checkbox = (m, name) =>
    m
      .locator("label")
      .filter({ has: m.page().locator("span.font-medium", { hasText: new RegExp(`^${name}$`) }) })
      .locator("input[type=checkbox]");
  const staffRow = (page) => row(page, "@nimal");
  const rolesCard = (page) =>
    page.locator("div.rounded-2xl", { has: page.locator("h3", { hasText: "Roles" }) }).last();

  test("USR-1 editing a staff member's name, email and roles", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    await staffRow(page).getByTitle("Edit").click();
    const m = modal(page);
    await field(m, "Full name").fill("Nimal S. Silva");
    await field(m, "Email (optional)").fill("nimal@shop.lk");
    await checkbox(m, "Sales & POS").uncheck();
    await checkbox(m, "Inventory Manager").check();
    await m.getByRole("button", { name: "Save Changes" }).click();
    const message = await toast(page).innerText();
    const u = (await usersFromApi()).find((x) => x.username === "nimal");
    log(message, JSON.stringify({ name: u.name, email: u.email, roles: u.roles.map((r) => r.name) }));
    assert.equal(message, "User updated.");
    assert.deepEqual(
      [u.name, u.email, u.roles.map((r) => r.key)],
      ["Nimal S. Silva", "nimal@shop.lk", ["inventory"]],
    );
    assert.match(await staffRow(page).innerText(), /Inventory Manager/);
    await page.context().close();
  });

  test("USR-2 resetting a password shows a one-time password that works once", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    await staffRow(page).getByRole("button", { name: "Reset password" }).click();
    await modal(page).getByText("Password reset").waitFor();
    const otp = await page.getByTestId("one-time-password").innerText();
    await modal(page).getByRole("button", { name: "Done" }).click();
    const login = await new Client().post("/api/auth/login", { username: "nimal", password: otp });
    const me = await new Client().login("nimal", otp).then((c) => c.get("/api/auth/me"));
    log(
      `one-time password ${otp.replace(/[A-Za-z0-9]/g, "x")} -> sign-in ${login.status}; must change: ${me.body.user.mustChangePassword}`,
    );
    assert.equal(login.status, 200);
    assert.equal(me.body.user.mustChangePassword, true);
    assert.match(await staffRow(page).innerText(), /One-time password/);
    await page.context().close();
  });

  test("USR-3 disabling and re-enabling an account", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    const dialogs = captureDialogs(page);
    await staffRow(page).getByRole("button", { name: "Disable" }).click();
    const disabled = await toast(page).innerText();
    assert.match(await staffRow(page).innerText(), /Disabled/);
    const refused = await new Client().post("/api/auth/login", {
      username: "nimal",
      password: STAFF_PASSWORD,
    });
    await staffRow(page).getByRole("button", { name: "Enable" }).click();
    await page.waitForTimeout(300);
    const enabled = await toast(page).innerText();
    const allowed = await new Client().post("/api/auth/login", {
      username: "nimal",
      password: STAFF_PASSWORD,
    });
    log(`${disabled} -> sign-in ${refused.status}; ${enabled} -> sign-in ${allowed.status}`);
    assert.deepEqual(dialogs, [
      "Disable Nimal Silva's account? They will be signed out and can't sign in until re-enabled.",
    ]);
    assert.equal(disabled, "Nimal Silva's account disabled.");
    assert.equal(refused.status, 403);
    assert.equal(enabled, "Nimal Silva's account enabled.");
    assert.equal(allowed.status, 200);
    await page.context().close();
  });

  test("USR-4 signing a staff member out of every device", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    assert.match(await staffRow(page).innerText(), /1 active session\(s\)/);
    await staffRow(page).getByRole("button", { name: "Sign out" }).click();
    const message = await toast(page).innerText();
    const after = await staff.get("/api/learnex/data");
    log(`${message}; staff's next request -> ${after.status}`);
    assert.equal(message, "Nimal Silva was signed out of 1 session(s).");
    assert.equal(after.status, 401);
    await page.context().close();
  });

  test("USR-5 you can't change your own roles, reset your own password or disable yourself from this screen", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    const me = row(page, `@${OWNER.username}`);
    assert.match(await me.innerText(), /\(you\)/);
    assert.equal(await me.getByRole("button", { name: "Reset password" }).count(), 0);
    assert.equal(await me.getByRole("button", { name: "Disable" }).count(), 0);
    await me.getByTitle("Edit").click();
    await modal(page).getByText("Roles (you can't change your own)").waitFor();
    const boxes = modal(page).locator("input[type=checkbox]");
    for (let i = 0; i < (await boxes.count()); i++) assert.equal(await boxes.nth(i).isDisabled(), true);
    await page.context().close();
  });

  test("ROLE-1 creating a role with chosen permissions", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    await page.getByRole("button", { name: "New Role" }).click();
    const m = modal(page);
    await field(m, "Role name").fill("Stock Checker");
    await field(m, "Description").fill("Counts stock");
    await checkbox(m, "Products & inventory").check();
    await checkbox(m, "Suppliers").check();
    await m.getByRole("button", { name: "Save Role" }).click();
    const message = await toast(page).innerText();
    const role = (await owner.get("/api/roles")).body.roles.find((r) => r.name === "Stock Checker");
    log(message, JSON.stringify(role));
    assert.equal(message, "Role saved. It applies immediately.");
    assert.deepEqual(
      [role.description, role.permissions.sort(), role.userCount],
      ["Counts stock", ["inventory.manage", "suppliers.manage"], 0],
    );
    assert.match(await row(page, "Stock Checker").innerText(), /Products & inventory, Suppliers\s+0/);
    await page.context().close();
  });

  test("ROLE-2 editing a role's permissions applies to everyone who has it", async () => {
    const r = await owner.post("/api/roles", {
      name: "Till Clerk",
      description: "",
      permissions: ["pos.use"],
    });
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    await row(page, "Till Clerk").getByTitle("Edit role").click();
    await checkbox(modal(page), "Customers").check();
    await modal(page).getByRole("button", { name: "Save Role" }).click();
    await toast(page).waitFor();
    const role = (await owner.get("/api/roles")).body.roles.find((x) => x.id === r.body.id);
    assert.deepEqual(role.permissions.sort(), ["customers.manage", "pos.use"]);
    await page.context().close();
  });

  test("ROLE-3 a role in use can't be deleted; an unused one can", async () => {
    await owner.post("/api/roles", { name: "Spare Role", description: "", permissions: [] });
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    const inUse = rolesCard(page).locator("tr", { hasText: "Sales & POS" });
    assert.equal(await inUse.getByTitle("Change these users' roles before deleting").isDisabled(), true);
    await row(page, "Spare Role").getByTitle("Delete role").click();
    const message = await toast(page).innerText();
    log(message);
    assert.equal(message, 'Role "Spare Role" deleted.');
    assert.equal(
      (await owner.get("/api/roles")).body.roles.some((x) => x.name === "Spare Role"),
      false,
    );
    await page.context().close();
  });

  test("ROLE-4 two roles can't share a name (any upper/lower case)", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    await page.getByRole("button", { name: "New Role" }).click();
    await field(modal(page), "Role name").fill("sales & pos");
    await modal(page).getByRole("button", { name: "Save Role" }).click();
    await modal(page).getByText("A role with that name already exists.").waitFor();
    await page.context().close();
  });

  test("ROLE-5 the Owner role can do everything and can't be edited or deleted", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Users & Roles");
    const ownerRole = rolesCard(page).locator("tr", { hasText: "Full access to everything" });
    assert.match(await ownerRole.innerText(), /Everything/);
    assert.equal(await ownerRole.locator("button").count(), 0);
    await page.context().close();
  });
});

/* -------------------------------------------------------- Activity Log */

describe("Activity Log screen", () => {
  before(async () => {
    owner = await asOwner();
    await createStaff(owner, { username: "logger", roles: ["sales"] });
  });
  const logRows = (page) => page.locator("main tbody tr");

  test("LOG-1 what happened, by whom, newest first", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Activity Log");
    await page.getByText("Created the owner account").waitFor();
    const text = (await logRows(page).allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    text.slice(0, 5).forEach((t) => log(t));
    // Each row: when, who, then the kind badge ("user", "auth", …) followed by what happened.
    assert.ok(text.some((t) => /owner\s+user\s*Added user “logger” \(Sales & POS\)/.test(t)));
    assert.ok(text.some((t) => /logger\s+auth\s*Changed their password/.test(t)));
    assert.ok(text.some((t) => /owner\s+auth\s*Created the owner account/.test(t)));
    assert.ok(
      text.findIndex((t) => /Changed their password/.test(t)) <
        text.findIndex((t) => /Created the owner account/.test(t)),
    );
    await page.context().close();
  });

  test("LOG-2 filtering by kind of activity and by username", async () => {
    const page = await openApp(browser);
    await settingsTab(page, "Activity Log");
    await page.locator("main select").selectOption({ label: "Staff accounts" });
    await page.waitForTimeout(500);
    const staffOnly = (await logRows(page).allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    await page.locator("main select").selectOption({ label: "Everything" });
    await page.getByPlaceholder("Filter by username").fill("logger");
    await page.waitForTimeout(800);
    const byUser = (await logRows(page).allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    log("staff accounts:", staffOnly.join(" | "));
    log("by logger:", byUser.join(" | "));
    assert.ok(staffOnly.length > 0 && staffOnly.every((t) => /\s(owner|logger)\s+user\s*[A-Z]/.test(t)));
    assert.ok(byUser.length > 0 && byUser.every((t) => /\slogger\s+(auth|data|user|role)\s*[A-Z]/.test(t)));
    await page.getByPlaceholder("Filter by username").fill("nobody-at-all");
    await page.getByText("No activity matches.").waitFor();
    await page.context().close();
  });

  test("LOG-3 older entries load 100 at a time", async () => {
    await pool.query("INSERT INTO audit_log (username, action, target) VALUES ?", [
      Array.from({ length: 120 }, (_, i) => ["owner", "data.save", `bulk ${i}`]),
    ]);
    const page = await openApp(browser);
    await settingsTab(page, "Activity Log");
    await logRows(page).nth(99).waitFor();
    const first = await logRows(page).count();
    await page.getByRole("button", { name: "Show older entries" }).click();
    await page.waitForTimeout(800);
    const more = await logRows(page).count();
    log(`first page: ${first} entries; after "Show older entries": ${more}`);
    assert.equal(first, 100);
    assert.ok(more > 100);
    await page.context().close();
  });
});

/* ------------------------------------------------------------ App shell */

describe("App shell", () => {
  before(async () => {
    owner = await asOwner();
  });
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("SHELL-1 dark mode can be switched on and off", async () => {
    const page = await openApp(browser);
    const root = page.locator("div.min-h-screen").first();
    const toggle = page.locator("header button.w-9.h-9");
    assert.match(await root.getAttribute("class"), /bg-slate-50/);
    await toggle.click();
    assert.match(await root.getAttribute("class"), /bg-slate-950/);
    await toggle.click();
    assert.match(await root.getAttribute("class"), /bg-slate-50/);
    await page.context().close();
  });

  test("SHELL-2 the menu can be collapsed to icons", async () => {
    const page = await openApp(browser);
    assert.match(await page.locator("aside").innerText(), /Dashboard/);
    await page.getByRole("button", { name: "Collapse" }).click();
    const labels = (await page.locator("aside nav").innerText()).trim();
    log(`menu text after collapsing: "${labels}"`);
    assert.equal(labels, "");
    await page.locator("aside button").last().click();
    assert.match(await page.locator("aside").innerText(), /Dashboard/);
    await page.context().close();
  });

  test("SHELL-3 the header Backup button downloads everything in one file", async () => {
    const page = await openApp(browser);
    const { name, text } = await download(page, () =>
      page.getByTitle("Download a full backup of everything in the system as one file").click(),
    );
    const data = backupData(text);
    log(name, Object.keys(data).join(", "));
    assert.match(name, /^learnex_backup_\d{4}-\d{2}-\d{2}_\d{4}\.html$/);
    assert.deepEqual(
      data.products.map((p) => p.name),
      ["Alpha Printer", "Beta Toner", "Gamma Paper"],
    );
    assert.equal(data.settings.businessName, "Test Shop");
    await page.context().close();
  });

  test("SHELL-4 changing your own password from the account menu", async () => {
    const page = await openApp(browser);
    await page.getByTitle("Account").click();
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel("Current password").fill(OWNER.password);
    await page.getByLabel("New password", { exact: true }).fill("Owner-new-pass-9");
    await page.getByLabel("Repeat new password").fill("Owner-other-9");
    await page.getByRole("button", { name: "Change Password" }).click();
    await page.getByText("The two new passwords don't match.").waitFor();
    await page.getByLabel("Repeat new password").fill("Owner-new-pass-9");
    await page.getByRole("button", { name: "Change Password" }).click();
    const message = await toast(page).innerText();
    const oldPw = await new Client().post("/api/auth/login", {
      username: OWNER.username,
      password: OWNER.password,
    });
    const newPw = await new Client().post("/api/auth/login", {
      username: OWNER.username,
      password: "Owner-new-pass-9",
    });
    log(`${message} | old password -> ${oldPw.status}, new password -> ${newPw.status}`);
    assert.equal(message, "Password changed. Any other devices you were signed in on have been signed out.");
    assert.deepEqual([oldPw.status, newPw.status], [401, 200]);
    await page.context().close();
    owner = await asOwner(); // back to the standard owner password for later tests
  });

  test("SHELL-5 an account whose roles open no screen is told it has no access yet", async () => {
    const role = await owner.post("/api/roles", { name: "Nothing Yet", description: "", permissions: [] });
    const created = await owner.post("/api/user", {
      name: "New Hire",
      username: "newhire",
      roleIds: [role.body.id],
    });
    const hire = await new Client().login("newhire", created.body.temporaryPassword);
    await hire.post("/api/auth/password", {
      currentPassword: created.body.temporaryPassword,
      newPassword: STAFF_PASSWORD,
    });
    const page = await newPage(browser, { client: hire });
    await page.goto("/");
    await page.getByText("No access yet").waitFor();
    assert.equal(await page.locator("aside nav button").count(), 0);
    await page.context().close();
  });
});
