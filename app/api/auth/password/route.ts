import { readJson, respond } from "@/lib/server/learnex/http";
import { requireSameOrigin, requireUser } from "@/lib/server/auth/dal";
import { changeOwnPassword } from "@/lib/server/auth/accounts";

// Change your own password (also the forced change after a one-time password).
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    const user = await requireUser({ allowPendingPasswordChange: true });
    await changeOwnPassword(user, await readJson(request));
  });
}
