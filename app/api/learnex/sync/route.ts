import { saveChanges } from "@/lib/server/learnex/repository";
import { readJson, respond } from "@/lib/server/learnex/http";
import { actorOf, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { storeAccessFor } from "@/lib/auth/permissions";

// Saves the changes the app made since its last save, in one transaction.
// Refused as a whole if it touches a module the user may not change.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    const body = await readJson(request);
    await saveChanges(body.changes, actorOf(user), storeAccessFor(user.permissions));
  });
}
