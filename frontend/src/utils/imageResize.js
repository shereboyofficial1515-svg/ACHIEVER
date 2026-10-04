/**
 * Shrink a profile or group picture before upload: square-friendly, longest side `max` px,
 * WebP (JPEG where WebP encoding is unavailable). A 4 MB phone photo becomes ~40–80 KB, so
 * avatars load fast everywhere they appear. The server still checks type and size.
 * Returns the original file when it is already small or the browser cannot decode it.
 */
export async function resizeImageFile(file, { max = 512, quality = 0.86 } = {}) {
  if (!file?.type?.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 200 * 1024) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await encode('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${file.name.replace(/\.\w+$/, '')}.${ext}`, { type: blob.type, lastModified: Date.now() });
  } catch {
    return file;
  }
}
