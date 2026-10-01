import type { DecodedPhoto, PhotoInfo } from '../worker/types';
import { defaultExportOptions, drawExport, type ExportOptions } from './encoding';

export const PREVIEW_EDGE = 1600;
export const MAX_PIXELS = 40_000_000;

export function imageInfo(width: number, height: number): PhotoInfo {
  if (!width || !height || width * height > MAX_PIXELS || Math.max(width, height) > 16384) {
    throw new Error('This photo is too large. Try an image under 40 megapixels and 16,384 pixels per side.');
  }
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
  return { width, height, previewWidth: Math.max(1, Math.round(width * scale)), previewHeight: Math.max(1, Math.round(height * scale)) };
}

export function validatePhoto(file: File) {
  if (/\.xmp$/i.test(file.name)) throw new Error('XMP presets aren’t supported yet. Choose a JPEG, PNG, or WebP photo.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  }
  if (file.size > 60 * 1024 * 1024) throw new Error('This file is too large. Choose a photo smaller than 60 MB.');
}

/** Fallback for browsers without worker-side canvas decoding. */
export async function decodeOnMain(file: File): Promise<DecodedPhoto> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const info = imageInfo(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!ctx) throw new Error('Your browser could not create an image canvas.');
    ctx.drawImage(image, 0, 0);
    const pixels = new Uint8Array(ctx.getImageData(0, 0, info.width, info.height).data.buffer);
    canvas.width = info.previewWidth;
    canvas.height = info.previewHeight;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, info.previewWidth, info.previewHeight);
    const previewPixels = new Uint8Array(ctx.getImageData(0, 0, info.previewWidth, info.previewHeight).data.buffer);
    canvas.width = canvas.height = 1;
    return { ...info, pixels, previewPixels };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function encodeOnMain(pixels: Uint8Array, width: number, height: number, options: ExportOptions = defaultExportOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('Your browser could not create an export canvas.');
    drawExport(ctx, pixels, width, height, options);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob?.type === options.format ? resolve(blob) : reject(new Error('This export format is unavailable in your browser.')), options.format, options.quality,
    ));
  } finally {
    canvas.width = canvas.height = 1;
  }
}
