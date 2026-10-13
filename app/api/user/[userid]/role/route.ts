import { readJson, respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { updateUser } from "@/lib/server/auth/admin";

// Set a user's roles: { roleIds: [...] }. Takes effect on their very next request.
export async function PUT(request: Request, ctx: RouteContext<"/api/user/[userid]/role">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    const { roleIds } = await readJson(request);
    await updateUser(user, (await ctx.params).userid, { roleIds });
  });
}
