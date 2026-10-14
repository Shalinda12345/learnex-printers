// Unit tests for the permission catalog (lib/auth/permissions.ts), which both
// the server (enforcement) and the app (menus, role editor) rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORE_KEYS,
  STORE_LABELS,
  PERMISSIONS,
  PERMISSION_KEYS,
  isPermission,
  storeAccessFor,
  DEFAULT_ROLES,
  OWNER_ROLE_KEY,
  SCREEN_PERMISSIONS,
} from "@/lib/auth/permissions";

test("PERM-1 every permission has a unique key, a group, a label and a description", () => {
  assert.equal(new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length);
  for (const p of PERMISSIONS) assert.ok(p.key && p.group && p.label && p.description, p.key);
  assert.equal(isPermission("pos.use"), true);
  assert.equal(isPermission("pos.hack"), false);
});

test("PERM-2 permissions only name modules that exist", () => {
  for (const p of PERMISSIONS)
    for (const s of [...(p.read ?? []), ...(p.write ?? [])])
      assert.ok(STORE_KEYS.includes(s), `${p.key}: ${s}`);
});

test("PERM-3 no permissions: only the business settings can be loaded (read-only)", () => {
  assert.deepEqual(storeAccessFor([]), { settings: "read" });
});

test("PERM-4 saving a module implies loading it; read-only modules stay read-only", () => {
  const a = storeAccessFor(["pos.use"]);
  assert.deepEqual(a, {
    settings: "read",
    products: "write",
    customers: "write",
    salesOrders: "write",
    ledger: "write",
    cashAccounts: "read",
  });
});

test("PERM-5 a write from one permission is never downgraded by a read from another, in any order", () => {
  for (const order of [
    ["dashboard.view", "inventory.manage"],
    ["inventory.manage", "dashboard.view"],
  ]) {
    assert.equal(storeAccessFor(order).products, "write", order.join(" + "));
  }
  assert.equal(storeAccessFor(["settings.manage"]).settings, "write");
});

test("PERM-6 unknown permission keys are ignored", () => {
  assert.deepEqual(storeAccessFor(["nope", "also.nope"]), { settings: "read" });
});

test("PERM-7 every permission together gives write access to every module", () => {
  const a = storeAccessFor(PERMISSION_KEYS);
  assert.deepEqual(Object.keys(a).sort(), [...STORE_KEYS].sort());
  assert.ok(Object.values(a).every((v) => v === "write"));
});

test("PERM-8 default roles: the owner is a system role; the administrator can do everything except factory reset", () => {
  assert.deepEqual(
    DEFAULT_ROLES.map((r) => r.key),
    [OWNER_ROLE_KEY, "administrator", "sales", "inventory", "accountant"],
  );
  assert.equal(DEFAULT_ROLES[0].isSystem, true);
  assert.ok(DEFAULT_ROLES.slice(1).every((r) => !r.isSystem));
  const admin = DEFAULT_ROLES.find((r) => r.key === "administrator");
  assert.deepEqual(
    PERMISSION_KEYS.filter((k) => !admin.permissions.includes(k)),
    ["data.reset"],
  );
  for (const r of DEFAULT_ROLES) for (const k of r.permissions) assert.ok(isPermission(k), `${r.key}: ${k}`);
});

test("PERM-9 every screen in the menu is opened by real permissions", () => {
  assert.deepEqual(Object.keys(SCREEN_PERMISSIONS), [
    "dashboard",
    "pos",
    "inventory",
    "sales",
    "purchases",
    "rawmaterials",
    "delivery",
    "customers",
    "suppliers",
    "cash",
    "accounting",
    "reports",
    "settings",
  ]);
  for (const [screen, keys] of Object.entries(SCREEN_PERMISSIONS))
    for (const k of keys) assert.ok(isPermission(k), `${screen}: ${k}`);
});

test("PERM-10 every module has a human-readable name for messages", () => {
  assert.deepEqual(Object.keys(STORE_LABELS).sort(), [...STORE_KEYS].sort());
});
