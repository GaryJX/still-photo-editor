import { defaultCurves, type Curves } from './curves';
import { defaultHsl, type HslSettings } from './hsl';
import { defaultGeometry, type Geometry } from './geometry';
import { renderingLook, type Look } from './look';

export const ENGINE_VERSION = '0.7.0';
export const toneAdjustmentKeys = ['highlights', 'shadows', 'whites', 'blacks'] as const;
export const adjustmentKeys = ['exposure', 'contrast', 'warmth', 'tint', 'saturation', 'vibrance', ...toneAdjustmentKeys] as const;
export type Adjustment = typeof adjustmentKeys[number];

export interface Recipe {
  schemaVersion: 1;
  engineVersion: typeof ENGINE_VERSION;
  exposure: number;
  contrast: number;
  warmth: number;
  tint: number;
  saturation: number;
  vibrance: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  curves: Curves;
  hsl: HslSettings;
  geometry: Geometry;
  look: Look;
}

export const initialRecipe: Recipe = {
  schemaVersion: 1, engineVersion: ENGINE_VERSION,
  exposure: 0, contrast: 0, warmth: 0, tint: 0, saturation: 0, vibrance: 0,
  highlights: 0, shadows: 0, whites: 0, blacks: 0,
  curves: defaultCurves(),
  hsl: defaultHsl(),
  geometry: defaultGeometry(),
  look: null,
};

export function adjustmentValue(key: Adjustment, value: number): number {
  if (!Number.isFinite(value)) throw new Error('Enter a valid adjustment value.');
  const limit = key === 'exposure' ? 4 : 100;
  return Math.round(Math.max(-limit, Math.min(limit, value)) * 100) / 100;
}

export const recipeKey = (recipe: Recipe) => JSON.stringify({ ...recipe, look: renderingLook(recipe.look) });
export const recipeValues = (recipe: Recipe) => new Float32Array(adjustmentKeys.map(key => recipe[key]));
