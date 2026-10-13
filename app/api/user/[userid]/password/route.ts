import { respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { resetUserPassword } from "@/lib/server/auth/admin";

// Reset someone's password: returns a one-time password and signs them out everywhere.
export async function POST(request: Request, ctx: RouteContext<"/api/user/[userid]/password">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    return resetUserPassword(user, (await ctx.params).userid);
  });
}
