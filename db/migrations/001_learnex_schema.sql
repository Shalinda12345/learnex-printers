-- =====================================================================
-- LEARNEX ERP — PostgreSQL schema
--
-- One table per app module, child tables for line items / payments.
-- Conventions used by every module table:
--   position  : the record's place in the app's list (the UI shows lists in
--               the order they were built — newest first for orders/ledger)
--   extra     : any field the app stores that has no dedicated column, or a
--               value whose type doesn't fit its column (e.g. a tax rate kept
--               as the text "8" from a form input). Nothing is ever dropped.
--
-- Cross-module references (customer_id, product_id, material_id, account,
-- ledger_txn_id, ...) are indexed but deliberately NOT foreign keys: the app
-- keeps history when a customer/product/supplier/account is deleted (old
-- orders still show its name), so a hard FK would block those deletes.
-- Child tables (line items, payments, credit bills) DO cascade with their
-- parent record.
-- =====================================================================

-- Which app modules have been saved at least once. A module with no row here
-- has never been saved, and the app starts it from its built-in demo data.
CREATE TABLE store_state (
  store          text PRIMARY KEY,
  initialized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- settings
CREATE TABLE business_settings (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name   text,
  tax_rate        numeric,
  opening_capital numeric,
  currency        text,
  notif_low_stock boolean,
  notif_overdue   boolean,
  notif_daily     boolean,
  extra           jsonb NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id         bigserial PRIMARY KEY,
  name       text,
  email      text,
  role       text,
  status     text,
  position   integer NOT NULL DEFAULT 0,
  extra      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ master data
CREATE TABLE cash_accounts (
  id         text PRIMARY KEY,               -- CASH-MAIN, BANK-MAIN, CASH-...
  name       text,
  type       text,                           -- Cash / Bank / Mobile Wallet / Petty Cash
  opening    numeric,                        -- opening balance
  purpose    text,
  system     boolean,                        -- built-in account
  notes      text,
  position   integer NOT NULL DEFAULT 0,
  extra      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id         bigint PRIMARY KEY,
  name       text,
  sku        text,
  category   text,
  price      numeric,                        -- selling price
  cost       numeric,                        -- unit cost
  stock      numeric,                        -- quantity on hand
  min_stock  numeric,                        -- reorder point ("min" in the app)
  unit       text,
  position   integer NOT NULL DEFAULT 0,
  extra      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_sku_idx ON products (sku);

CREATE TABLE customers (
  id          bigint PRIMARY KEY,
  name        text,
  contact     text,
  phone       text,
  email       text,
  tier        text,                          -- Retail / Wholesale
  orders      integer,                       -- number of orders placed
  spent       numeric,                       -- lifetime spend
  outstanding numeric,                       -- unpaid balance
  position    integer NOT NULL DEFAULT 0,
  extra       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id         bigint PRIMARY KEY,
  name       text,
  contact    text,
  phone      text,
  email      text,
  category   text,
  status     text,
  purchased  numeric,                        -- total purchased from this supplier
  last_order date,
  position   integer NOT NULL DEFAULT 0,
  extra      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw_materials (
  id                 bigint PRIMARY KEY,
  name               text,
  category           text,
  supplier_name      text,                   -- "supplier" in the app (by name)
  unit               text,
  purchase_qty       numeric,
  available_qty      numeric,
  cost_price         numeric,                -- weighted-average unit cost
  last_purchase_cost numeric,
  purchase_date      date,
  batch_number       text,
  notes              text,
  position           integer NOT NULL DEFAULT 0,
  extra              jsonb NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ ledger
CREATE TABLE ledger_entries (
  id          text PRIMARY KEY,              -- TXN-8821, ...
  date        date,
  description text,                          -- "desc" in the app
  type        text,                          -- Income / Expense
  category    text,
  amount      numeric,
  account     text,                          -- cash_accounts.id the money moved through
  kind        text,                          -- revenue / cogs / opex / transfer / ...
  cash        boolean,                       -- false = accrual, no cash moved
  attachment  jsonb,                         -- { name, type, dataUrl }
  position    integer NOT NULL DEFAULT 0,
  extra       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_date_idx ON ledger_entries (date);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account);
CREATE INDEX ledger_entries_kind_idx ON ledger_entries (kind);

-- ------------------------------------------------------------------- sales
CREATE TABLE sales_orders (
  id            text PRIMARY KEY,            -- SO-1042, ...
  invoice       text,                        -- INV-2461, ...
  customer_name text,
  customer_id   bigint,                      -- customers.id (null for walk-in)
  items         integer,                     -- total item count
  amount        numeric,                     -- order total incl. tax
  tax           numeric,
  status        text,                        -- Processing / Shipped / Delivered / Cancelled
  payment       text,                        -- Paid / Pending / Overdue / Refunded
  date          date,
  channel       text,                        -- POS / Manual / Delivery
  attachment    jsonb,
  amount_paid   numeric,
  accrued       boolean,
  is_credit     boolean,
  from_delivery text,                        -- delivery_runs.id for credit bills
  note          text,
  position      integer NOT NULL DEFAULT 0,
  extra         jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_orders_date_idx ON sales_orders (date);
CREATE INDEX sales_orders_customer_idx ON sales_orders (customer_id);
CREATE INDEX sales_orders_invoice_idx ON sales_orders (invoice);

CREATE TABLE sales_order_items (
  order_id        text NOT NULL REFERENCES sales_orders (id) ON DELETE CASCADE,
  line_no         integer NOT NULL,
  product_id      bigint,                    -- products.id
  name            text,
  qty             numeric,
  price           numeric,
  unit            text,
  available_stock numeric,
  extra           jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX sales_order_items_product_idx ON sales_order_items (product_id);

CREATE TABLE sales_order_payments (
  order_id text NOT NULL REFERENCES sales_orders (id) ON DELETE CASCADE,
  line_no  integer NOT NULL,
  date     date,
  amount   numeric,
  extra    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (order_id, line_no)
);

-- --------------------------------------------------------------- purchases
CREATE TABLE purchase_orders (
  id               text PRIMARY KEY,         -- PO-4001, ...
  supplier_name    text,
  supplier_id      bigint,                   -- suppliers.id
  items            integer,
  total            numeric,
  date             date,
  attachment       jsonb,
  payment_status   text,                     -- Paid / Unpaid / Partially Paid
  amount_paid      numeric,
  cash_account     text,                     -- cash_accounts.id
  topped_up_from   text,                     -- cash_accounts.id
  topped_up_amount numeric,
  ledger_txn_ids   text[],                   -- ledger_entries.id posted for this PO
  position         integer NOT NULL DEFAULT 0,
  extra            jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_date_idx ON purchase_orders (date);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id);

CREATE TABLE purchase_order_items (
  order_id    text NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  material_id bigint,                        -- raw_materials.id
  name        text,
  qty         numeric,
  cost        numeric,
  extra       jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX purchase_order_items_material_idx ON purchase_order_items (material_id);

CREATE TABLE raw_material_usage (
  id             text PRIMARY KEY,           -- USE-1001, ...
  date           date,
  material_id    bigint,                     -- raw_materials.id
  material_name  text,
  qty_used       numeric,
  remaining_qty  numeric,
  used_by        text,                       -- "user" in the app
  notes          text,
  consumed_value numeric,
  ledger_txn_id  text,                       -- ledger_entries.id
  position       integer NOT NULL DEFAULT 0,
  extra          jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_material_usage_material_idx ON raw_material_usage (material_id);
CREATE INDEX raw_material_usage_date_idx ON raw_material_usage (date);

-- ---------------------------------------------------------------- delivery
CREATE TABLE delivery_runs (
  id               text PRIMARY KEY,         -- DR-1001, ...
  date             date,
  status           text,                     -- Out / Completed
  total_taken      numeric,
  completed_date   date,
  sold_qty         numeric,
  sale_amount      numeric,
  cost_amount      numeric,
  daily_expense    numeric,
  profit           numeric,
  net_profit       numeric,
  ledger_txn_id    text,                     -- cash sale ledger entry
  credit_txn_id    text,                     -- credit sale ledger entry
  expense_txn_ids  text[],
  credit_amount    numeric,
  cash_collected   numeric,
  credit_order_ids text[],                   -- sales_orders.id created from credit bills
  position         integer NOT NULL DEFAULT 0,
  extra            jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_runs_date_idx ON delivery_runs (date);

CREATE TABLE delivery_run_items (
  run_id      text NOT NULL REFERENCES delivery_runs (id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  product_id  bigint,                        -- products.id
  name        text,
  price       numeric,
  cost        numeric,
  unit        text,
  taken       numeric,
  returned    numeric,
  sold        numeric,
  sale_amount numeric,
  avg_price   numeric,
  over_sold   boolean,                       -- "over" in the app
  sales       jsonb,                         -- [{ qty, price }] price breakdown
  extra       jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, line_no)
);
CREATE INDEX delivery_run_items_product_idx ON delivery_run_items (product_id);

CREATE TABLE delivery_credit_bills (
  run_id  text NOT NULL REFERENCES delivery_runs (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  shop    text,
  note    text,
  qty     numeric,
  total   numeric,
  items   jsonb,                             -- [{ productId, name, unit, cost, qty, price, lineTotal }]
  extra   jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, line_no)
);

-- --------------------------------------------------------- reporting views
-- Convenience joins for querying the data with SQL (the app doesn't use them).
CREATE VIEW v_sales_lines AS
SELECT o.id AS order_id, o.invoice, o.date, o.customer_id, o.customer_name, o.status, o.payment,
       i.line_no, i.product_id, COALESCE(p.name, i.name) AS product_name, p.sku,
       i.qty, i.price, i.qty * i.price AS line_total
FROM sales_orders o
JOIN sales_order_items i ON i.order_id = o.id
LEFT JOIN products p ON p.id = i.product_id;

CREATE VIEW v_purchase_lines AS
SELECT o.id AS order_id, o.date, o.supplier_id, o.supplier_name, o.payment_status,
       i.line_no, i.material_id, COALESCE(m.name, i.name) AS material_name,
       i.qty, i.cost, i.qty * i.cost AS line_total
FROM purchase_orders o
JOIN purchase_order_items i ON i.order_id = o.id
LEFT JOIN raw_materials m ON m.id = i.material_id;

CREATE VIEW v_ledger AS
SELECT l.id, l.date, l.description, l.type, l.category, l.kind, l.amount,
       CASE WHEN l.type = 'Income' THEN l.amount ELSE -l.amount END AS signed_amount,
       l.account, a.name AS account_name, l.cash
FROM ledger_entries l
LEFT JOIN cash_accounts a ON a.id = l.account;
