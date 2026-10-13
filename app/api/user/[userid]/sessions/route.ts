import { respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { signOutUser } from "@/lib/server/auth/admin";

// Sign a user out on every device.
export async function DELETE(request: Request, ctx: RouteContext<"/api/user/[userid]/sessions">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    return signOutUser(user, (await ctx.params).userid);
  });
}
