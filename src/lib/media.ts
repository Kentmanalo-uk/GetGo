import { supabase } from './supabase';

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

const MAX_DIMENSION = 1600;

/**
 * Resizes and re-encodes an image in the browser before upload so product
 * photos stay small on slow mobile connections. Falls back to the original
 * file if the browser cannot decode it.
 */
export async function prepareImage(file: File, maxDimension = MAX_DIMENSION): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Use a JPG, PNG or WebP image.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('This image is too large. Use one under 15 MB.');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Uploads to the public media bucket under a scoped prefix; returns the path. */
export async function uploadMedia(prefix: string, file: File, maxDimension?: number): Promise<string> {
  const blob = await prepareImage(file, maxDimension);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error(error.message.includes('row-level security') ? 'You can’t upload images here.' : error.message);
  return path;
}
