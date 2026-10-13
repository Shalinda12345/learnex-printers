import { loadAll } from "@/lib/server/learnex/repository";
import { respond } from "@/lib/server/learnex/http";
import { requireUser } from "@/lib/server/auth/dal";
import { storeAccessFor } from "@/lib/auth/permissions";

// Every saved module the signed-in user may see, loaded once when the app starts.
export async function GET() {
  return respond(async () => {
    const user = await requireUser();
    return loadAll(storeAccessFor(user.permissions));
  });
}
