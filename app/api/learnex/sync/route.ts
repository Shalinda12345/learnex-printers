import { saveChanges } from "@/lib/server/learnex/repository";
import { BODY_LIMITS, readJson, respond } from "@/lib/server/learnex/http";
import { actorOf, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { WHOLE_MODULE_PERMISSIONS, storeAccessFor } from "@/lib/auth/permissions";

// Saves the changes the app made since its last save, in one transaction.
// Refused as a whole if it touches a module the user may not change, or if it
// replaces / empties a whole module without the restore or reset permission.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    const body = await readJson(request, BODY_LIMITS.data);
    return saveChanges(body.changes, actorOf(user), storeAccessFor(user.permissions), {
      wholeModules: WHOLE_MODULE_PERMISSIONS.some((p) => user.permissions.has(p)),
    });
  });
}
