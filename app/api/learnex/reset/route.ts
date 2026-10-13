import { resetAll } from "@/lib/server/learnex/repository";
import { respond } from "@/lib/server/learnex/http";

// Factory reset: deletes every record (the app restarts from demo data).
export async function POST() {
  return respond(() => resetAll());
}
