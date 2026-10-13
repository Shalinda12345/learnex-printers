import { readJson, respond } from "@/lib/server/learnex/http";
import { requireSameOrigin } from "@/lib/server/auth/dal";
import { login } from "@/lib/server/auth/accounts";

// Sign in with username (or email) and password; sets the session cookie.
export async function POST(request: Request) {
  return respond(async () => {
    requireSameOrigin(request);
    await login(await readJson(request), request);
  });
}
