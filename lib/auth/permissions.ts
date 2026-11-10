/* =====================================================================
   PERMISSION CATALOG — shared by the server (enforcement) and the app
   (role editor, menus).

   A permission is a business capability ("pos.use"), not a table. Roles
   (stored in the database) are named sets of these keys. Adding a new
   capability later means adding a key here; existing roles keep working
   and the Owner role gets it automatically.

   Today the app saves whole modules from the browser, so each capability
   also lists the modules ("stores") its screens read and write — taken
   from what each screen's code actually reads and changes. The server
   uses this to decide which modules a user may load and save.
===================================================================== */

export const STORE_KEYS = [
  "products",
  "customers",
  "suppliers",
  "salesOrders",
  "purchaseOrders",
  "rawMaterials",
  "rawMaterialUsage",
  "deliveryRuns",
  "ledger",
  "cashAccounts",
  "settings",
  "users",
] as const;
export type StoreKey = (typeof STORE_KEYS)[number];

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  read?: readonly StoreKey[];
  write?: readonly StoreKey[];
}

const ALL_STORES = STORE_KEYS;
const BUSINESS_STORES = STORE_KEYS.filter((s) => s !== "users");

export const PERMISSIONS: PermissionDef[] = [
  {
    key: "dashboard.view",
    group: "Overview",
    label: "Dashboard",
    description: "See the dashboard: sales, profit, stock and cash figures.",
    read: [
      "products",
      "salesOrders",
      "ledger",
      "rawMaterials",
      "rawMaterialUsage",
      "deliveryRuns",
      "cashAccounts",
      "purchaseOrders",
    ],
  },
  {
    key: "pos.use",
    group: "Sales",
    label: "Point of Sale",
    description: "Ring up sales at the POS (updates stock, customers and the ledger).",
    read: ["products", "customers", "salesOrders", "ledger", "cashAccounts"],
    write: ["products", "salesOrders", "customers", "ledger"],
  },
  {
    key: "sales.manage",
    group: "Sales",
    label: "Sales orders",
    description: "Create, edit and delete sales orders and record customer payments.",
    read: ["salesOrders", "products", "customers", "ledger"],
    write: ["salesOrders", "customers", "ledger", "products"],
  },
  {
    key: "customers.manage",
    group: "Sales",
    label: "Customers",
    description: "Add, edit and delete customers.",
    read: ["customers"],
    write: ["customers"],
  },
  {
    key: "delivery.manage",
    group: "Sales",
    label: "Delivery stock",
    description: "Send out and close delivery runs (updates stock, sales and the ledger).",
    read: ["products", "deliveryRuns", "ledger", "salesOrders"],
    write: ["ledger", "salesOrders", "deliveryRuns", "products"],
  },
  {
    key: "inventory.manage",
    group: "Stock",
    label: "Products & inventory",
    description: "Add, edit and delete products, prices and stock levels.",
    read: ["products"],
    write: ["products"],
  },
  {
    key: "purchases.manage",
    group: "Stock",
    label: "Purchases",
    description: "Create and pay purchase orders (updates raw materials, suppliers and the ledger).",
    read: ["purchaseOrders", "rawMaterials", "suppliers", "ledger", "cashAccounts"],
    write: ["rawMaterials", "suppliers", "purchaseOrders", "ledger"],
  },
  {
    key: "rawMaterials.manage",
    group: "Stock",
    label: "Raw materials",
    description: "Manage raw materials and record material usage.",
    read: ["rawMaterials", "rawMaterialUsage", "suppliers", "ledger"],
    write: ["rawMaterials", "ledger", "rawMaterialUsage"],
  },
  {
    key: "suppliers.manage",
    group: "Stock",
    label: "Suppliers",
    description: "Add, edit and delete suppliers.",
    read: ["suppliers"],
    write: ["suppliers"],
  },
  {
    key: "cash.manage",
    group: "Finance",
    label: "Cash & bank",
    description: "Manage cash and bank accounts, transfers and deposits.",
    read: ["cashAccounts", "ledger", "purchaseOrders", "salesOrders"],
    write: ["ledger", "cashAccounts"],
  },
  {
    key: "accounting.manage",
    group: "Finance",
    label: "Accounting",
    description: "Use the ledger and see the profit & loss and financial position statements.",
    read: [
      "ledger",
      "customers",
      "cashAccounts",
      "salesOrders",
      "purchaseOrders",
      "deliveryRuns",
      "products",
      "rawMaterials",
    ],
    write: ["ledger"],
  },
  {
    key: "reports.view",
    group: "Finance",
    label: "Reports",
    description: "View and export every report.",
    read: BUSINESS_STORES,
  },
  {
    key: "settings.manage",
    group: "Administration",
    label: "Business settings",
    description: "Change the business profile, tax rate, currency and notifications.",
    write: ["settings"],
  },
  {
    key: "users.manage",
    group: "Administration",
    label: "User accounts",
    description: "Add staff accounts, assign roles, reset passwords and disable accounts.",
    read: ["users"],
    write: ["users"],
  },
  {
    key: "roles.manage",
    group: "Administration",
    label: "Roles & permissions",
    description: "Create roles and choose what each role is allowed to do.",
  },
  {
    key: "audit.view",
    group: "Administration",
    label: "Activity log",
    description: "See who signed in and who changed what, and when.",
  },
  {
    key: "data.backup",
    group: "Data",
    label: "Download backups",
    description: "Download a backup file containing all business data.",
    read: ALL_STORES,
  },
  {
    key: "data.restore",
    group: "Data",
    label: "Restore & import",
    description: "Replace data from a backup file or import existing data.",
    read: ALL_STORES,
    write: ALL_STORES,
  },
  {
    key: "data.reset",
    group: "Data",
    label: "Clear & factory reset",
    description: "Delete all records of a module, or everything (factory reset).",
    read: ALL_STORES,
    write: ALL_STORES,
  },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));
export const isPermission = (key: string) => BY_KEY.has(key);

/**
 * Write access to a module is by module, but several screens write to modules that belong to
 * somebody else's job: a sale lowers a product's stock and raises a customer's total, a purchase
 * adds to a supplier's total and a raw material's quantity. Those roles must not be able to do
 * more than that, or a cashier could change prices by calling the API directly.
 *
 * For each module below, someone who holds none of the `full` permissions may only:
 *   - add records (`create`) and remove records (`remove`), if the flags say so, and
 *   - change the listed `fields` of records that already exist; every other field must stay as it is.
 * (Restore and factory reset count as full control.) What each field list holds was taken from
 * what the screens of the other roles really change.
 */
export interface LimitedWrite {
  full: readonly string[];
  create: boolean;
  remove: boolean;
  fields: readonly string[];
}
export const LIMITED_WRITES: Partial<Record<StoreKey, LimitedWrite>> = {
  products: { full: ["inventory.manage"], create: false, remove: false, fields: ["stock"] },
  customers: { full: ["customers.manage"], create: false, remove: false, fields: ["orders", "spent", "outstanding"] },
  suppliers: { full: ["suppliers.manage"], create: false, remove: false, fields: ["purchased", "lastOrder"] },
  rawMaterials: {
    full: ["rawMaterials.manage"],
    create: false,
    remove: false,
    fields: ["purchaseQty", "availableQty", "costPrice", "lastPurchaseCost"],
  },
  // Sales, purchases, deliveries and material usage add ledger lines and take their own back when an
  // order is cancelled; only the books themselves (accounting, cash) may edit a line's figures.
  ledger: { full: ["accounting.manage", "cash.manage"], create: true, remove: true, fields: ["date"] },
};

/** The modules these permissions have full control of: every module without a limit, plus those whose `full` permission is held. */
export function fullStoresFor(permissions: Iterable<string>): Set<StoreKey> {
  const held = new Set(permissions);
  return new Set(
    STORE_KEYS.filter((store) => {
      const rule = LIMITED_WRITES[store];
      return !rule || rule.full.some((p) => held.has(p));
    }),
  );
}

/**
 * Holding either of these lets someone replace or empty a whole module in one
 * request (restore a backup, "Clear a Specific Module"). Write access to a
 * module is not enough: without one of them records can only be added, changed
 * and deleted a few at a time.
 */
export const WHOLE_MODULE_PERMISSIONS = ["data.restore", "data.reset"] as const;

export type StoreAccess = "read" | "write";

/** Which modules a set of permissions may load ("read") or also save ("write"). */
export function storeAccessFor(permissions: Iterable<string>): Partial<Record<StoreKey, StoreAccess>> {
  // Everyone needs the business settings (name, currency, tax rate) to use the app.
  const access: Partial<Record<StoreKey, StoreAccess>> = { settings: "read" };
  for (const key of permissions) {
    const p = BY_KEY.get(key);
    if (!p) continue;
    for (const s of p.read ?? []) if (!access[s]) access[s] = "read";
    for (const s of p.write ?? []) access[s] = "write"; // saving a module implies loading it
  }
  return access;
}

/* --------------------------------------------------------- default roles */

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[]; // ignored for the owner, who always has everything
}

export const OWNER_ROLE_KEY = "owner";

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: OWNER_ROLE_KEY,
    name: "Owner",
    description: "Full access to everything, including factory reset. Can't be changed.",
    isSystem: true,
    permissions: [],
  },
  {
    key: "administrator",
    name: "Administrator",
    description:
      "Runs the whole system day to day: every module, staff accounts and roles. No factory reset.",
    isSystem: false,
    permissions: PERMISSION_KEYS.filter((k) => k !== "data.reset"),
  },
  {
    key: "sales",
    name: "Sales & POS",
    description: "Front counter: POS, sales orders, customers and delivery runs.",
    isSystem: false,
    permissions: ["pos.use", "sales.manage", "customers.manage", "delivery.manage"],
  },
  {
    key: "inventory",
    name: "Inventory Manager",
    description: "Stock: products, purchases, raw materials and suppliers.",
    isSystem: false,
    permissions: ["inventory.manage", "purchases.manage", "rawMaterials.manage", "suppliers.manage"],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Finance: dashboard, cash & bank, accounting, reports and backups.",
    isSystem: false,
    permissions: ["dashboard.view", "cash.manage", "accounting.manage", "reports.view", "data.backup"],
  },
];

/* ------------------------------------------------ app menu → permission */

/** The permission(s) that open each screen in the app's menu (any one is enough). */
export const SCREEN_PERMISSIONS: Record<string, string[]> = {
  dashboard: ["dashboard.view"],
  pos: ["pos.use"],
  inventory: ["inventory.manage"],
  sales: ["sales.manage"],
  purchases: ["purchases.manage"],
  rawmaterials: ["rawMaterials.manage"],
  delivery: ["delivery.manage"],
  customers: ["customers.manage"],
  suppliers: ["suppliers.manage"],
  cash: ["cash.manage"],
  accounting: ["accounting.manage"],
  reports: ["reports.view"],
  settings: [
    "settings.manage",
    "users.manage",
    "roles.manage",
    "audit.view",
    "data.backup",
    "data.restore",
    "data.reset",
  ],
};

/** Human names of the modules, for messages. */
export const STORE_LABELS: Record<StoreKey, string> = {
  products: "Products & Inventory",
  customers: "Customers",
  suppliers: "Suppliers",
  salesOrders: "Sales Orders",
  purchaseOrders: "Purchase Orders",
  rawMaterials: "Raw Materials",
  rawMaterialUsage: "Raw Material Usage",
  deliveryRuns: "Delivery Runs",
  ledger: "Accounting Ledger",
  cashAccounts: "Cash & Bank Accounts",
  settings: "Business Settings",
  users: "Users list",
};
