/** Browser-side helpers for invoice uploads. */

const MAX_SIDE = 1600;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Downscale a photo to ~1600px JPEG in the browser so uploads stay small and fast. */
export async function compressImage(file: File): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** A photo (compressed) or a PDF (as is, ≤ 8 MB), or an error sentence. */
export async function prepareUpload(f: File): Promise<File | { error: string }> {
  const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  if (isPdf) return f.size > MAX_UPLOAD_BYTES ? { error: "That PDF is over 8 MB. Try a photo of it instead." } : new File([f], f.name, { type: "application/pdf" });
  const img = await compressImage(f);
  if (img.type !== "image/jpeg" && img.type !== "image/png") return { error: "That image type can't be read here. Take a photo or upload a JPEG, PNG or PDF." };
  if (img.size > MAX_UPLOAD_BYTES) return { error: "That image is over 8 MB." };
  return img;
}
