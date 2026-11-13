/** Browser-side helpers for invoice uploads. */

const MAX_SIDE = 1600;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/**
 * Everything sent in one request stays under this: the host refuses request
 * bodies over ~4.5 MB, so all the pages of one read must fit together.
 */
export const READ_BUDGET_BYTES = 3.8 * 1024 * 1024;

export interface CompressOptions { maxSide?: number; quality?: number }

/** Downscale a photo to ~1600px JPEG in the browser so uploads stay small and fast. */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, (opts.maxSide ?? MAX_SIDE) / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", opts.quality ?? 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** A photo (compressed) or a PDF (as is, ≤ 8 MB), or an error sentence. */
export async function prepareUpload(f: File, opts: CompressOptions = {}): Promise<File | { error: string }> {
  const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return f.size > MAX_UPLOAD_BYTES ? { error: "That PDF is over 8 MB. Try a photo of it instead." } : new File([f], f.name, { type: "application/pdf" });
  const img = await compressImage(f, opts);
  if (img.type !== "image/jpeg" && img.type !== "image/png") return { error: "That image type can't be read here. Take a photo or upload a JPEG, PNG or PDF." };
  if (img.size > MAX_UPLOAD_BYTES) return { error: "That image is over 8 MB." };
  return img;
}

/** Two passes at most: sharp first (small print reads better), smaller if all the pages together are over budget. */
export const PAGE_QUALITY: CompressOptions = { maxSide: 2000, quality: 0.8 };
export const PAGE_QUALITY_SMALL: CompressOptions = { maxSide: 1400, quality: 0.7 };

/** Fit a set of pages (originals) into one read request; photos are re-compressed smaller if needed. */
export async function fitPages(originals: File[], prepared: File[]): Promise<File[] | { error: string }> {
  const total = (fs: File[]) => fs.reduce((s, f) => s + f.size, 0);
  if (total(prepared) <= READ_BUDGET_BYTES) return prepared;
  const smaller: File[] = [];
  for (let i = 0; i < originals.length; i++) {
    const isPdf = prepared[i].type === "application/pdf";
    const r = isPdf ? prepared[i] : await prepareUpload(originals[i], PAGE_QUALITY_SMALL);
    if ("error" in r) return r;
    smaller.push(r);
  }
  if (total(smaller) <= READ_BUDGET_BYTES) return smaller;
  return { error: smaller.some((f) => f.type === "application/pdf") ? "That's too big to read in one go (over 4 MB). Take photos of the pages instead of the PDF, or read fewer pages." : "That's too many pages to read in one go. Read the first few, then add the rest by hand." };
}
