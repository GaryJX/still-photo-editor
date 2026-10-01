import { useLayoutEffect } from 'preact/hooks';
import { initialRecipe, recipeKey, type Recipe } from './recipe';

export function hasUnexportedEdits(hasPhoto: boolean, recipe: Recipe, lastExportedKey?: string) {
  const current = recipeKey(recipe);
  return hasPhoto && current !== recipeKey(initialRecipe) && current !== lastExportedKey;
}

export function useUnsavedEditWarning(hasPhoto: boolean, recipe: Recipe, lastExportedKey?: string, otherUnexportedEdits = false) {
  const dirty = otherUnexportedEdits || hasUnexportedEdits(hasPhoto, recipe, lastExportedKey);
  useLayoutEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers choose the dialog wording. returnValue supports older engines.
      event.returnValue = 'You have edits that have not been exported.';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
