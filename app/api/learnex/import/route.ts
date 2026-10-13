import { importAll } from "@/lib/server/learnex/repository";
import { readJson, respond } from "@/lib/server/learnex/http";

// One-time import of existing data into an empty database.
export async function POST(request: Request) {
  return respond(async () => importAll((await readJson(request)).stores));
}
