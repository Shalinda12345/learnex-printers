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
| `npm run db:backup` | Encrypted copy of every table (needs `BACKUP_PASSPHRASE`); see *Backups*   |
| `npm run owner:recover -- NAME` | Get back in after a forgotten owner password or a lockout      |
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
account for 15 minutes. Anyone who knows a username could cause such a lock, so it is built not to trap the real
person: the count of wrong passwords is forgotten once a lock ends (or after 15 quiet minutes), so one guess an hour
never adds up; and a browser that has signed in to the account before carries a signed cookie (`learnex_device`)
that still lets it sign in while the account is locked (it has its own, higher limit of 25 wrong passwords, and
changing the password invalidates the cookie). A name that is not an account is counted and locked the same way,
so the answer never reveals which names exist. Requests to the sign-in endpoints are limited in size (16 KB).

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

**Locked out, or forgot the owner's password.** There is no "forgot password" e-mail, so the way back in is a
command run on a computer that can reach the database (it needs `DATABASE_URL` in `.env`, which is why it asks for
nothing else):

```
npm run owner:recover -- owner            # shows what it would do, changes nothing
npm run owner:recover -- owner --yes      # new one-time password, unlocks the account, ends its sessions
```

Add `--enable` for a disabled account, `--make-owner` to give the account the Owner role, `--reset-mfa` when the
authenticator phone is lost. The one-time password is printed once; the person must choose their own at the next
sign-in, and it stops working after 72 hours (`AUTH_TEMP_PASSWORD_HOURS`) like every one-time password an
administrator hands out. Every use is written to the activity log. For a locked account that is not the owner's,
Settings → Users → *Reset password* also works.

**Two-step sign-in (optional, each person's choice).** Account menu → *Two-step sign-in*: add the shown key to an
authenticator app (Google/Microsoft Authenticator, Authy, 1Password, ...), type the first code, and keep the eight
recovery codes. From then on sign-in asks for the 6-digit code after the password; five wrong codes pause it for
15 minutes, and a code works only once. It needs `AUTH_MFA_KEY` (a long random value) in the server's settings: the
authenticator secrets are stored encrypted with it, so a copy of the database alone cannot make codes. If the key
is removed later, people who use two-step cannot sign in until it is put back (it never lets them in without the
code). Lost phone: a recovery code, an administrator's *Reset two-step* (Settings → Users), or
`owner:recover --reset-mfa`. Using it is strongly recommended for the owner and administrators of an online install.

**Typing the password again.** Restoring a backup, clearing a module and the factory reset ask for the password
(and the authenticator code, if used) once more, and the server insists on it: a browser left open, or a stolen
session, cannot wipe the business with one click. The confirmation (`POST /api/auth/reauth`) is good for 5 minutes.

**Who may change what inside a module.** Saving is permitted per module, but some screens write to modules that
belong to another job (a sale lowers a product's stock; a purchase raises a supplier's total). Someone who does not
manage the module itself can therefore change only what their own job changes: stock of products, the totals of
customers and suppliers, raw material quantities and cost, and the *date* of existing ledger lines (they can add and
remove ledger lines, as cancelling an order requires, but not edit a line's amount or account). Prices, names,
and everything else are refused with "You don't have permission to change ...". The table is
`LIMITED_WRITES` in `lib/auth/permissions.ts`.

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
serverless instance opens its own connections; a small hosted database can run out of them). Also optional:
`AUTH_MFA_KEY` (switches on two-step sign-in, see above; 16+ random characters, never change it afterwards) and
`AUTH_TEMP_PASSWORD_HOURS` (how long a one-time password works, default 72). **Restrict the database login in the
alwaysdata panel to `SELECT, INSERT, UPDATE, DELETE`** once the tables exist (see *The database login* below). Do not set
`MYSQL_ADMIN_URL` there.

**Know the limits of serverless.** The sign-in throttle is kept in each instance's memory, so on Vercel it is a
speed bump, not a wall; the real protections are the per-account lockout (stored in the database) and the hashing
queue. Vercel also limits a request or response body to about 4.5 MB. So photos of bills are shrunk in the browser to
at most 1800 px (a JPEG of a few hundred KB) and refused above 2.5 MB; they are not sent with the records at
start-up but fetched when *View slip* is clicked. Restoring a big backup file in one go can still be refused
there: restore large backups against the database from a computer instead.

**The database login.** `npm run db:setup` gives the app's login only `SELECT, INSERT, UPDATE, DELETE` on its own
database (a `*_test` database gets every right, the tests rebuild it), and applies migrations with the administrator
login. So a bug in the app can change data but cannot drop or alter tables. On alwaysdata, create the login with
those rights only in the panel and keep the administrator login for the moments you run `db:setup`.

**Backups.** The in-app *Download backup* is a convenience, not a backup plan. `scripts/db-backup.mjs` copies
every table to a file (read-only; nothing in the database changes) and can prove that a restore worked:

```
npm run db:backup                                     # writes db-backups/<database>-<time>.json.enc (encrypted)
npm run db:restore -- db-backups/FILE.json.enc --to mysql://USER:PASS@HOST/EMPTY_DB   # into an EMPTY database
npm run db:verify  -- db-backups/FILE.json.enc        # compares the backup with DATABASE_URL (row counts + checksum)
```

Backups are encrypted (AES-256-GCM) with `BACKUP_PASSPHRASE` (12+ characters, in `.env` or the environment; keep a
copy of it in a password manager, *not* next to the backup files: without it a backup cannot be opened, by anyone).
`restore` and `verify` read encrypted and (`--plain`) unencrypted files; a wrong passphrase or a damaged file is
reported, never restored. `restore` refuses any database that already holds rows, so it can never overwrite data; create the empty
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
written: the page shows **Out of date** in the top bar and offers to reload. Two cashiers can therefore not silently
overwrite each other. The changes that were refused are **kept** (in the tab's session storage) and, after the
reload, merged into the fresh data (`lib/learnex/merge.js`): a number both of you changed (stock 10 → 9 here,
10 → 8 there) becomes 7; a field only one of you changed keeps that change; a sale whose number (SO-1043, INV-2462,
TXN-8822...) was taken by the other till is renumbered, with the ledger lines that mention it. If something cannot be
merged safely the page says so and asks the person to check their last entries. Requests without versions (a browser tab opened before an update) are accepted as before.
