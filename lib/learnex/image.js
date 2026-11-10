/* =====================================================================
   PHOTOS AND PDFs ATTACHED TO RECORDS (slips, receipts, invoices)

   A photo straight from a phone is 3-8 MB. Stored inside the record as text it grows by a
   third, and the host (Vercel) refuses requests of about 4.5 MB, so one big photo could make
   a save fail again and again. So photos are shrunk here, in the browser, before they are
   attached: at most 1800 px on the long side, as a JPEG. A bill is still perfectly readable.
   What cannot be shrunk (a PDF, an animated GIF) must be under MAX_ATTACHMENT_BYTES as it is.
   The server enforces the same limit (lib/server/learnex/sanity.ts).
===================================================================== */
export const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
export const MAX_ATTACHMENT_LABEL = "2.5MB";
const MAX_SIDE = 1800;
const SHRINK_ABOVE_BYTES = 400 * 1024; // small photos are kept exactly as they are
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i;

const tooLarge = () => new Error(`File is too large — please choose a file under ${MAX_ATTACHMENT_LABEL}.`);

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

// A smaller JPEG copy of a picture, or null when the browser cannot decode it (e.g. HEIC).
async function shrunkJpeg(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // a PNG with a see-through background would turn black in a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

/** Turns a chosen file into { name, type, dataUrl } ready to be attached, or throws an Error with the reason. */
export async function prepareAttachment(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf && !IMAGE_TYPES.test(file.type)) throw new Error("Attach a photo (PNG, JPEG, GIF, WebP) or a PDF file.");
  let blob = file;
  let name = file.name;
  let type = isPdf ? "application/pdf" : file.type;
  const animated = /^image\/gif$/i.test(file.type);
  if (!isPdf && !animated && file.size > SHRINK_ABOVE_BYTES) {
    const small = await shrunkJpeg(file);
    if (small && small.size < file.size) {
      blob = small;
      type = "image/jpeg";
      name = name.replace(/\.[^.]+$/, "") + ".jpg";
    }
  }
  if (blob.size > MAX_ATTACHMENT_BYTES) throw tooLarge();
  // (say the type ourselves: a PDF picked by name can arrive with no type at all)
  const dataUrl = (await readAsDataUrl(blob)).replace(/^data:[^;,]*/, `data:${type}`);
  return { name, type, dataUrl };
}
