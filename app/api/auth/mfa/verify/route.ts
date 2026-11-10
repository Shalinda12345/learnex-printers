import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin } from "@/lib/server/auth/dal";
import { loginWithCode } from "@/lib/server/auth/accounts";
import { limitAttempts } from "@/lib/server/rate-limit";

// Second step of a two-step sign-in: { ticket, code }. Wrong codes are also counted per account (5 → 15 minutes).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    limitAttempts("mfa", request);
    await loginWithCode(await readJson(request, BODY_LIMITS.auth), request);
  });
}
