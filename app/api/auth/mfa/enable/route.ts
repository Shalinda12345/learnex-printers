import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { finishSetup } from "@/lib/server/auth/mfa";
import { limitAttempts } from "@/lib/server/rate-limit";

// Step 2: the first code from the app switches it on; answers the recovery codes (shown only once).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    const user = await requireUser();
    limitAttempts(`mfa-setup:${user.id}`, request);
    return finishSetup(user, (await readJson(request, BODY_LIMITS.auth)).code);
  });
}
