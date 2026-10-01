import { describe, expect, it } from 'vitest';
import { hasUnexportedEdits } from './unsaved';
import { initialRecipe, recipeKey } from './recipe';

describe('unexported edits', () => {
  const edited = { ...initialRecipe, exposure: 1 };
  it('requires a photo and changes from defaults', () => {
    expect(hasUnexportedEdits(false, edited)).toBe(false);
    expect(hasUnexportedEdits(true, initialRecipe)).toBe(false);
    expect(hasUnexportedEdits(true, edited)).toBe(true);
  });
  it('compares with the exact exported recipe and always exempts defaults', () => {
    const exported = recipeKey(edited);
    expect(hasUnexportedEdits(true, edited, exported)).toBe(false);
    expect(hasUnexportedEdits(true, { ...edited, tint: 10 }, exported)).toBe(true);
    expect(hasUnexportedEdits(true, initialRecipe, exported)).toBe(false);
    expect(hasUnexportedEdits(true, edited)).toBe(true);
  });
});
