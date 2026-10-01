import { expose, transfer } from 'comlink';
import init, { ImageEngine } from '../../crates/image-engine/pkg/image_engine';
import { imageInfo } from '../editor/image';
import type { DecodedPhoto, EngineApi, Frame, LoadedPhoto, PhotoInfo } from './types';
import { ENGINE_VERSION, initialRecipe, recipeKey, recipeValues, type Recipe } from '../editor/recipe';
import { curveValues } from '../editor/curves';
import { hslValues } from '../editor/hsl';
import { geometryKey, geometryLayout } from '../editor/geometry';
import { drawExport, validateExport } from '../editor/encoding';

const wasm = init();
let memory: WebAssembly.Memory;
let engine: ImageEngine | undefined;
let info: PhotoInfo | undefined;
let cachedOriginal: Frame | undefined;

async function openDecoded(photo: DecodedPhoto): Promise<LoadedPhoto> {
  memory = (await wasm).memory;
  const next = new ImageEngine(photo.pixels, photo.previewPixels);
  engine?.free();
  engine = next;
  info = { width: photo.width, height: photo.height, previewWidth: photo.previewWidth, previewHeight: photo.previewHeight };
  const frame = render(initialRecipe);
  cachedOriginal = { ...frame, pixels: frame.pixels.slice() };
  return transfer({ info, frame }, [frame.pixels.buffer as ArrayBuffer]);
}

function render(recipe: Recipe, fullResolution = false): Frame {
  if (!engine || !info) throw new Error('Open a photo first.');
  if (recipe.schemaVersion !== 1 || recipe.engineVersion !== ENGINE_VERSION) throw new Error('This edit recipe is not supported.');
  const started = performance.now();
  const layout = geometryLayout(fullResolution ? info.width : info.previewWidth, fullResolution ? info.height : info.previewHeight, recipe.geometry);
  const output = geometryLayout(info.width, info.height, recipe.geometry);
  const pixels = engine.render(recipeValues(recipe), curveValues(recipe.curves), hslValues(recipe.hsl), layout.values, fullResolution);
  return {
    pixels,
    width: layout.width,
    height: layout.height,
    outputWidth: output.width,
    outputHeight: output.height,
    geometryKey: geometryKey(recipe.geometry),
    exposure: recipe.exposure,
    recipeKey: recipeKey(recipe),
    metrics: { renderMs: performance.now() - started, wasmMemoryBytes: memory.buffer.byteLength, retainedBytes: engine.retained_bytes() },
  };
}

const api: EngineApi = {
  async ready() { await wasm; },
  async open(file) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return 'decode-on-main';
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { return 'decode-on-main'; }
    let canvas: OffscreenCanvas | undefined;
    try {
      const dimensions = imageInfo(bitmap.width, bitmap.height);
      canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!ctx) return 'decode-on-main';
      ctx.drawImage(bitmap, 0, 0);
      const pixels = new Uint8Array(ctx.getImageData(0, 0, dimensions.width, dimensions.height).data.buffer);
      canvas.width = dimensions.previewWidth;
      canvas.height = dimensions.previewHeight;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, dimensions.previewWidth, dimensions.previewHeight);
      const previewPixels = new Uint8Array(ctx.getImageData(0, 0, dimensions.previewWidth, dimensions.previewHeight).data.buffer);
      return await openDecoded({ ...dimensions, pixels, previewPixels });
    } finally {
      bitmap.close();
      if (canvas) canvas.width = canvas.height = 1;
    }
  },
  openDecoded,
  render(recipe, knownOriginalGeometry) {
    const frame = render(recipe);
    const buffers = [frame.pixels.buffer as ArrayBuffer];
    if (frame.geometryKey !== knownOriginalGeometry) {
      if (cachedOriginal?.geometryKey !== frame.geometryKey) cachedOriginal = render({ ...initialRecipe, geometry: recipe.geometry });
      frame.original = { ...cachedOriginal, pixels: cachedOriginal.pixels.slice() };
      buffers.push(frame.original.pixels.buffer as ArrayBuffer);
    }
    return transfer(frame, buffers);
  },
  async exportImage(recipe, options) {
    validateExport(options);
    const started = performance.now();
    const frame = render(recipe, true);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      try {
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (ctx && typeof canvas.convertToBlob === 'function') {
          drawExport(ctx, frame.pixels, frame.width, frame.height, options);
          const blob = await canvas.convertToBlob({ type: options.format, quality: options.quality });
          if (blob.type === options.format) return { blob, metrics: frame.metrics, totalMs: performance.now() - started };
        }
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    return transfer({ frame, metrics: frame.metrics, totalMs: performance.now() - started }, [frame.pixels.buffer as ArrayBuffer]);
  },
};

expose(api);
