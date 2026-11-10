/* =====================================================================
   COMMON PASSWORDS — the ones attackers try first.

   Length and "not your username" are not enough: `password1`, `12345678`
   and `Welcome2026!` pass both and are guessed within the first few hundred
   tries. This refuses:
     - a password on a list of very common ones (below),
     - a common word with only digits or symbols added to the end
       ("Password123", "Summer2026!"),
     - passwords that are a pattern, not a secret: one character repeated,
       a short block repeated, a run like 12345678 / abcdefgh, a keyboard row.
   It is deliberately short: a local list, no internet lookup. Passwords people
   build from several unrelated words ("Blue-Tractor-Nine-42") are never touched.
===================================================================== */

const list = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

// whole passwords (lower case), all 8+ characters
const COMMON = list(`
  password password1 password12 password123 password1234 password12345 passw0rd passw0rd1 p@ssw0rd p@ssword p@55w0rd
  pa55word pa55w0rd pa$$w0rd p4ssw0rd mypassword mypassword1 mypass123 passpass pass1234 pass12345 passwort
  12345678 123456789 1234567890 12345678910 11111111 111111111 1111111111 00000000 000000000 0000000000 88888888
  12341234 12121212 123123123 1231234 987654321 87654321 0987654321 09876543 11223344 112233445 1122334455 12344321
  123454321 13579246 1357924680 2468013579 14789632 147258369 159753456 741852963 963852741 789456123 456789123
  321654987 123456789a 123456a 1234qwer qwer1234 asdf1234 zxcv1234 a1b2c3d4 a1b2c3d4e5 aa123456 aa12345678 ab123456
  123abc123 abc123abc 1234abcd abcd1234 abc12345 abcd12345 abc123456 abcdefgh abcdefghi abcdefghij
  1q2w3e4r 1q2w3e4r5t 1q2w3e4r5t6y 1qaz2wsx 1qazxsw2 q1w2e3r4 q1w2e3r4t5 qazwsxedc qazwsx123 zaq12wsx zaq1zaq1
  qweasdzxc qweasd123 asdasd123 asd12345 123qweasd 123qwe123 123qweasdzxc qwe123qwe
  qwertyui qwertyuiop qwerty123 qwerty12 qwerty1234 qwertyuiop123 qwerty12345 asdfghjk asdfghjkl zxcvbnm1 zxcvbnm123
  iloveyou iloveyou1 iloveyou2 iloveyou123 iloveu123 loveyou1 ilovegod godisgood jesus123 jesuschrist blessed1
  welcome1 welcome12 welcome123 letmein1 letmein123 trustno1 sunshine sunshine1 princess princess1 football football1
  baseball basketball superman superman1 batman123 starwars master123 dragon123 monkey123 shadow123 michael1
  hello123 hello1234 freedom1 whatever whatever1 computer computer1 internet internet1 flower123 lovely12 secret123
  changeme changeme1 changeme123 administrator administrator1 admin123 admin1234 admin12345 root1234 user1234
  guest123 test1234 testing123 default1 login123 access123 temp1234 temporary
  srilanka srilanka1 srilanka123 lanka123 colombo1 colombo123 ceylon123 learnex learnex1 learnex123 learnex@123
  hashil hashil1 hashil123 hashil@123 printers1 printer123
`);

// words that stay weak when digits or symbols are tacked on: "Welcome2026!" -> "welcome"
const COMMON_WORDS = list(`
  password welcome sunshine princess football baseball basketball superman batman letmein trustno iloveyou qwerty
  qwertyuiop asdfgh asdfghjkl zxcvbn abcdef master dragon monkey shadow michael jordan jennifer jessica ashley
  bailey charlie daniel hannah hello freedom whatever computer internet flower lovely secret changeme administrator
  admin login access mypassword mypass default testing guest root user srilanka colombo lanka learnex hashil
  cricket liverpool chelsea arsenal barcelona madonna thomas robert soccer hockey killer joshua matthew andrew
  anthony george harley ranger hunter buster tigger pepper ginger summer winter spring autumn family friend forever
  qazwsx pass temp welcome
`);

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

/** Is every character one step after the one before (12345678, abcdefgh) or one step before (87654321)? */
function isRun(s: string) {
  if (s.length < 6) return false;
  let step = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (Math.abs(d) !== 1 || (step && d !== step)) return false;
    step = d;
  }
  return true;
}

/** A reason this password is too easy to guess, or null. */
export function commonPasswordProblem(password: string): string | null {
  const lower = password.normalize("NFKC").trim().toLowerCase();
  const reason = "That password is too common. Choose something harder to guess.";
  if (COMMON.has(lower)) return reason;
  // a common word followed only by digits / symbols
  const stem = lower.replace(/[^a-z]+$/, "");
  if (stem.length >= 4 && stem !== lower && COMMON_WORDS.has(stem)) return reason;
  if (COMMON_WORDS.has(lower)) return reason;
  // patterns
  if (/^(.)\1+$/u.test(lower)) return reason;
  if (/^(.{1,4})\1+$/u.test(lower)) return reason;
  if (isRun(lower)) return reason;
  if (lower.length >= 8 && ROWS.some((row) => row.includes(lower) || [...row].reverse().join("").includes(lower)))
    return reason;
  return null;
}
