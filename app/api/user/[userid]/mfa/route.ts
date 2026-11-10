import { respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { resetUserMfa } from "@/lib/server/auth/admin";

// Switch off someone's two-step sign-in (lost phone). They sign in with the password alone until they set it up again.
export async function DELETE(request: Request, ctx: RouteContext<"/api/user/[userid]/mfa">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    await resetUserMfa(user, (await ctx.params).userid);
  });
}
