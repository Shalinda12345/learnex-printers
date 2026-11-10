import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { startSetup } from "@/lib/server/auth/mfa";
import { verifyOwnPassword } from "@/lib/server/auth/reauth";
import { limitAttempts } from "@/lib/server/rate-limit";

// Step 1 of switching two-step sign-in on: needs your password; answers the secret / address for the app.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    const user = await requireUser();
    limitAttempts(`mfa-setup:${user.id}`, request);
    await verifyOwnPassword(user, (await readJson(request, BODY_LIMITS.auth)).password);
    return startSetup(user);
  });
}
