import "server-only";

/* =====================================================================
   How each app module ("store") maps onto the database.

   The app keeps every module as a plain JS value — a list of records, or
   one object for settings. Each record property listed here gets its own
   column; anything else (or a value whose type doesn't fit the column)
   goes into the row's `extra` jsonb, so a save → load round trip always
   gives back what the app stored.
===================================================================== */

export type ColumnType = "text" | "bigint" | "integer" | "numeric" | "boolean" | "date" | "jsonb" | "text[]";

export interface Column {
  prop: string; // property name in the app
  col: string; // column name in the table
  type: ColumnType;
}

export interface ChildList {
  prop: string; // array property on the parent record (e.g. lineItems)
  table: string;
  parentKey: string; // FK column pointing at the parent's id
  columns: Column[];
}

// A record's fields in the order the app builds them; child lists sit
// where the app puts them, so reloaded records keep the same key order.
export type Field = Column | { child: ChildList };

interface BaseStore {
  key: string; // module key in the app (e.g. "salesOrders")
  table: string;
  fields: Field[];
}
export interface ListStore extends BaseStore {
  kind: "list"; // keyed by `id`, synced record-by-record
  idType: "text" | "bigint";
}
export interface ReplaceStore extends BaseStore {
  kind: "replace"; // small list without ids, replaced as a whole (users)
}
export interface SingleStore extends BaseStore {
  kind: "single"; // one object (settings)
}
export type StoreDef = ListStore | ReplaceStore | SingleStore;

const c = (prop: string, type: ColumnType, col: string = toSnake(prop)): Column => ({ prop, col, type });
function toSnake(s: string) {
  return s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}

export const STORES: StoreDef[] = [
  {
    key: "products",
    table: "products",
    kind: "list",
    idType: "bigint",
    fields: [
      c("id", "bigint"),
      c("name", "text"),
      c("sku", "text"),
      c("category", "text"),
      c("price", "numeric"),
      c("cost", "numeric"),
      c("stock", "numeric"),
      c("min", "numeric", "min_stock"),
      c("unit", "text"),
    ],
  },
  {
    key: "customers",
    table: "customers",
    kind: "list",
    idType: "bigint",
    fields: [
      c("id", "bigint"),
      c("name", "text"),
      c("contact", "text"),
      c("phone", "text"),
      c("email", "text"),
      c("tier", "text"),
      c("orders", "integer"),
      c("spent", "numeric"),
      c("outstanding", "numeric"),
    ],
  },
  {
    key: "suppliers",
    table: "suppliers",
    kind: "list",
    idType: "bigint",
    fields: [
      c("id", "bigint"),
      c("name", "text"),
      c("contact", "text"),
      c("phone", "text"),
      c("email", "text"),
      c("category", "text"),
      c("purchased", "numeric"),
      c("lastOrder", "date"),
      c("status", "text"),
    ],
  },
  {
    key: "salesOrders",
    table: "sales_orders",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("invoice", "text"),
      c("customer", "text", "customer_name"),
      c("customerId", "bigint"),
      c("items", "integer"),
      {
        child: {
          prop: "lineItems",
          table: "sales_order_items",
          parentKey: "order_id",
          columns: [
            c("productId", "bigint"),
            c("name", "text"),
            c("qty", "numeric"),
            c("price", "numeric"),
            c("unit", "text"),
            c("availableStock", "numeric"),
          ],
        },
      },
      c("amount", "numeric"),
      c("tax", "numeric"),
      c("status", "text"),
      c("payment", "text"),
      c("date", "date"),
      c("channel", "text"),
      c("attachment", "jsonb"),
      c("amountPaid", "numeric"),
      {
        child: {
          prop: "payments",
          table: "sales_order_payments",
          parentKey: "order_id",
          columns: [c("date", "date"), c("amount", "numeric")],
        },
      },
      c("accrued", "boolean"),
      c("isCredit", "boolean"),
      c("fromDelivery", "text"),
      c("note", "text"),
    ],
  },
  {
    key: "purchaseOrders",
    table: "purchase_orders",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("supplier", "text", "supplier_name"),
      c("supplierId", "bigint"),
      c("items", "integer"),
      {
        child: {
          prop: "lineItems",
          table: "purchase_order_items",
          parentKey: "order_id",
          columns: [c("materialId", "bigint"), c("name", "text"), c("qty", "numeric"), c("cost", "numeric")],
        },
      },
      c("total", "numeric"),
      c("date", "date"),
      c("attachment", "jsonb"),
      c("paymentStatus", "text"),
      c("amountPaid", "numeric"),
      c("cashAccount", "text"),
      c("toppedUpFrom", "text"),
      c("toppedUpAmount", "numeric"),
      c("ledgerTxnIds", "text[]"),
    ],
  },
  {
    key: "rawMaterials",
    table: "raw_materials",
    kind: "list",
    idType: "bigint",
    fields: [
      c("id", "bigint"),
      c("name", "text"),
      c("category", "text"),
      c("supplier", "text", "supplier_name"),
      c("unit", "text"),
      c("purchaseQty", "numeric"),
      c("availableQty", "numeric"),
      c("costPrice", "numeric"),
      c("lastPurchaseCost", "numeric"),
      c("purchaseDate", "date"),
      c("batchNumber", "text"),
      c("notes", "text"),
    ],
  },
  {
    key: "rawMaterialUsage",
    table: "raw_material_usage",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("date", "date"),
      c("materialId", "bigint"),
      c("materialName", "text"),
      c("qtyUsed", "numeric"),
      c("remainingQty", "numeric"),
      c("user", "text", "used_by"),
      c("notes", "text"),
      c("consumedValue", "numeric"),
      c("ledgerTxnId", "text"),
    ],
  },
  {
    key: "deliveryRuns",
    table: "delivery_runs",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("date", "date"),
      c("status", "text"),
      {
        child: {
          prop: "lineItems",
          table: "delivery_run_items",
          parentKey: "run_id",
          columns: [
            c("productId", "bigint"),
            c("name", "text"),
            c("price", "numeric"),
            c("cost", "numeric"),
            c("unit", "text"),
            c("taken", "numeric"),
            c("returned", "numeric"),
            c("sales", "jsonb"),
            c("sold", "numeric"),
            c("saleAmount", "numeric"),
            c("avgPrice", "numeric"),
            c("over", "boolean", "over_sold"),
          ],
        },
      },
      c("totalTaken", "numeric"),
      c("completedDate", "date"),
      c("soldQty", "numeric"),
      c("saleAmount", "numeric"),
      c("costAmount", "numeric"),
      c("dailyExpense", "numeric"),
      c("profit", "numeric"),
      c("netProfit", "numeric"),
      c("ledgerTxnId", "text"),
      c("creditTxnId", "text"),
      c("expenseTxnIds", "text[]"),
      {
        child: {
          prop: "creditBills",
          table: "delivery_credit_bills",
          parentKey: "run_id",
          columns: [
            c("shop", "text"),
            c("note", "text"),
            c("items", "jsonb"),
            c("qty", "numeric"),
            c("total", "numeric"),
          ],
        },
      },
      c("creditAmount", "numeric"),
      c("cashCollected", "numeric"),
      c("creditOrderIds", "text[]"),
    ],
  },
  {
    key: "ledger",
    table: "ledger_entries",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("date", "date"),
      c("desc", "text", "description"),
      c("type", "text"),
      c("category", "text"),
      c("amount", "numeric"),
      c("account", "text"),
      c("kind", "text"),
      c("cash", "boolean"),
      c("attachment", "jsonb"),
    ],
  },
  {
    key: "cashAccounts",
    table: "cash_accounts",
    kind: "list",
    idType: "text",
    fields: [
      c("id", "text"),
      c("name", "text"),
      c("type", "text"),
      c("opening", "numeric"),
      c("purpose", "text"),
      c("system", "boolean"),
      c("notes", "text"),
    ],
  },
  {
    key: "settings",
    table: "business_settings",
    kind: "single",
    fields: [
      c("businessName", "text"),
      c("taxRate", "numeric"),
      c("openingCapital", "numeric"),
      c("currency", "text"),
      c("notifLowStock", "boolean"),
      c("notifOverdue", "boolean"),
      c("notifDaily", "boolean"),
    ],
  },
  {
    key: "users",
    table: "app_users",
    kind: "replace",
    fields: [c("name", "text"), c("email", "text"), c("role", "text"), c("status", "text")],
  },
];

export const STORE_BY_KEY = new Map(STORES.map((s) => [s.key, s]));
