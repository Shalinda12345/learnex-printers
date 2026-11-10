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
It needs MySQL running and Chrome installed (no Chrome? set `TEST_BROWSER_CHANNEL=msedge` to use
Microsoft Edge instead). Pass file names to run only some suites, e.g.
`npm run test:db -- 06-sales 07-stock`. `10-statements` is the end-to-end suite for the four
financial statements (Profit or Loss, Financial Position, Cash Flows, Changes in Equity).

## Security settings

**Sign-in limits.** Each sign-in attempt costs the server about 0.3 s of CPU and 64 MB of memory (the password
hash), so attempts are limited: by default one client may try 20 times a minute (`AUTH_RATE_LIMIT`,
`AUTH_RATE_WINDOW_SECONDS` in `.env`; `0` switches the limit off). There is deliberately no limit shared by
everybody, since a stranger could use it up and block every real sign-in; instead at most 4 passwords are hashed at
once and the rest wait their turn. A client is told when to try again. On top of that, five wrong passwords lock an
account for 15 minutes (doubling each time, at most 1 hour, so a stranger cannot keep the owner out for long), and a name that is not an account is counted and locked the same way, so the answer never
reveals which names exist. Requests to the sign-in endpoints are limited in size (16 KB).

The client is identified by the `X-Forwarded-For` address. Next fills that header in only when the request does not
carry one, so when browsers connect to the app directly a client that sends its own header can pretend to be someone
else; the hashing queue is the backstop that cannot be avoided that way. Behind a reverse proxy
that sets the header, the address is reliable (`TRUST_PROXY_HOPS` = how many proxies are in front, default 1).

**HTTPS.** The app itself only speaks plain HTTP, so on a shop network passwords travel unencrypted. To fix that,
put a reverse proxy that handles HTTPS in front of it and let only the proxy reach the app. For example with
[Caddy](https://caddyserver.com) (not set up on this PC; the client PCs must trust Caddy's certificate authority):

```
shop.lan {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

and start the app on the local address only: `npm start -- -H 127.0.0.1`. Requests that arrive over HTTPS are
recognised (`X-Forwarded-Proto`): the session cookie becomes Secure and `__Host-`prefixed, and the app sends
`Strict-Transport-Security`. Once the proxy works, set `AUTH_REQUIRE_HTTPS=1` in `.env`: sign-in and password
changes are then refused over plain HTTP. Every response already carries `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` and, for pages, a `Content-Security-Policy` with a per-request nonce
(`proxy.ts`).

**What is checked on saved data.** The browser works out every figure, so the server refuses values that can never
be right from any account that cannot restore a backup: negative prices, costs, totals or stock, an order paid
for more than it is worth, dates before 2000 or more than a month ahead (`lib/server/learnex/sanity.ts`). Replacing
or emptying a whole module in one request needs the *Restore & import* or *Clear & factory reset* permission.

## Running it online (Vercel + alwaysdata) and operations

**What a deploy does and does not do.** Merging to the branch Vercel builds only replaces the *code*. It never
touches the database: no migration runs, no data is read or written during the build. Schema changes
(`db/migrations/*.sql`) are applied by hand with `npm run db:setup` and are written to be repeatable and
additive (`CREATE TABLE IF NOT EXISTS`). The current release needs **no** schema change.

**Settings in Vercel (Project → Settings → Environment Variables).** `DATABASE_URL` (the app's own alwaysdata
login, never the admin login), `AUTH_REQUIRE_HTTPS=1` (Vercel serves HTTPS, so passwords are refused over plain
HTTP), `TRUST_PROXY_HOPS=1`, and `AUTH_SETUP_CODE` only while no owner account exists. Optional:
`DATABASE_SSL=1` (encrypt the Vercel→alwaysdata connection and check the certificate; turn it on once you have
confirmed alwaysdata offers TLS for your database, or sign-in will fail) and `DATABASE_POOL_SIZE=3` (every running
serverless instance opens its own connections; a small hosted database can run out of them). Do not set
`MYSQL_ADMIN_URL` there.

**Know the limits of serverless.** The sign-in throttle is kept in each instance's memory, so on Vercel it is a
speed bump, not a wall; the real protections are the per-account lockout (stored in the database) and the hashing
queue. Vercel also limits a request body to about 4.5 MB, so restoring a big backup file, or saving many photos in
one go, can be refused there even though the app itself allows more; restore large backups against the database
from a computer instead.

**Backups.** The in-app *Download backup* is a convenience, not a backup plan. `scripts/db-backup.mjs` copies
every table to a file (read-only; nothing in the database changes) and can prove that a restore worked:

```
npm run db:backup                                     # writes db-backups/<database>-<time>.json
npm run db:restore -- db-backups/FILE.json --to mysql://USER:PASS@HOST/EMPTY_DB   # into an EMPTY database
npm run db:verify  -- db-backups/FILE.json            # compares the backup with DATABASE_URL (row counts + checksum)
```

`restore` refuses any database that already holds rows, so it can never overwrite data; create the empty
database's tables first (`DATABASE_URL=<that url> npm run db:setup`). Practise once: back up, restore into a scratch
database, check the output says *every table matches*, then drop the scratch database. Backup files contain all
business data and the staff's password hashes: they are in `.gitignore`, keep copies somewhere private and
off the server. Also check what alwaysdata's own backup service covers, and keep both.

**Monitoring.** `GET /api/health` returns `200 {"ok":true}` when the app can reach its database and `503` when
not, and nothing else. Point an uptime monitor (UptimeRobot, Better Stack, ...) at it. Errors are written to the
Vercel function logs (Project → Logs); passwords and tokens are never logged.

**If something goes wrong.**
- *Site down, `/api/health` 503:* the database is unreachable or refusing the login. Check the alwaysdata
  panel (service up? password changed? connection limit reached?) and `DATABASE_URL` in Vercel.
- *Bad deploy:* Vercel → Deployments → pick the last good one → *Promote to Production*. The database is not
  touched by deploys, so a rollback is instant and safe.
- *Data damaged or deleted:* stop staff working, restore the newest good backup into a scratch database, `verify`
  it, and copy back only what is needed. Every change is in the activity log (old and new values).
- *A secret leaked (database password, setup code):* change it in alwaysdata, update `DATABASE_URL` in Vercel,
  redeploy; if staff passwords may be exposed, reset them in Settings → Users (this signs them out everywhere).

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
scripts/                db:setup, db-backup (backup / restore / verify) and the database test runner
tests/                  Database/API/UI suites (tests/*.test.mjs) and unit tests (tests/unit)
```

### The interface

- **Styling** is Tailwind CSS v4. `app/globals.css` holds the design tokens (type, radius, shadows, accent
  shades), element defaults and the shared classes (`.btn`, `.btn-primary`, `.card`, `.input`, ...). Dark mode is a
  `.dark` class on the app root; the choice (and whether the menu is collapsed) is remembered in the browser.
- **Shared pieces** live in `components/learnex/ui.jsx` (dialogs, form fields, badges, summary cards, empty states,
  alerts, tabs, toasts). `gate.jsx` styles the screens shown before sign-in; `CommandPalette.jsx` is the search
  box in the top bar.
- **Keyboard:** `Ctrl+K` (or `/`) opens the search, which jumps to any screen or record; `Esc` closes dialogs
  and menus; in the POS, `Enter` in the search box adds the product whose SKU matches (what a barcode scanner sends).
- The browser tests find things by a few class names and exact label texts (see the helpers at the end of
  `tests/helpers.mjs`). When restyling, keep those, or update the helpers with the change.

### How data is saved

Each module (products, sales orders, ledger, ...) lives in React state in the browser. Changes are
diffed and sent to `/api/learnex/sync`, which saves them in one transaction and records them in the
activity log. The server checks the signed-in user's permissions on every request; see
`lib/learnex/persistence.js` and `lib/server/learnex/repository.ts`.

**Two people at once.** Every saved record has a version (its `updated_at`, which exists on every table, so
no schema change was needed). `/api/learnex/data` returns the version of each record; each save sends back the
versions it started from (`base`) and the ids it believes are new (`creates`). If someone else changed or deleted
a record meanwhile, or already used a new record's id, the whole save is refused with `409 conflict` and nothing is
written: the page shows **Out of date** in the top bar and offers to reload. So two cashiers can no longer
silently overwrite each other's sale or sell the same stock twice; the one who loses reloads and repeats the
sale. Requests without versions (a browser tab opened before an update) are accepted as before.
