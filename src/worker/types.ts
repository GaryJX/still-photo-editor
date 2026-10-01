import type { Recipe } from '../editor/recipe';
import type { ExportOptions } from '../editor/encoding';
import type { LutAsset } from '../editor/cube';

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

export interface DetailRegion {
  x: number; y: number; width: number; height: number;
  outputWidth: number; outputHeight: number;
}
export interface DetailFrame { edited: Frame; original: Frame; region: DetailRegion }

export interface LoadedPhoto { info: PhotoInfo; frame: Frame }
export interface ExportedPhoto {
  blob?: Blob;
  frame?: Frame;
  metrics: RenderMetrics;
  totalMs: number;
}

export interface EngineApi {
  ready(): Promise<void>;
  importLut(file: File): Promise<LutAsset>;
  installLut(asset: LutAsset): Promise<void>;
  open(file: File): Promise<LoadedPhoto | 'decode-on-main'>;
  openDecoded(photo: DecodedPhoto): Promise<LoadedPhoto>;
  render(recipe: Recipe, knownOriginalGeometry?: string): Frame;
  renderDetail(recipe: Recipe, region: DetailRegion): DetailFrame;
  exportImage(recipe: Recipe, options: ExportOptions): Promise<ExportedPhoto>;
}
