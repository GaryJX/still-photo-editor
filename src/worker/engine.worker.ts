import { expose, transfer } from 'comlink';
import init, { ImageEngine } from '../../crates/image-engine/pkg/image_engine';
import { imageInfo } from '../editor/image';
import type { DecodedPhoto, EngineApi, Frame, LoadedPhoto, PhotoInfo } from './types';
import { ENGINE_VERSION, initialRecipe, recipeKey, recipeValues, type Recipe } from '../editor/recipe';
import { curveValues } from '../editor/curves';

const wasm = init();
let memory: WebAssembly.Memory;
let engine: ImageEngine | undefined;
let info: PhotoInfo | undefined;

async function openDecoded(photo: DecodedPhoto): Promise<LoadedPhoto> {
  memory = (await wasm).memory;
  const next = new ImageEngine(photo.pixels, photo.previewPixels);
  engine?.free();
  engine = next;
  info = { width: photo.width, height: photo.height, previewWidth: photo.previewWidth, previewHeight: photo.previewHeight };
  const frame = render(initialRecipe);
  return transfer({ info, frame }, [frame.pixels.buffer as ArrayBuffer]);
}

function render(recipe: Recipe, fullResolution = false): Frame {
  if (!engine || !info) throw new Error('Open a photo first.');
  if (recipe.schemaVersion !== 1 || recipe.engineVersion !== ENGINE_VERSION) throw new Error('This edit recipe is not supported.');
  const started = performance.now();
  const pixels = engine.render(recipeValues(recipe), curveValues(recipe.curves), fullResolution);
  return {
    pixels,
    width: fullResolution ? info.width : info.previewWidth,
    height: fullResolution ? info.height : info.previewHeight,
    exposure: recipe.exposure,
    recipeKey: recipeKey(recipe),
    metrics: { renderMs: performance.now() - started, wasmMemoryBytes: memory.buffer.byteLength, retainedBytes: engine.retained_bytes() },
  };
}

const api: EngineApi = {
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
  render(recipe) {
    const frame = render(recipe);
    return transfer(frame, [frame.pixels.buffer as ArrayBuffer]);
  },
  async exportPng(recipe) {
    const started = performance.now();
    const frame = render(recipe, true);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      try {
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (ctx && typeof canvas.convertToBlob === 'function') {
          ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.buffer as ArrayBuffer), frame.width, frame.height), 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          return { blob, metrics: frame.metrics, totalMs: performance.now() - started };
        }
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    return transfer({ frame, metrics: frame.metrics, totalMs: performance.now() - started }, [frame.pixels.buffer as ArrayBuffer]);
  },
};

expose(api);
