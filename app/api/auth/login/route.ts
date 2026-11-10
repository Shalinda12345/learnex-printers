import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin } from "@/lib/server/auth/dal";
import { login } from "@/lib/server/auth/accounts";
import { limitAttempts } from "@/lib/server/rate-limit";

// Sign in with username (or email) and password; sets the session cookie. For an account with
// two-step sign-in the answer is { mfaRequired, ticket } and /api/auth/mfa/verify finishes it.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    limitAttempts("login", request);
    return login(await readJson(request, BODY_LIMITS.auth), request);
  });
}
