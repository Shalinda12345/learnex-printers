import { respond } from "@/lib/server/learnex/http";
import { actorOf, requireSameOrigin } from "@/lib/server/auth/dal";
import { destroyCurrentSession, getSessionUser } from "@/lib/server/auth/session";
import { audit } from "@/lib/server/audit";

// Sign out: deletes this session on the server and clears the cookie.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await getSessionUser();
    await destroyCurrentSession();
    if (user) await audit(actorOf(user), "auth.logout", user.username);
  });
}
