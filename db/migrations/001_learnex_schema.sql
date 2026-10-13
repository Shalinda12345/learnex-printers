-- =====================================================================
-- LEARNEX ERP — MySQL schema (MySQL 8.0.16+ or MariaDB 10.4+)
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
--
-- Column types:
--   text compares exactly (utf8mb4_bin), so ids "SO-1" and "so-1" stay apart;
--   amounts and quantities are DECIMAL(65,30); id lists are JSON arrays;
--   times are DATETIME(6) in UTC (the app's connections use time_zone +00:00).
-- =====================================================================

-- Which app modules have been saved at least once. A module with no row here
-- has never been saved, and the app starts it from its built-in demo data.
CREATE TABLE IF NOT EXISTS store_state (
  store          varchar(64) NOT NULL PRIMARY KEY,
  initialized_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS app_meta (
  `key`      varchar(64) NOT NULL PRIMARY KEY,
  value      json        NOT NULL,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS business_settings (
  id              smallint       NOT NULL DEFAULT 1 PRIMARY KEY CHECK (id = 1),
  business_name   text,
  tax_rate        decimal(65,30),
  opening_capital decimal(65,30),
  currency        text,
  notif_low_stock boolean,
  notif_overdue   boolean,
  notif_daily     boolean,
  extra           json           NOT NULL DEFAULT ('{}'),
  updated_at      datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS app_users (
  id         bigint      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       text,
  email      text,
  role       text,
  status     text,
  position   int         NOT NULL DEFAULT 0,
  extra      json        NOT NULL DEFAULT ('{}'),
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ------------------------------------------------------------ master data
CREATE TABLE IF NOT EXISTS cash_accounts (
  id         varchar(191)   NOT NULL PRIMARY KEY, -- CASH-MAIN, BANK-MAIN, CASH-...
  name       text,
  type       text,                                -- Cash / Bank / Mobile Wallet / Petty Cash
  opening    decimal(65,30),                      -- opening balance
  purpose    text,
  `system`   boolean,                             -- built-in account
  notes      text,
  position   int            NOT NULL DEFAULT 0,
  extra      json           NOT NULL DEFAULT ('{}'),
  created_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS products (
  id         bigint         NOT NULL PRIMARY KEY,
  name       text,
  sku        text,
  category   text,
  price      decimal(65,30),                      -- selling price
  cost       decimal(65,30),                      -- unit cost
  stock      decimal(65,30),                      -- quantity on hand
  min_stock  decimal(65,30),                      -- reorder point ("min" in the app)
  unit       text,
  position   int            NOT NULL DEFAULT 0,
  extra      json           NOT NULL DEFAULT ('{}'),
  created_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY products_sku_idx (sku(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS customers (
  id          bigint         NOT NULL PRIMARY KEY,
  name        text,
  contact     text,
  phone       text,
  email       text,
  tier        text,                               -- Retail / Wholesale
  orders      int,                                -- number of orders placed
  spent       decimal(65,30),                     -- lifetime spend
  outstanding decimal(65,30),                     -- unpaid balance
  position    int            NOT NULL DEFAULT 0,
  extra       json           NOT NULL DEFAULT ('{}'),
  created_at  datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS suppliers (
  id         bigint         NOT NULL PRIMARY KEY,
  name       text,
  contact    text,
  phone      text,
  email      text,
  category   text,
  status     text,
  purchased  decimal(65,30),                      -- total purchased from this supplier
  last_order date,
  position   int            NOT NULL DEFAULT 0,
  extra      json           NOT NULL DEFAULT ('{}'),
  created_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS raw_materials (
  id                 bigint         NOT NULL PRIMARY KEY,
  name               text,
  category           text,
  supplier_name      text,                        -- "supplier" in the app (by name)
  unit               text,
  purchase_qty       decimal(65,30),
  available_qty      decimal(65,30),
  cost_price         decimal(65,30),              -- weighted-average unit cost
  last_purchase_cost decimal(65,30),
  purchase_date      date,
  batch_number       text,
  notes              text,
  position           int            NOT NULL DEFAULT 0,
  extra              json           NOT NULL DEFAULT ('{}'),
  created_at         datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at         datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ------------------------------------------------------------------ ledger
CREATE TABLE IF NOT EXISTS ledger_entries (
  id          varchar(191)   NOT NULL PRIMARY KEY, -- TXN-8821, ...
  date        date,
  description text,                                -- "desc" in the app
  type        text,                                -- Income / Expense
  category    text,
  amount      decimal(65,30),
  account     text,                                -- cash_accounts.id the money moved through
  kind        text,                                -- revenue / cogs / opex / transfer / ...
  cash        boolean,                             -- false = accrual, no cash moved
  attachment  json,                                -- { name, type, dataUrl }
  position    int            NOT NULL DEFAULT 0,
  extra       json           NOT NULL DEFAULT ('{}'),
  created_at  datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ledger_entries_date_idx (date),
  KEY ledger_entries_account_idx (account(191)),
  KEY ledger_entries_kind_idx (kind(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ------------------------------------------------------------------- sales
CREATE TABLE IF NOT EXISTS sales_orders (
  id            varchar(191)   NOT NULL PRIMARY KEY, -- SO-1042, ...
  invoice       text,                                -- INV-2461, ...
  customer_name text,
  customer_id   bigint,                              -- customers.id (null for walk-in)
  items         int,                                 -- total item count
  amount        decimal(65,30),                      -- order total incl. tax
  tax           decimal(65,30),
  status        text,                                -- Processing / Shipped / Delivered / Cancelled
  payment       text,                                -- Paid / Pending / Overdue / Refunded
  date          date,
  channel       text,                                -- POS / Manual / Delivery
  attachment    json,
  amount_paid   decimal(65,30),
  accrued       boolean,
  is_credit     boolean,
  from_delivery text,                                -- delivery_runs.id for credit bills
  note          text,
  position      int            NOT NULL DEFAULT 0,
  extra         json           NOT NULL DEFAULT ('{}'),
  created_at    datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY sales_orders_date_idx (date),
  KEY sales_orders_customer_idx (customer_id),
  KEY sales_orders_invoice_idx (invoice(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sales_order_items (
  order_id        varchar(191)   NOT NULL,
  line_no         int            NOT NULL,
  product_id      bigint,                            -- products.id
  name            text,
  qty             decimal(65,30),
  price           decimal(65,30),
  unit            text,
  available_stock decimal(65,30),
  extra           json           NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (order_id, line_no),
  KEY sales_order_items_product_idx (product_id),
  CONSTRAINT sales_order_items_order_fk FOREIGN KEY (order_id) REFERENCES sales_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sales_order_payments (
  order_id varchar(191)   NOT NULL,
  line_no  int            NOT NULL,
  date     date,
  amount   decimal(65,30),
  extra    json           NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT sales_order_payments_order_fk FOREIGN KEY (order_id) REFERENCES sales_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------------- purchases
CREATE TABLE IF NOT EXISTS purchase_orders (
  id               varchar(191)   NOT NULL PRIMARY KEY, -- PO-4001, ...
  supplier_name    text,
  supplier_id      bigint,                              -- suppliers.id
  items            int,
  total            decimal(65,30),
  date             date,
  attachment       json,
  payment_status   text,                                -- Paid / Unpaid / Partially Paid
  amount_paid      decimal(65,30),
  cash_account     text,                                -- cash_accounts.id
  topped_up_from   text,                                -- cash_accounts.id
  topped_up_amount decimal(65,30),
  ledger_txn_ids   json,                                -- ledger_entries.id posted for this PO
  position         int            NOT NULL DEFAULT 0,
  extra            json           NOT NULL DEFAULT ('{}'),
  created_at       datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY purchase_orders_date_idx (date),
  KEY purchase_orders_supplier_idx (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  order_id    varchar(191)   NOT NULL,
  line_no     int            NOT NULL,
  material_id bigint,                                -- raw_materials.id
  name        text,
  qty         decimal(65,30),
  cost        decimal(65,30),
  extra       json           NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (order_id, line_no),
  KEY purchase_order_items_material_idx (material_id),
  CONSTRAINT purchase_order_items_order_fk FOREIGN KEY (order_id) REFERENCES purchase_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS raw_material_usage (
  id             varchar(191)   NOT NULL PRIMARY KEY, -- USE-1001, ...
  date           date,
  material_id    bigint,                              -- raw_materials.id
  material_name  text,
  qty_used       decimal(65,30),
  remaining_qty  decimal(65,30),
  used_by        text,                                -- "user" in the app
  notes          text,
  consumed_value decimal(65,30),
  ledger_txn_id  text,                                -- ledger_entries.id
  position       int            NOT NULL DEFAULT 0,
  extra          json           NOT NULL DEFAULT ('{}'),
  created_at     datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY raw_material_usage_material_idx (material_id),
  KEY raw_material_usage_date_idx (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ---------------------------------------------------------------- delivery
CREATE TABLE IF NOT EXISTS delivery_runs (
  id               varchar(191)   NOT NULL PRIMARY KEY, -- DR-1001, ...
  date             date,
  status           text,                                -- Out / Completed
  total_taken      decimal(65,30),
  completed_date   date,
  sold_qty         decimal(65,30),
  sale_amount      decimal(65,30),
  cost_amount      decimal(65,30),
  daily_expense    decimal(65,30),
  profit           decimal(65,30),
  net_profit       decimal(65,30),
  ledger_txn_id    text,                                -- cash sale ledger entry
  credit_txn_id    text,                                -- credit sale ledger entry
  expense_txn_ids  json,
  credit_amount    decimal(65,30),
  cash_collected   decimal(65,30),
  credit_order_ids json,                                -- sales_orders.id created from credit bills
  position         int            NOT NULL DEFAULT 0,
  extra            json           NOT NULL DEFAULT ('{}'),
  created_at       datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       datetime(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY delivery_runs_date_idx (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS delivery_run_items (
  run_id      varchar(191)   NOT NULL,
  line_no     int            NOT NULL,
  product_id  bigint,                                -- products.id
  name        text,
  price       decimal(65,30),
  cost        decimal(65,30),
  unit        text,
  taken       decimal(65,30),
  returned    decimal(65,30),
  sold        decimal(65,30),
  sale_amount decimal(65,30),
  avg_price   decimal(65,30),
  over_sold   boolean,                               -- "over" in the app
  sales       json,                                  -- [{ qty, price }] price breakdown
  extra       json           NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (run_id, line_no),
  KEY delivery_run_items_product_idx (product_id),
  CONSTRAINT delivery_run_items_run_fk FOREIGN KEY (run_id) REFERENCES delivery_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS delivery_credit_bills (
  run_id  varchar(191)   NOT NULL,
  line_no int            NOT NULL,
  shop    text,
  note    text,
  qty     decimal(65,30),
  total   decimal(65,30),
  items   json,                                      -- [{ productId, name, unit, cost, qty, price, lineTotal }]
  extra   json           NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (run_id, line_no),
  CONSTRAINT delivery_credit_bills_run_fk FOREIGN KEY (run_id) REFERENCES delivery_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------- reporting views
-- Convenience joins for querying the data with SQL (the app doesn't use them).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_sales_lines AS
SELECT o.id AS order_id, o.invoice, o.date, o.customer_id, o.customer_name, o.status, o.payment,
       i.line_no, i.product_id, COALESCE(p.name, i.name) AS product_name, p.sku,
       i.qty, i.price, i.qty * i.price AS line_total
FROM sales_orders o
JOIN sales_order_items i ON i.order_id = o.id
LEFT JOIN products p ON p.id = i.product_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_purchase_lines AS
SELECT o.id AS order_id, o.date, o.supplier_id, o.supplier_name, o.payment_status,
       i.line_no, i.material_id, COALESCE(m.name, i.name) AS material_name,
       i.qty, i.cost, i.qty * i.cost AS line_total
FROM purchase_orders o
JOIN purchase_order_items i ON i.order_id = o.id
LEFT JOIN raw_materials m ON m.id = i.material_id;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_ledger AS
SELECT l.id, l.date, l.description, l.type, l.category, l.kind, l.amount,
       CASE WHEN l.type = 'Income' THEN l.amount ELSE -l.amount END AS signed_amount,
       l.account, a.name AS account_name, l.cash
FROM ledger_entries l
LEFT JOIN cash_accounts a ON a.id = l.account;
