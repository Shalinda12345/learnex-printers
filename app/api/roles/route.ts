import { readJson, respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { createRole, listRoles } from "@/lib/server/auth/admin";

export async function GET() {
  return respond(async () => {
    requirePermission(await requireUser(), "roles.manage", "users.manage");
    return { roles: await listRoles() };
  });
}

// Create a custom role: { name, description, permissions: [...] }.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "roles.manage");
    return createRole(user, await readJson(request));
  });
}
