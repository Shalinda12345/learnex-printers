import { resetAll } from "@/lib/server/learnex/repository";
import { respond } from "@/lib/server/learnex/http";
import { actorOf, requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { hasFreshReauth } from "@/lib/server/auth/reauth";
import { ForbiddenError } from "@/lib/server/errors";

// Factory reset: deletes every business record (the app restarts from demo data).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "data.reset");
    if (!(await hasFreshReauth(user, request)))
      throw new ForbiddenError("Confirm your password to reset everything. Nothing was deleted.", "reauth_required");
    await resetAll(actorOf(user));
  });
}
