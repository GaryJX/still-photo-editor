import { adjustmentKeys, ENGINE_VERSION, initialRecipe, recipeKey, type Recipe } from '../editor/recipe';
import { curveChannels, defaultCurves, validCurve } from '../editor/curves';
import { colorBands, defaultHsl, hslKeys } from '../editor/hsl';
import { geometryLayout } from '../editor/geometry';
import { cleanLook } from '../editor/look';
import { imageInfo } from '../editor/image';
import type { HistorySnapshot } from '../editor/history';
import type { PhotoInfo } from '../worker/types';

export interface PhotoSession {
  version: 1;
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  info: PhotoInfo;
  history: HistorySnapshot<Recipe>;
  lastExportedKey?: string;
  comparison: number;
  thumbnail?: Blob;
  createdAt: number;
  updatedAt: number;
}
export type SaveStatus = 'saving' | 'saved' | 'session';
export interface SessionEntry { document: PhotoSession; status: SaveStatus }

export function restoreRecipe(value: unknown): Recipe {
  const input = value as Recipe;
  if (!input || input.schemaVersion !== 1 || input.engineVersion !== ENGINE_VERSION) throw new Error('This saved photo uses an unsupported edit version.');
  const result: Recipe = { ...initialRecipe, curves: defaultCurves(), hsl: defaultHsl() };
  for (const key of adjustmentKeys) {
    if (!Number.isFinite(input[key]) || Math.abs(input[key]) > (key === 'exposure' ? 4 : 100)) throw new Error('Invalid saved adjustment.');
    result[key] = input[key];
  }
  for (const channel of curveChannels) {
    if (!validCurve(input.curves?.[channel])) throw new Error('Invalid saved curve.');
    result.curves[channel] = input.curves[channel].map(([x, y]) => [x, y]);
  }
  for (const band of colorBands) for (const key of hslKeys) {
    const value = input.hsl?.[band]?.[key];
    if (!Number.isFinite(value) || Math.abs(value) > 100) throw new Error('Invalid saved color mix.');
    result.hsl[band][key] = value;
  }
  geometryLayout(1, 1, input.geometry);
  result.geometry = { crop: { ...input.geometry.crop }, rotation: input.geometry.rotation };
  result.look = cleanLook(input.look);
  return result;
}

export function restoreSession(value: unknown): PhotoSession {
  const input = value as PhotoSession;
  if (!input || input.version !== 1 || typeof input.id !== 'string' || !/^[\da-f-]{36}$/.test(input.id) || typeof input.name !== 'string' || !input.name || input.name.length > 512 || typeof input.type !== 'string' || !Number.isFinite(input.size) || input.size <= 0 || input.size > 60 * 1024 * 1024) throw new Error('Invalid saved photo.');
  if (![input.createdAt, input.updatedAt, input.lastModified].every(Number.isFinite) || !Number.isInteger(input.info?.width) || !Number.isInteger(input.info?.height) || input.info.width <= 0 || input.info.height <= 0) throw new Error('Invalid saved photo metadata.');
  const history = input.history;
  if (!history || !Array.isArray(history.past) || !Array.isArray(history.future) || history.past.length > 100 || history.future.length > 100) throw new Error('Invalid saved history.');
  const current = restoreRecipe(history.current);
  let exported: string | undefined;
  if (typeof input.lastExportedKey === 'string') {
    try {
      const value = JSON.parse(input.lastExportedKey);
      // Rendering keys deliberately omit a look's display name/capabilities.
      if (value.look) value.look = { ...value.look, name: 'Saved look', supportsAmount: true };
      exported = recipeKey(restoreRecipe(value));
    } catch { /* Keep the photo; an invalid export baseline remains unexported. */ }
  }
  const storedThumbnail: unknown = input.thumbnail;
  const thumbnail = storedThumbnail instanceof ArrayBuffer && storedThumbnail.byteLength < 100_000
    ? new Blob([storedThumbnail], { type: 'image/jpeg' })
    : storedThumbnail instanceof Blob && storedThumbnail.size < 100_000 && storedThumbnail.type === 'image/jpeg' ? storedThumbnail : undefined;
  return {
    version: 1, id: input.id, name: input.name, type: input.type, size: input.size, lastModified: input.lastModified,
    info: imageInfo(input.info.width, input.info.height), history: { current, past: history.past.map(restoreRecipe), future: history.future.map(restoreRecipe) },
    comparison: Number.isFinite(input.comparison) ? Math.max(0, Math.min(100, input.comparison)) : 50,
    lastExportedKey: exported,
    ...(thumbnail ? { thumbnail } : {}),
    createdAt: input.createdAt, updatedAt: input.updatedAt,
  };
}

export function sessionLutIds(history: HistorySnapshot<Recipe>) {
  return new Set([history.current, ...history.past, ...history.future].flatMap(recipe => recipe.look?.kind === 'lut' ? [recipe.look.assetId] : []));
}
