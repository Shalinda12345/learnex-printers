import { respond } from "@/lib/server/learnex/http";
import { requirePermission, requireUser } from "@/lib/server/auth/dal";
import { listAudit } from "@/lib/server/auth/admin";

// The activity log, newest first (?limit, ?before=<id>, ?action=<prefix>, ?user=<username>).
export async function GET(request: Request) {
  return respond(async () => {
    requirePermission(await requireUser(), "audit.view");
    return listAudit(new URL(request.url).searchParams);
  });
}
