import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin } from "@/lib/server/auth/dal";
import { setupOwner } from "@/lib/server/auth/accounts";
import { limitAttempts } from "@/lib/server/rate-limit";

// Registration is closed: it only exists to create the very first (owner)
// account on a new install, and needs the AUTH_SETUP_CODE from .env.
// Staff accounts are created by an administrator (POST /api/user).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    limitAttempts("setup", request);
    await setupOwner(await readJson(request, BODY_LIMITS.auth), request);
  });
}
