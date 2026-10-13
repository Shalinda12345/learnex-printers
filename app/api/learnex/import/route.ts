import { importAll, isInitialized } from "@/lib/server/learnex/repository";
import { readJson, respond } from "@/lib/server/learnex/http";
import { actorOf, requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { ConflictError } from "@/lib/server/errors";

// One-time import of existing data into an empty database.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "data.restore");
    if (await isInitialized()) {
      throw new ConflictError(
        "The database is already set up. Use Settings → Data & Backup → Restore instead.",
      );
    }
    await importAll((await readJson(request)).stores, actorOf(user));
  });
}
