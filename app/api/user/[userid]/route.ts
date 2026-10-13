import { readJson, respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { updateUser } from "@/lib/server/auth/admin";

// Edit a staff account: name, username, email, status ("active" / "disabled").
export async function PATCH(request: Request, ctx: RouteContext<"/api/user/[userid]">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    await updateUser(user, (await ctx.params).userid, await readJson(request));
  });
}
