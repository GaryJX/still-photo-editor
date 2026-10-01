export const colorBands = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export const hslKeys = ['hue', 'saturation', 'luminance'] as const;
export type ColorBand = typeof colorBands[number];
export type HslKey = typeof hslKeys[number];
export type BandAdjustment = Record<HslKey, number>;
export type HslSettings = Record<ColorBand, BandAdjustment>;
export type HslPatch = Partial<Record<ColorBand, Partial<BandAdjustment>>>;
export const emptyBand = (): BandAdjustment => ({ hue: 0, saturation: 0, luminance: 0 });
export const defaultHsl = () => Object.fromEntries(colorBands.map(band => [band, emptyBand()])) as HslSettings;
export const hslValues = (settings: HslSettings) => new Float32Array(colorBands.flatMap(band => hslKeys.map(key => settings[band][key])));
export const bandLabel = (band: ColorBand) => band[0].toUpperCase() + band.slice(1);
export const hslLabels: Record<HslKey, string> = { hue: 'Hue', saturation: 'Intensity', luminance: 'Brightness' };

export const xmpHslFields = Object.fromEntries(colorBands.flatMap(band => hslKeys.map(key => [
  `${key === 'hue' ? 'Hue' : key === 'saturation' ? 'Saturation' : 'Luminance'}Adjustment${bandLabel(band)}`, [band, key],
]))) as Record<string, [ColorBand, HslKey]>;

export function mergeHsl(current: HslSettings, patch?: HslPatch): HslSettings {
  return Object.fromEntries(colorBands.map(band => [band, { ...current[band], ...patch?.[band] }])) as HslSettings;
}
