import { readJson, respond } from "@/lib/server/learnex/http";
import { requirePermission, requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { createUser, listRoles, listUsers } from "@/lib/server/auth/admin";

// Staff accounts and the roles that can be assigned to them.
export async function GET() {
  return respond(async () => {
    requirePermission(await requireUser(), "users.manage");
    return { users: await listUsers(), roles: await listRoles() };
  });
}

// Create a staff account; the response carries its one-time password.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser();
    requirePermission(user, "users.manage");
    return createUser(user, await readJson(request));
  });
}
