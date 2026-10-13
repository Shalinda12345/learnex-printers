import { saveChanges } from "@/lib/server/learnex/repository";
import { readJson, respond } from "@/lib/server/learnex/http";

// Saves the changes the app made since its last save, in one transaction.
export async function POST(request: Request) {
  return respond(async () => saveChanges((await readJson(request)).changes));
}
