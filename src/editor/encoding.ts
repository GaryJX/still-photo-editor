export const exportFormats = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ExportFormat = typeof exportFormats[number];
export interface ExportOptions { format: ExportFormat; quality: number; background: 'white' | 'black' }
export const defaultExportOptions: ExportOptions = { format: 'image/png', quality: 0.9, background: 'white' };
export const formatNames: Record<ExportFormat, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
export const formatExtensions: Record<ExportFormat, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function validateExport(options: ExportOptions) {
  if (!exportFormats.includes(options.format) || !Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 1 || !['white', 'black'].includes(options.background)) throw new Error('Invalid export options.');
}

export function drawExport(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, pixels: Uint8Array, width: number, height: number, options: ExportOptions) {
  validateExport(options);
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height), 0, 0);
  if (options.format === 'image/jpeg') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = options.background;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  }
}

export async function supportedExportFormats(): Promise<ExportFormat[]> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const supported: ExportFormat[] = [];
  for (const format of exportFormats) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, format));
    if (blob?.type === format) supported.push(format);
  }
  return supported;
}
