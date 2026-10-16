# LEARNEX ERP

Business management app for LEARNEX Printers & Distributors: point of sale, inventory, sales and
purchase orders, raw materials, delivery runs, cash & bank accounts, accounting statements and
reports, with staff accounts and role-based permissions.

Built with Next.js (App Router) and MySQL / MariaDB.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill it in. It explains each setting: the database login,
   an administrator login used only for setup, and the one-time code for creating the owner account.

3. Create the database user and schema (applies everything in `db/migrations`):

   ```bash
   npm run db:setup
   ```

4. Start the app and open [http://localhost:3000](http://localhost:3000):

   ```bash
   npm run dev
   ```

   On first run you create the owner account with the `AUTH_SETUP_CODE` from `.env`, then import
   existing data (from a backup file, an old data folder, or this browser's old storage) or start
   from the demo data.

## Scripts

| Command             | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run dev`       | Development server                                                         |
| `npm run build`     | Production build                                                           |
| `npm start`         | Serve the production build                                                 |
| `npm run lint`      | ESLint                                                                     |
| `npm run db:setup`  | Create the MySQL user/database and apply pending migrations                |
| `npm run test:unit` | Unit tests for the accounting, backup, invoice, permission and utility code |
| `npm run test:db`   | Full suite: database, API and browser tests against a `*_test` database    |

`npm run test:db` builds the app, then runs it against a separate database whose name must end in
`_test`. **The tests wipe that database.** By default it is `DATABASE_URL` + `_test`; set
`TEST_DATABASE_URL` to keep it on a local server when `DATABASE_URL` points at a hosted database.
It needs MySQL running and Chrome installed. Pass file names to run only some suites, e.g.
`npm run test:db -- 06-sales 07-stock`.

## Project layout

```
app/                    Next.js app: the single page and the JSON API (app/api/*)
components/learnex/     The ERP's UI
  BootGate.jsx          Start-up flow: sign in, first-run setup, one-time data import
  LearnexERP.jsx        App shell (sidebar, header) and the shared data stores
  modules/              One screen per sidebar item (POS, Inventory, Accounting, ...)
  ui.jsx, charts.jsx,   Shared building blocks, charts and icons
  icons.jsx
lib/
  auth/permissions.ts   Permissions, built-in roles, and which screens/modules each needs
  learnex/              Browser-side logic: accounting engine, persistence, backup, helpers
  server/               Server-only code: database pool, sessions, user admin, data repository
db/migrations/          SQL schema, applied in filename order by db:setup
scripts/                db:setup and the database test runner
tests/                  Database/API/UI suites (tests/*.test.mjs) and unit tests (tests/unit)
```

### How data is saved

Each module (products, sales orders, ledger, ...) lives in React state in the browser. Changes are
diffed and sent to `/api/learnex/sync`, which saves them in one transaction and records them in the
activity log. The server checks the signed-in user's permissions on every request; see
`lib/learnex/persistence.js` and `lib/server/learnex/repository.ts`.
