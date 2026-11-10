// Database backup, restore and verification — plain Node, no mysqldump needed, so it works
// the same against XAMPP, alwaysdata or any MySQL/MariaDB the app can reach.
//
//   node --env-file=.env scripts/db-backup.mjs backup [file] [--plain]
//        Reads every table of DATABASE_URL (read-only: SELECTs inside one consistent snapshot)
//        and writes db-backups/<database>-<time>.json.enc. Nothing is changed in the database.
//        The file is ENCRYPTED (AES-256-GCM) with the passphrase in BACKUP_PASSPHRASE: it holds all
//        business data and staff password hashes, so it must not be readable by whoever finds a copy.
//        Keep the passphrase somewhere other than next to the backups; without it the file is
//        useless, to you as well. --plain writes an unencrypted .json instead (not recommended).
//
//   node --env-file=.env scripts/db-backup.mjs restore <file> --to <mysql-url>
//        Loads a backup into ANOTHER, EMPTY database whose tables already exist
//        (create them first: DATABASE_URL=<that url> npm run db:setup). It refuses a target that has
//        any rows in any table, so it can never overwrite data. Afterwards it runs `verify`.
//
//   node --env-file=.env scripts/db-backup.mjs verify <file> [--to <mysql-url>]
//        Compares every table of the backup with a database (default DATABASE_URL): row counts
//        and a checksum of the content. Exit code 1 when anything differs.
//
// restore and verify read encrypted and plain files alike (an encrypted one needs BACKUP_PASSPHRASE).
// The file holds ALL business data and the password hashes of your staff: keep it off GitHub
// (db-backups/ is in .gitignore) and store copies somewhere private. Live login sessions are not
// saved. Do a restore test into a scratch database now and then — a backup you never restored is
// only a hope. See "Backups" in the README.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

// auth_sessions: who is signed in right now, never worth restoring.
// schema_migrations: which migrations db-setup applied; it belongs to the database's schema, not its data,
// and a target prepared with db-setup already has its own rows there.
const SKIP_TABLES = new Set(["auth_sessions", "schema_migrations"]);
const FORMAT = "learnex-db-backup/1";

/* ---------------------------------------------------------------- encryption
   Encrypted file = "LXBK1" + salt(16) + iv(12) + AES-256-GCM ciphertext + auth tag(16).
   The key comes from the passphrase with scrypt; the tag makes a wrong passphrase, or a file
   that was changed or cut short, fail loudly instead of restoring garbage. */
const MAGIC = Buffer.from("LXBK1");
const keyFrom = (passphrase, salt) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

function passphraseOrThrow(why) {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) throw new Error(`${why} needs BACKUP_PASSPHRASE (at least 12 characters) in the environment or .env.`);
  return passphrase;
}

// A writable that encrypts what is written to it into `file`; end(cb) finishes the file with the auth tag.
function encryptInto(file, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
  file.write(Buffer.concat([MAGIC, salt, iv]));
  cipher.pipe(file, { end: false });
  const endCipher = cipher.end.bind(cipher);
  cipher.end = (done) => {
    cipher.once("end", () => file.end(cipher.getAuthTag(), done));
    endCipher();
    return cipher;
  };
  return cipher;
}

function decrypt(bytes, passphrase) {
  const salt = bytes.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const tag = bytes.subarray(bytes.length - 16);
  const body = bytes.subarray(MAGIC.length + 28, bytes.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the backup: wrong BACKUP_PASSPHRASE, or the file is damaged or incomplete.");
  }
}
const PAGE_ROWS = 500;
const BATCH_BYTES = 256 * 1024; // keep each INSERT well under max_allowed_packet

function connect(url) {
  return mysql.createConnection({
    uri: url,
    // exact text for everything: DECIMAL stays decimal text, DATE/DATETIME stay text, big ids stay text
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    jsonStrings: true,
    timezone: "Z",
    ...(process.env.DATABASE_SSL === "1" ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
const q = (name) => `\`${name.replace(/`/g, "``")}\``;

async function setUp(conn) {
  await conn.query("SET SESSION time_zone = '+00:00'");
}

/** Base tables of the connected database (not views), their writable columns and primary keys. */
async function describe(conn) {
  const [tables] = await conn.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const out = [];
  for (const { name } of tables) {
    if (SKIP_TABLES.has(name)) continue;
    const [cols] = await conn.query(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND extra NOT LIKE '%GENERATED%'
       ORDER BY ordinal_position`,
      [name],
    );
    const [pk] = await conn.query(
      `SELECT column_name AS name FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = 'PRIMARY'
       ORDER BY ordinal_position`,
      [name],
    );
    out.push({ name, columns: cols.map((c) => c.name), key: pk.map((c) => c.name) });
  }
  return out;
}

/** Every row of a table, a page at a time, as arrays of column values in column order. */
async function* readRows(conn, table) {
  const order = (table.key.length ? table.key : table.columns).map(q).join(", ");
  const cols = table.columns.map(q).join(", ");
  for (let offset = 0; ; offset += PAGE_ROWS) {
    const [rows] = await conn.query({
      sql: `SELECT ${cols} FROM ${q(table.name)} ORDER BY ${order} LIMIT ${PAGE_ROWS} OFFSET ${offset}`,
      rowsAsArray: true,
    });
    if (!rows.length) return;
    yield rows;
    if (rows.length < PAGE_ROWS) return;
  }
}

/** Row count and checksum of a table's content (what `verify` compares). */
async function fingerprint(conn, table) {
  const h = createHash("sha256");
  let rows = 0;
  for await (const page of readRows(conn, table)) {
    for (const row of page) h.update(JSON.stringify(row) + "\n");
    rows += page.length;
  }
  return { rows, sha256: h.digest("hex") };
}

const write = (stream, text) =>
  new Promise((resolve, reject) => stream.write(text, (e) => (e ? reject(e) : resolve())));

async function backup(fileArg, plain) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const passphrase = plain ? null : passphraseOrThrow("An encrypted backup (the default; or use --plain)");
  const conn = await connect(process.env.DATABASE_URL);
  try {
    await setUp(conn);
    // One snapshot for the whole dump, so the tables agree with each other even while the shop works.
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const [[{ db }]] = await conn.query("SELECT DATABASE() AS db");
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const file = fileArg || path.join("db-backups", `${db}-${stamp}.json${plain ? "" : ".enc"}`);
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const fileStream = createWriteStream(file, { flags: "wx" }); // never overwrite an existing backup
    await new Promise((resolve, reject) => fileStream.once("open", resolve).once("error", reject));
    const out = plain ? fileStream : encryptInto(fileStream, passphrase);

    const tables = await describe(conn);
    await write(out, `{"format":${JSON.stringify(FORMAT)},"database":${JSON.stringify(db)},"createdAt":${JSON.stringify(new Date().toISOString())},"tables":[`);
    const summary = [];
    for (const [i, table] of tables.entries()) {
      const h = createHash("sha256");
      let rows = 0;
      await write(out, `${i ? "," : ""}{"name":${JSON.stringify(table.name)},"columns":${JSON.stringify(table.columns)},"rows":[`);
      for await (const page of readRows(conn, table)) {
        let chunk = "";
        for (const row of page) {
          h.update(JSON.stringify(row) + "\n");
          chunk += (rows ? "," : "") + JSON.stringify(row);
          rows++;
        }
        await write(out, chunk);
      }
      await write(out, `],"count":${rows},"sha256":"${h.digest("hex")}"}`);
      summary.push([table.name, rows]);
    }
    await write(out, "]}\n");
    await new Promise((resolve) => out.end(resolve));
    await conn.query("ROLLBACK");
    console.log(`Backup written: ${file}`);
    for (const [name, n] of summary) console.log(`  ${name.padEnd(28)} ${n} rows`);
    console.log(
      plain
        ? "WARNING: this file is NOT encrypted. It contains all business data and staff password hashes; keep it private."
        : "Encrypted. Keep BACKUP_PASSPHRASE safe and apart from the file: without it the backup cannot be opened.",
    );
  } finally {
    await conn.end();
  }
}

function loadBackup(file) {
  const bytes = readFileSync(file);
  const text = bytes.subarray(0, MAGIC.length).equals(MAGIC)
    ? decrypt(bytes, passphraseOrThrow("This backup is encrypted, so opening it"))
    : bytes.toString("utf8");
  const data = JSON.parse(text);
  if (data.format !== FORMAT) throw new Error(`${file} is not a LEARNEX database backup.`);
  return data;
}

async function verify(file, url) {
  const data = loadBackup(file);
  const conn = await connect(url);
  let bad = 0;
  try {
    await setUp(conn);
    const have = new Map((await describe(conn)).map((t) => [t.name, t]));
    for (const t of data.tables) {
      const table = have.get(t.name);
      if (!table) {
        console.log(`  MISSING  ${t.name}: table not found in the database`);
        bad++;
        continue;
      }
      if (JSON.stringify(table.columns) !== JSON.stringify(t.columns)) {
        console.log(`  DIFFERS  ${t.name}: columns are not the same as in the backup`);
        bad++;
        continue;
      }
      const f = await fingerprint(conn, table);
      const same = f.rows === t.count && f.sha256 === t.sha256;
      if (!same) bad++;
      console.log(`  ${same ? "ok      " : "DIFFERS "} ${t.name}: ${f.rows} rows (backup ${t.count})`);
    }
  } finally {
    await conn.end();
  }
  console.log(bad ? `\nVERIFY FAILED: ${bad} table(s) differ.` : "\nVerified: every table matches the backup.");
  return bad === 0;
}

async function restore(file, url) {
  const data = loadBackup(file);
  const conn = await connect(url);
  try {
    await setUp(conn);
    const [[{ db }]] = await conn.query("SELECT DATABASE() AS db");
    const have = new Map((await describe(conn)).map((t) => [t.name, t]));
    // Never overwrite: every table must exist and be empty.
    for (const t of data.tables) {
      const table = have.get(t.name);
      if (!table) throw new Error(`Table ${t.name} does not exist in ${db}. Create the tables first (npm run db:setup).`);
      if (JSON.stringify(table.columns) !== JSON.stringify(t.columns))
        throw new Error(`Table ${t.name} in ${db} has different columns than the backup.`);
      const [[{ n }]] = await conn.query(`SELECT count(*) AS n FROM ${q(t.name)}`);
      if (Number(n) > 0)
        throw new Error(`Table ${t.name} in ${db} already holds ${n} rows. Restore only goes into an empty database; nothing was changed.`);
    }
    console.log(`Restoring ${data.tables.length} tables into ${db} ...`);
    await conn.query("SET FOREIGN_KEY_CHECKS = 0"); // the backup is consistent; order of tables doesn't matter
    await conn.beginTransaction();
    try {
      for (const t of data.tables) {
        const sql = `INSERT INTO ${q(t.name)} (${t.columns.map(q).join(", ")}) VALUES ?`;
        let batch = [];
        let size = 0;
        for (const row of t.rows) {
          const bytes = row.reduce((s, v) => s + (typeof v === "string" ? v.length : 8), 0);
          if (batch.length && size + bytes > BATCH_BYTES) {
            await conn.query(sql, [batch]);
            batch = [];
            size = 0;
          }
          batch.push(row);
          size += bytes;
        }
        if (batch.length) await conn.query(sql, [batch]);
        console.log(`  ${t.name.padEnd(28)} ${t.rows.length} rows`);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await conn.end();
  }
  console.log("\nChecking the restored data ...");
  return verify(file, url);
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(["--to"]); // the other flags (--plain) stand alone
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1]));

try {
  if (command === "backup") await backup(positional[0], rest.includes("--plain"));
  else if (command === "restore") {
    if (!positional[0] || !flag("--to")) throw new Error("Usage: restore <file> --to <mysql-url of an empty database>");
    process.exitCode = (await restore(positional[0], flag("--to"))) ? 0 : 1;
  } else if (command === "verify") {
    if (!positional[0]) throw new Error("Usage: verify <file> [--to <mysql-url>]");
    process.exitCode = (await verify(positional[0], flag("--to") || process.env.DATABASE_URL)) ? 0 : 1;
  } else {
    console.log("Usage: db-backup.mjs backup [file] [--plain] | restore <file> --to <url> | verify <file> [--to <url>]");
    process.exitCode = 2;
  }
} catch (e) {
  console.error("Error:", e.message);
  process.exitCode = 1;
}
