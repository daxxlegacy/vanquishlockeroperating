// © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
// Client-side image compression for ticket attachments.
// Downscales to max 1600px on the longest side and re-encodes as JPEG q=0.85.
export async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  // HEIC and some formats can't be decoded by canvas; upload as-is.
  const unsupported = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (unsupported) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not read image"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  return blob ?? file;
}
