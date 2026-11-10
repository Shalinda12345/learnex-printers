// Gets someone back into the system when nobody can sign in for them: a forgotten owner
// password, an owner account that is locked or disabled, or a lost authenticator phone.
//
//   npm run owner:recover -- <username-or-email>                      shows what it would do
//   npm run owner:recover -- <username-or-email> --yes                resets the password
//   options (with --yes):  --enable        also turn a disabled account back on
//                          --make-owner    also give the account the Owner role
//                          --reset-mfa     also remove its two-step sign-in (lost phone)
//
// It needs DATABASE_URL (in .env, or in the environment) to reach the database, so it is the
// one tool that works when the app itself cannot be used. Anybody who can run it already has
// the database password, which is why it asks nothing else. It prints a one-time password
// ONCE: hand it over, and the person must choose their own at the next sign-in (it stops
// working after AUTH_TEMP_PASSWORD_HOURS, 72 by default). The account is unlocked and all of
// its sessions are ended. Every use is written to the activity log.
import { randomInt } from "node:crypto";
import mysql from "mysql2/promise";
import { hashPassword } from "../lib/auth/password-hash.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const who = args.find((a) => !a.startsWith("--"));
const yes = flags.has("--yes");

if (!who) {
  console.error("Usage: npm run owner:recover -- <username-or-email> [--yes] [--enable] [--make-owner] [--reset-mfa]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (see .env).");
  process.exit(1);
}

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const group = () => Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");

const target = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  dateStrings: true,
  timezone: "Z",
  ...(process.env.DATABASE_SSL === "1" ? { ssl: { rejectUnauthorized: true } } : {}),
});

try {
  await conn.query("SET SESSION time_zone = '+00:00'");
  console.log(`Database: ${target.hostname}${target.port ? ":" + target.port : ""}${target.pathname}`);
  const [found] = await conn.query(
    `SELECT id, username, name, email, status, failed_login_count, locked_until, must_change_password
     FROM auth_users WHERE username_key = lower(?) OR email_key = lower(?)
     ORDER BY username_key = lower(?) DESC LIMIT 1`,
    [who, who, who],
  );
  const user = found[0];
  if (!user) {
    const [owners] = await conn.query(
      `SELECT u.username, u.status FROM auth_users u
       JOIN auth_user_roles ur ON ur.user_id = u.id JOIN auth_roles r ON r.id = ur.role_id
       WHERE r.\`key\` = 'owner' ORDER BY u.id`,
    );
    console.error(`No account has the username or email "${who}".`);
    if (owners.length) console.error("Owner accounts: " + owners.map((o) => `${o.username} (${o.status})`).join(", "));
    else console.error("There is no owner account yet: open the app and create it (needs AUTH_SETUP_CODE).");
    process.exitCode = 1;
  } else {
    console.log(
      `Account: ${user.username} (${user.name}), ${user.status}` +
        (user.locked_until && new Date(user.locked_until.replace(" ", "T") + "Z") > new Date() ? ", locked" : ""),
    );
    const doing = [
      "give it a new one-time password and make the person choose their own",
      "unlock it and end all of its sessions",
      ...(flags.has("--enable") ? ["turn it on (it is " + user.status + ")"] : []),
      ...(flags.has("--make-owner") ? ["give it the Owner role"] : []),
      ...(flags.has("--reset-mfa") ? ["remove its two-step sign-in"] : []),
    ];
    console.log("This will: " + doing.join("; ") + ".");
    if (!yes) {
      console.log("\nNothing was changed. Run it again with --yes to do it.");
    } else {
      const temporaryPassword = `${group()}-${group()}-${group()}`;
      const hash = await hashPassword(temporaryPassword);
      await conn.beginTransaction();
      try {
        await conn.query(
          `UPDATE auth_users SET password_hash = ?, must_change_password = true, failed_login_count = 0,
             locked_until = NULL, password_changed_at = NOW(6), updated_at = NOW(6)
             ${flags.has("--enable") ? ", status = 'active'" : ""} WHERE id = ?`,
          [hash, user.id],
        );
        if (flags.has("--make-owner")) {
          const [role] = await conn.query("SELECT id FROM auth_roles WHERE `key` = 'owner'");
          if (!role[0]) throw new Error("There is no Owner role yet: the app has never been set up.");
          await conn.query("INSERT IGNORE INTO auth_user_roles (user_id, role_id) VALUES (?, ?)", [user.id, role[0].id]);
        }
        if (flags.has("--reset-mfa")) await conn.query("DELETE FROM app_meta WHERE `key` = ?", [`mfa:${user.id}`]);
        await conn.query("DELETE FROM auth_sessions WHERE user_id = ?", [user.id]);
        await conn.query(
          "INSERT INTO audit_log (user_id, username, action, target, details) VALUES (NULL, NULL, 'user.password_reset', ?, ?)",
          [user.username, JSON.stringify({ via: "owner-recover script", flags: [...flags].filter((f) => f !== "--yes") })],
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
      console.log(`\nDone. One-time password for ${user.username}:\n\n    ${temporaryPassword}\n`);
      console.log("Hand it over privately. It is shown only now, and the person must choose their own password when signing in.");
    }
  }
} catch (e) {
  console.error("Error:", e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
