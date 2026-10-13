// These tests confirm the KNOWN LIMITATIONS reported with the database work.
// Each one passes when the limitation is still present — when a limitation
// is fixed, its test will fail and should be turned into a regular test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import {
  asOwner,
  api,
  count,
  launchBrowser,
  log,
  nav,
  newPage,
  one,
  pool,
  waitSaved,
  wipeDatabase,
} from "./helpers.mjs";

let browser;
before(async () => {
  await asOwner();
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
  await pool.end();
});

test(
  "LIMIT-2 [known] the app is served over plain HTTP on every network interface, so passwords cross the network unencrypted from other PCs",
  { skip: process.platform !== "win32" && "uses Windows netstat" },
  () => {
    const port = process.env.TEST_APP_PORT;
    const lines = execFileSync("netstat", ["-ano"], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
    lines.forEach((l) => log(l.trim().replace(/\s+/g, " ")));
    assert.ok(
      lines.some((l) => /(0\.0\.0\.0|\[::\]):/.test(l)),
      "bound to all interfaces",
    );
  },
);

test("LIMIT-3 [known] two PCs selling at the same time: one sale and one stock update are lost", async () => {
  await wipeDatabase();
  await api("/import", { stores: {} }); // demo data
  const pcA = await newPage(browser);
  await pcA.goto("/");
  await pcA.locator("aside nav").waitFor();
  await waitSaved(pcA);
  const pcB = await newPage(browser);
  await pcB.goto("/");
  await pcB.locator("aside nav").waitFor();
  const stockBefore = Number(
    (await one(`SELECT stock FROM products WHERE name = 'Canon PIXMA G3010'`)).stock,
  );
  const ordersBefore = await count("sales_orders");
  for (const pc of [pcA, pcB]) {
    await nav(pc, "Point of Sale");
    await pc.locator("main button", { hasText: "Canon PIXMA G3010" }).first().click();
  }
  const toasts = [];
  for (const pc of [pcA, pcB]) {
    await pc.locator("button", { hasText: "Complete Sale" }).click();
    toasts.push(await pc.getByText(/Sale completed/).innerText());
    await waitSaved(pc);
  }
  const stockAfter = Number((await one(`SELECT stock FROM products WHERE name = 'Canon PIXMA G3010'`)).stock);
  const ordersAfter = await count("sales_orders");
  toasts.forEach((t, i) => log(`PC ${"AB"[i]}: ${t}`));
  log(
    `2 sales of 1 unit each -> stock ${stockBefore} -> ${stockAfter} (correct would be ${stockBefore - 2})`,
  );
  log(
    `sales_orders ${ordersBefore} -> ${ordersAfter} (correct would be ${ordersBefore + 2}); both PCs issued the same invoice number`,
  );
  assert.equal(stockAfter, stockBefore - 1, "one stock decrement lost");
  assert.equal(ordersAfter, ordersBefore + 1, "one order overwritten");
  await pcA.context().close();
  await pcB.context().close();
});

test("LIMIT-4 [known] npm audit reports a critical advisory for the installed `next`", async (t) => {
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const r = spawnSync(process.execPath, [npmCli, "audit", "--json"], { encoding: "utf8" });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    t.skip("npm audit unavailable (offline?)");
    return;
  }
  const next = report.vulnerabilities?.next;
  log(
    `next: severity=${next?.severity}; ${(next?.via || [])
      .filter((v) => typeof v === "object")
      .map((v) => v.title)
      .slice(0, 2)
      .join(" | ")}`,
  );
  assert.equal(next?.severity, "critical");
});
