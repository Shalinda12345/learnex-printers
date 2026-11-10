// Unit tests for the common-password check (lib/auth/common-passwords.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { commonPasswordProblem } from "@/lib/auth/common-passwords";

const refused = (p) => commonPasswordProblem(p) !== null;

test("PWD-1 the passwords attackers try first are refused", () => {
  for (const p of [
    "password1",
    "Password1",
    "12345678",
    "123456789",
    "qwertyui",
    "iloveyou",
    "welcome1",
    "abcd1234",
    "1q2w3e4r",
    "admin123",
    "letmein123",
    "learnex123",
    "LEARNEX@123",
    "Passw0rd",
  ])
    assert.ok(refused(p), p);
  assert.match(commonPasswordProblem("password1"), /too common/);
});

test("PWD-2 a common word with only digits or symbols added is still refused", () => {
  for (const p of ["Password123", "Welcome2026!", "Summer2026", "Admin@2026", "Princess7", "Football99#", "Dragon1234"])
    assert.ok(refused(p), p);
});

test("PWD-3 patterns are refused: repeats, runs and keyboard rows", () => {
  for (const p of ["aaaaaaaa", "00000000", "abababab", "12341234", "87654321", "abcdefgh", "23456789", "asdfghjk", "qwertyuiop"])
    assert.ok(refused(p), p);
});

test("PWD-4 ordinary passwords and passphrases are accepted", () => {
  for (const p of [
    "Owner-pass-123",
    "Staff-pass-123",
    "Nimal-new-pass-1",
    "Blue-Tractor-Nine-42",
    "k7Qm-xR4p-9TzW", // the shape of the one-time passwords
    "correct horse battery staple",
    "Shop2026Keeper!",
    "Welcome-To-The-Shop-77", // a common word in the middle of a longer password is fine
    "my-password-is-long-and-silly",
  ])
    assert.equal(commonPasswordProblem(p), null, p);
});
