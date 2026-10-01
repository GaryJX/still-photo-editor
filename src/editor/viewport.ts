import type { DetailRegion } from '../worker/types';

export interface View { zoom: number; x: number; y: number }
export interface Size { width: number; height: number }
export const fitView = (): View => ({ zoom: 1, x: 0, y: 0 });
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function boundView(view: View, size: Size, maxZoom: number): View {
  const zoom = clamp(view.zoom, 1, maxZoom);
  if (zoom === 1) return fitView();
  const limitX = size.width * (zoom - 1) / 2, limitY = size.height * (zoom - 1) / 2;
  return { zoom, x: clamp(view.x, -limitX, limitX), y: clamp(view.y, -limitY, limitY) };
}

/** Anchor coordinates are relative to the viewport center. */
export function zoomAt(view: View, zoom: number, anchor: { x: number; y: number }, size: Size, maxZoom: number): View {
  zoom = clamp(zoom, 1, maxZoom);
  const ratio = zoom / view.zoom;
  return boundView({ zoom, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, size, maxZoom);
}

export function detailRegion(view: View, viewport: Size, source: Size, pixelRatio: number): DetailRegion | undefined {
  if (view.zoom <= 1 || viewport.width <= 0 || viewport.height <= 0) return;
  const scaleX = viewport.width * view.zoom / source.width, scaleY = viewport.height * view.zoom / source.height;
  const left = (source.width - viewport.width / scaleX) / 2 - view.x / scaleX;
  const top = (source.height - viewport.height / scaleY) / 2 - view.y / scaleY;
  const x = clamp(Math.floor(left), 0, source.width - 1), y = clamp(Math.floor(top), 0, source.height - 1);
  const width = Math.max(1, Math.min(source.width, Math.ceil(left + viewport.width / scaleX)) - x);
  const height = Math.max(1, Math.min(source.height, Math.ceil(top + viewport.height / scaleY)) - y);
  // Bound both output buffers to 2048²; never upscale source pixels in WASM.
  const resolution = Math.min(1, Math.max(scaleX, scaleY) * clamp(pixelRatio, 1, 2), 2048 / width, 2048 / height);
  return { x, y, width, height, outputWidth: Math.max(1, Math.min(2048, Math.ceil(width * resolution))), outputHeight: Math.max(1, Math.min(2048, Math.ceil(height * resolution))) };
}
