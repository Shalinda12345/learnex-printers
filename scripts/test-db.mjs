// Runs the database test suite (tests/*.test.mjs) against a separate
// "<db>_test" database, so the real data is never touched.
//
//   npm run test:db        (builds first; needs PostgreSQL running and Chrome installed)
//
// Starts two servers from the production build:
//   :3311  wired to the test database
//   :3312  wired to a closed port — simulates "database down"
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const testUrl = new URL(process.env.DATABASE_URL);
testUrl.pathname = testUrl.pathname.replace(/\/?$/, "") + "_test";
const TEST_DATABASE_URL = testUrl.toString();
const deadUrl = new URL(TEST_DATABASE_URL);
deadUrl.port = "1";

// The test servers get their own owner-setup code (never the real one).
const TEST_SETUP_CODE = "test-setup-" + Math.random().toString(36).slice(2);

const env = {
  ...process.env,
  TEST_DATABASE_URL,
  TEST_SETUP_CODE,
  TEST_BASE_URL: "http://localhost:3311",
  TEST_DEAD_DB_BASE_URL: "http://localhost:3312",
  TEST_APP_PORT: "3311",
};

console.log(`Setting up test database ${testUrl.pathname.slice(1)} ...`);
const setup = spawnSync(process.execPath, ["scripts/db-setup.mjs"], {
  cwd: root,
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  stdio: "inherit",
});
if (setup.status !== 0) process.exit(setup.status ?? 1);

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
function startServer(port, databaseUrl) {
  return spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SETUP_CODE: TEST_SETUP_CODE },
    stdio: "ignore",
  });
}
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server at ${url} did not start`);
}

const servers = [startServer(3311, TEST_DATABASE_URL), startServer(3312, deadUrl.toString())];
const stopServers = () => servers.forEach((s) => s.kill());
process.on("exit", stopServers);

let code = 1;
try {
  await waitFor(env.TEST_BASE_URL);
  await waitFor(env.TEST_DEAD_DB_BASE_URL);
  mkdirSync(path.join(root, "test-results"), { recursive: true });
  const logPath = path.join(root, "test-results", "db-tests.log");
  const log = createWriteStream(logPath);
  const files = ["01-database", "02-api", "03-ui", "05-auth", "04-limitations"].map((f) => `tests/${f}.test.mjs`);
  const run = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [run.stdout, run.stderr]) {
    stream.on("data", (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
  }
  code = await new Promise((resolve) => run.on("close", resolve));
  log.end();
  console.log(`\nFull log: ${path.relative(root, logPath)}`);
} finally {
  stopServers();
}
process.exit(code);
