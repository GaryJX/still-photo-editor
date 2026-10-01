import { expose, transfer } from 'comlink';
import init, { ImageEngine } from '../../crates/image-engine/pkg/image_engine';
import { imageInfo } from '../editor/image';
import type { DecodedPhoto, DetailRegion, EngineApi, Frame, LoadedPhoto, PhotoInfo } from './types';
import { ENGINE_VERSION, initialRecipe, recipeKey, recipeValues, type Recipe } from '../editor/recipe';
import { curveValues } from '../editor/curves';
import { cleanLook } from '../editor/look';
import { cubeId, parseCube, MAX_CUBE_BYTES, type Cube } from '../editor/cube';
import { hslValues } from '../editor/hsl';
import { geometryKey, geometryLayout } from '../editor/geometry';
import { drawExport, validateExport } from '../editor/encoding';

const wasm = init();
let memory: WebAssembly.Memory;
let engine: ImageEngine | undefined;
let info: PhotoInfo | undefined;
let cachedOriginal: Frame | undefined;
const luts = new Map<string, Cube>();
let activeLutId: string | undefined;

async function openDecoded(photo: DecodedPhoto): Promise<LoadedPhoto> {
  memory = (await wasm).memory;
  const next = new ImageEngine(photo.pixels, photo.previewPixels);
  engine?.free();
  engine = next;
  activeLutId = undefined;
  info = { width: photo.width, height: photo.height, previewWidth: photo.previewWidth, previewHeight: photo.previewHeight };
  const frame = render(initialRecipe);
  cachedOriginal = { ...frame, pixels: frame.pixels.slice() };
  return transfer({ info, frame }, [frame.pixels.buffer as ArrayBuffer]);
}

function render(recipe: Recipe, fullResolution = false, region?: DetailRegion): Frame {
  if (!engine || !info) throw new Error('Open a photo first.');
  if (recipe.schemaVersion !== 1 || recipe.engineVersion !== ENGINE_VERSION) throw new Error('This edit recipe is not supported.');
  const started = performance.now();
  const layout = geometryLayout(fullResolution ? info.width : info.previewWidth, fullResolution ? info.height : info.previewHeight, recipe.geometry);
  const output = geometryLayout(info.width, info.height, recipe.geometry);
  const look = cleanLook(recipe.look);
  if (look?.kind === 'lut' && look.amount > 0 && activeLutId !== look.assetId) {
    const lut = luts.get(look.assetId);
    if (!lut) throw new Error(`Import the .cube file for ${look.name} to use this look.`);
    engine.set_lut(lut.kind, lut.size, lut.domain, lut.data);
    activeLutId = look.assetId;
  }
  let layoutValues = layout.values;
  if (region) {
    const values = [region.x, region.y, region.width, region.height, region.outputWidth, region.outputHeight];
    if (values.some(value => !Number.isSafeInteger(value) || value < 0 || value > 16_384)) throw new Error('Invalid detail region.');
    layoutValues = new Uint32Array([...layout.values, ...values]);
  }
  const lookCurves = look?.kind === 'curves' ? curveValues(look.curves) : new Float32Array();
  const pixels = engine.render(recipeValues(recipe), curveValues(recipe.curves), hslValues(recipe.hsl), lookCurves, look?.amount ?? 0, look?.kind === 'lut', layoutValues, fullResolution);
  return {
    pixels,
    width: region?.outputWidth ?? layout.width,
    height: region?.outputHeight ?? layout.height,
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
  async importLut(file) {
    if (file.size > MAX_CUBE_BYTES) throw new Error('Choose a .cube file smaller than 20 MB.');
    const source = await file.text(); const cube = parseCube(source, file.name); const id = await cubeId(source);
    luts.set(id, cube);
    return { id, source, name: cube.name, kind: cube.kind, size: cube.size, createdAt: Date.now() };
  },
  async installLut(asset) {
    if (luts.has(asset.id)) return;
    const cube = parseCube(asset.source, asset.name);
    if (await cubeId(asset.source) !== asset.id) throw new Error('The stored LUT does not match its identifier. Reimport the original .cube file.');
    luts.set(asset.id, cube);
  },
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
  renderDetail(recipe, region) {
    const edited = render(recipe, true, region);
    const original = render({ ...initialRecipe, geometry: recipe.geometry }, true, region);
    return transfer({ edited, original, region }, [edited.pixels.buffer as ArrayBuffer, original.pixels.buffer as ArrayBuffer]);
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
