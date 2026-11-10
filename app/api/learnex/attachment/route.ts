import { respond } from "@/lib/server/learnex/http";
import { requireUser } from "@/lib/server/auth/dal";
import { loadAttachment } from "@/lib/server/learnex/repository";
import { storeAccessFor, type StoreKey } from "@/lib/auth/permissions";
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from "@/lib/server/errors";

// The file attached to one record (a photo or PDF of a bill), downloaded on demand:
// GET /api/learnex/attachment?store=ledger&id=TXN-8822. The records themselves are sent to the
// browser without their files (see lib/server/learnex/repository.ts). Needs the same access to
// the module as loading it. Sent as a download, never shown inside the app's own pages.
const FILE = /^data:((?:image\/(?:png|jpe?g|gif|webp|bmp|avif|heic|heif))|application\/pdf);base64,([A-Za-z0-9+/]*={0,2})$/i;

export async function GET(request: Request) {
  let file: Response | null = null;
  // `respond` turns failures into the usual JSON answers; a good answer is the file itself.
  const failure = await respond(async () => {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const store = params.get("store") ?? "";
    const id = params.get("id") ?? "";
    if (!store || !id) throw new BadRequestError("store and id are required");
    if (!storeAccessFor(user.permissions)[store as StoreKey]) throw new ForbiddenError("You don't have access to that.");
    const stored = await loadAttachment(store, id);
    if (!stored?.dataUrl) throw new NotFoundError("There is no file attached to that record.");
    const match = FILE.exec(stored.dataUrl);
    if (!match) throw new HttpError(415, "That file cannot be shown.");
    const bytes = Buffer.from(match[2], "base64");
    const filename = (stored.name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
    file = new Response(bytes, {
      headers: {
        "Content-Type": match[1].toLowerCase(),
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return null;
  });
  return file ?? failure;
}
