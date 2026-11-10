import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, counterAt, generateSecret, hotp, matchTotp, otpauthUri, totp } from "@/lib/auth/totp";

// RFC 4226 appendix D: secret "12345678901234567890", counters 0..9
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC_CODES = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

test("TOTP-1 HOTP matches the RFC 4226 test vectors", () => {
  RFC_CODES.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code));
});

test("TOTP-2 TOTP matches the RFC 6238 SHA-1 vector (time 59 s → 94287082 → last six digits)", () => {
  assert.equal(totp(RFC_SECRET, 59_000), "287082");
});

test("TOTP-3 base32 round-trips and a generated secret is 32 characters", () => {
  const s = generateSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.equal(base32Encode(base32Decode(s)), s);
  assert.throws(() => base32Decode("not*base32"));
});

test("TOTP-4 a code is accepted one step either side, not two", () => {
  const t = 1_700_000_000_000;
  const code = totp(RFC_SECRET, t);
  assert.equal(matchTotp(RFC_SECRET, code, { time: t }), counterAt(t));
  assert.equal(matchTotp(RFC_SECRET, code, { time: t + 30_000 }), counterAt(t));
  assert.equal(matchTotp(RFC_SECRET, code, { time: t - 30_000 }), counterAt(t));
  assert.equal(matchTotp(RFC_SECRET, code, { time: t + 90_000 }), null);
});

test("TOTP-5 a code cannot be used twice (counter must be newer than the last one used)", () => {
  const t = 1_700_000_000_000;
  const code = totp(RFC_SECRET, t);
  const used = matchTotp(RFC_SECRET, code, { time: t });
  assert.equal(matchTotp(RFC_SECRET, code, { time: t, after: used }), null);
});

test("TOTP-6 anything but six digits is refused; spaces are ignored", () => {
  const t = 1_700_000_000_000;
  const code = totp(RFC_SECRET, t);
  assert.equal(matchTotp(RFC_SECRET, "12345", { time: t }), null);
  assert.equal(matchTotp(RFC_SECRET, "abcdef", { time: t }), null);
  assert.ok(matchTotp(RFC_SECRET, code.slice(0, 3) + " " + code.slice(3), { time: t }) !== null);
});

test("TOTP-7 the otpauth address names the account and issuer", () => {
  const uri = otpauthUri({ secret: "ABC234", account: "owner", issuer: "LEARNEX ERP" });
  assert.match(uri, /^otpauth:\/\/totp\/LEARNEX%20ERP%3Aowner\?secret=ABC234&issuer=LEARNEX%20ERP/);
});
