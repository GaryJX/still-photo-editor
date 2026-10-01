import { validCurve, type CurveChannel, type CurvePoint, type Curves } from '../editor/curves';
import { xmpHslFields, type HslPatch } from '../editor/hsl';
import type { Adjustment } from '../editor/recipe';

export const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export type PresetPatch = Partial<Record<Adjustment, number>> & { curves?: Partial<Curves>; hsl?: HslPatch };
export const STILL = 'https://garyjx.github.io/wasm-image-editor/xmp/1.0/';

export const scalarFields: Record<string, [Adjustment, string]> = {
  Exposure2012: ['exposure', 'Exposure'], Contrast2012: ['contrast', 'Contrast'],
  Saturation: ['saturation', 'Color intensity'], Vibrance: ['vibrance', 'Vibrance'],
  IncrementalTemperature: ['warmth', 'Warmth'], IncrementalTint: ['tint', 'Tint'],
};
export const curveFields: Record<string, CurveChannel> = {
  ToneCurvePV2012: 'master', ToneCurvePV2012Red: 'red', ToneCurvePV2012Green: 'green', ToneCurvePV2012Blue: 'blue',
};
export function validatePresetPatch(patch: PresetPatch) {
  let count = 0;
  const check = (name: string, value: number, limit: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > limit) throw new Error(`${name} is outside its supported export range.`);
    count++;
  };
  for (const [field, [key]] of Object.entries(scalarFields)) if (patch[key] !== undefined) check(field, patch[key]!, key === 'exposure' ? 4 : 100);
  for (const [field, [band, key]] of Object.entries(xmpHslFields)) if (patch.hsl?.[band]?.[key] !== undefined) check(field, patch.hsl[band]![key]!, 100);
  for (const channel of Object.values(curveFields)) if (patch.curves?.[channel]) {
    if (!validCurve(patch.curves[channel]!)) throw new Error(`The ${channel} curve cannot be exported.`);
    count++;
  }
  if (!count) throw new Error('Select at least one adjustment group.');
}

export function cleanPresetPatch(patch: PresetPatch): PresetPatch {
  validatePresetPatch(patch);
  const clean: PresetPatch = {};
  for (const [key] of Object.values(scalarFields)) if (patch[key] !== undefined) clean[key] = patch[key];
  for (const [band, key] of Object.values(xmpHslFields)) if (patch.hsl?.[band]?.[key] !== undefined) {
    clean.hsl ??= {}; clean.hsl[band] ??= {}; clean.hsl[band]![key] = patch.hsl[band]![key];
  }
  for (const channel of Object.values(curveFields)) if (patch.curves?.[channel]) {
    clean.curves ??= {}; clean.curves[channel] = patch.curves[channel]!.map(([x, y]) => [x, y] as CurvePoint);
  }
  return clean;
}

export function restorePrecision(native: PresetPatch, exact: PresetPatch) {
  const clean = cleanPresetPatch(exact);
  for (const [key] of Object.values(scalarFields)) if (native[key] !== undefined && clean[key] !== undefined) native[key] = clean[key];
  for (const [band, key] of Object.values(xmpHslFields)) if (native.hsl?.[band]?.[key] !== undefined && clean.hsl?.[band]?.[key] !== undefined) native.hsl[band]![key] = clean.hsl[band]![key];
  for (const channel of Object.values(curveFields)) if (native.curves?.[channel] && clean.curves?.[channel]) native.curves[channel] = clean.curves[channel];
}
