export interface Recipe {
  schemaVersion: 1;
  engineVersion: '0.1.0';
  exposure: number;
}

export const initialRecipe: Recipe = { schemaVersion: 1, engineVersion: '0.1.0', exposure: 0 };

export function exposureRecipe(value: number): Recipe {
  if (!Number.isFinite(value)) throw new Error('Enter a valid exposure value.');
  return { ...initialRecipe, exposure: Math.round(Math.max(-4, Math.min(4, value)) * 100) / 100 };
}
