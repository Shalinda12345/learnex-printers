import { respond } from "@/lib/server/learnex/http";
import { getSessionUser } from "@/lib/server/auth/session";
import { publicUser } from "@/lib/server/auth/dal";
import { hasAnyUser, setupCodeConfigured } from "@/lib/server/auth/accounts";

// Who is signed in — or, on a brand-new install, that the owner account still has to be created.
export async function GET() {
  return respond(async () => {
    const user = await getSessionUser();
    return {
      user: user ? publicUser(user) : null,
      setupRequired: !(await hasAnyUser()),
      setupAvailable: setupCodeConfigured(),
    };
  });
}
