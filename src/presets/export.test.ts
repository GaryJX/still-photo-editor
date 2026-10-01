import { describe, expect, it } from 'vitest';
import { allPresetGroups, presetPatch, validatePresetPatch } from './export';
import { initialRecipe } from '../editor/recipe';
import { cleanPresetPatch } from './schema';

describe('preset export selection', () => {
  it('exports selected color settings and excludes geometry and image state', () => {
    const recipe = { ...initialRecipe, exposure: 1, warmth: 25, geometry: { crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, rotation: 1 } };
    expect(presetPatch(recipe, { light: true, color: false, curves: false, hsl: false, look: false })).toEqual({ exposure: 1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 });
    expect(presetPatch(recipe, allPresetGroups)).not.toHaveProperty('geometry');
    expect(cleanPresetPatch({ exposure: 1, geometry: recipe.geometry } as unknown as Parameters<typeof cleanPresetPatch>[0])).toEqual({ exposure: 1 });
  });
  it('rejects out-of-range, non-finite, empty, and invalid curve settings', () => {
    expect(() => validatePresetPatch({ exposure: 5 })).toThrow();
    expect(() => validatePresetPatch({ warmth: NaN })).toThrow();
    expect(() => validatePresetPatch({ hsl: { green: { hue: 101 } } })).toThrow();
    expect(() => validatePresetPatch({ curves: { red: [[1, 0], [0, 1]] } })).toThrow();
    expect(() => validatePresetPatch({})).toThrow();
    expect(() => validatePresetPatch({ exposure: 1 })).not.toThrow();
  });
});
