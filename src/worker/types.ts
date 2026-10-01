import type { Recipe } from '../editor/recipe';

export interface PhotoInfo {
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
}

export interface DecodedPhoto extends PhotoInfo {
  pixels: Uint8Array;
  previewPixels: Uint8Array;
}

export interface RenderMetrics {
  renderMs: number;
  wasmMemoryBytes: number;
  retainedBytes: number;
}

export interface Frame {
  pixels: Uint8Array;
  width: number;
  height: number;
  exposure: number;
  recipeKey: string;
  geometryKey: string;
  outputWidth: number;
  outputHeight: number;
  original?: Frame;
  metrics: RenderMetrics;
}

export interface LoadedPhoto { info: PhotoInfo; frame: Frame }
export interface ExportedPhoto {
  blob?: Blob;
  frame?: Frame;
  metrics: RenderMetrics;
  totalMs: number;
}

export interface EngineApi {
  open(file: File): Promise<LoadedPhoto | 'decode-on-main'>;
  openDecoded(photo: DecodedPhoto): Promise<LoadedPhoto>;
  render(recipe: Recipe, knownOriginalGeometry?: string): Frame;
  exportPng(recipe: Recipe): Promise<ExportedPhoto>;
}
