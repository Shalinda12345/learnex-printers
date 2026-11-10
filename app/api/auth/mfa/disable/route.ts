import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { disableOwn } from "@/lib/server/auth/mfa";
import { verifyOwnPassword } from "@/lib/server/auth/reauth";
import { limitAttempts } from "@/lib/server/rate-limit";

// Switch two-step sign-in off: needs your password and a current code (or a recovery code).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    const user = await requireUser();
    limitAttempts(`mfa-setup:${user.id}`, request);
    const body = await readJson(request, BODY_LIMITS.auth);
    await verifyOwnPassword(user, body.password);
    await disableOwn(user, body.code);
  });
}
