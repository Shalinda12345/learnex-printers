import { respond } from "@/lib/server/learnex/http";
import { requireUser } from "@/lib/server/auth/dal";
import { mfaAvailable, mfaEnabled, recoveryCodesLeft } from "@/lib/server/auth/mfa";

// Is two-step sign-in possible on this server, and is it on for the signed-in person?
export async function GET() {
  return respond(async () => {
    const user = await requireUser();
    const enabled = await mfaEnabled(user.id);
    return { available: mfaAvailable(), enabled, recoveryCodesLeft: enabled ? await recoveryCodesLeft(user.id) : 0 };
  });
}
