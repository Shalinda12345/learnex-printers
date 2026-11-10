import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { changeOwnPassword } from "@/lib/server/auth/accounts";
import { limitAttempts } from "@/lib/server/rate-limit";

// Change your own password (also the forced change after a one-time password).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    const user = await requireUser({ allowPendingPasswordChange: true });
    // the current password is checked here, so this is a guessing oracle for a stolen session
    limitAttempts(`password:${user.id}`, request);
    await changeOwnPassword(user, await readJson(request, BODY_LIMITS.auth));
  });
}
