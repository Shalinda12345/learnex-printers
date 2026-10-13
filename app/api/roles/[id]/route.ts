import { readJson, respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { deleteRole, updateRole } from "@/lib/server/auth/admin";

// Edit a role; applies immediately to everyone who has it.
export async function PATCH(request: Request, ctx: RouteContext<"/api/roles/[id]">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "roles.manage");
    await updateRole(user, (await ctx.params).id, await readJson(request));
  });
}

// Delete a role (only when nobody has it any more).
export async function DELETE(request: Request, ctx: RouteContext<"/api/roles/[id]">) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "roles.manage");
    await deleteRole(user, (await ctx.params).id);
  });
}
