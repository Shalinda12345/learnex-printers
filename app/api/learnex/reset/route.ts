import { resetAll } from "@/lib/server/learnex/repository";
import { respond } from "@/lib/server/learnex/http";
import { actorOf, requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";

// Factory reset: deletes every business record (the app restarts from demo data).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "data.reset");
    await resetAll(actorOf(user));
  });
}
