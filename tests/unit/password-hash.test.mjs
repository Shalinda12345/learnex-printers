import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PARAMS, deriveKey, formatHash, hashPassword, parseHash, verifyPassword } from "@/lib/auth/password-hash";

// scrypt at the real cost is ~0.3 s each; a handful of hashes is fine.
test("PWH-1 a hash verifies with the right password only, and carries its parameters", async () => {
  const stored = await hashPassword("Correct-horse-1");
  assert.match(stored, new RegExp(`^scrypt\\$${PARAMS.N}\\$${PARAMS.r}\\$${PARAMS.p}\\$`));
  assert.deepEqual(await verifyPassword("Correct-horse-1", stored), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword("Correct-horse-2", stored)).ok, false);
});

test("PWH-2 the same password hashed twice gives different hashes (random salt)", async () => {
  assert.notEqual(await hashPassword("same-password-9"), await hashPassword("same-password-9"));
});

test("PWH-3 text that is not one of our hashes never verifies, and never throws", async () => {
  for (const junk of ["", "plain", "bcrypt$1$2", "scrypt$1$2$3"]) assert.equal((await verifyPassword("x", junk)).ok, false, junk);
  assert.equal(parseHash("nope"), null);
});

test("PWH-4 a hash made with weaker parameters still verifies and is flagged for an upgrade", async () => {
  const salt = randomBytes(16);
  const weak = { N: 2 ** 14, r: 8, p: 1 };
  const stored = formatHash(salt, await deriveKey("old-password-1", salt, weak), weak);
  assert.deepEqual(await verifyPassword("old-password-1", stored), { ok: true, needsRehash: true });
});

test("PWH-5 accents typed in different ways are the same password (NFKC)", async () => {
  const stored = await hashPassword("café-pass-1"); // é as one character
  assert.equal((await verifyPassword("café-pass-1", stored)).ok, true); // e + combining accent
});
