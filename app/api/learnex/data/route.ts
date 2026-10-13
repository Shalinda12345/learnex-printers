import { loadAll } from "@/lib/server/learnex/repository";
import { respond } from "@/lib/server/learnex/http";

// Every saved module, loaded once when the app starts.
export async function GET() {
  return respond(() => loadAll());
}
