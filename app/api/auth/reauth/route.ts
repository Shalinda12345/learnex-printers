import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { requireHttpsIfConfigured, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { issueReauth } from "@/lib/server/auth/reauth";
import { limitAttempts } from "@/lib/server/rate-limit";

// Re-confirm your password (and authenticator code) before restore / clear / factory reset.
// Answers a token for the "x-reauth" header of that request; it is good for 5 minutes.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    requireHttpsIfConfigured(request);
    const user = await requireUser();
    limitAttempts(`reauth:${user.id}`, request); // a guessing oracle for a stolen session
    return issueReauth(user, await readJson(request, BODY_LIMITS.auth));
  });
}
