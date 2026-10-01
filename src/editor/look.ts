import { curveChannels, defaultCurves, validCurve, type Curves } from './curves';

export interface CurveLook { kind: 'curves'; name: string; amount: number; supportsAmount: boolean; curves: Curves; uuid?: string }
export interface LutLook { kind: 'lut'; name: string; amount: number; assetId: string }
export type Look = CurveLook | LutLook | null;

export function cleanLook(value: Look): Look {
  if (value === null) return null;
  if (!value || !['curves', 'lut'].includes(value.kind) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 96 || !Number.isFinite(value.amount) || value.amount < 0 || value.amount > 2) throw new Error('Invalid look settings.');
  if (value.kind === 'lut') {
    if (!/^[a-f0-9]{64}$/.test(value.assetId)) throw new Error('Invalid LUT reference.');
    return { kind: 'lut', name: value.name, amount: value.amount, assetId: value.assetId };
  }
  if (typeof value.supportsAmount !== 'boolean' || (!value.supportsAmount && value.amount !== 1) || !curveChannels.every(channel => validCurve(value.curves[channel]))) throw new Error('Invalid look curves.');
  const curves = defaultCurves();
  for (const channel of curveChannels) curves[channel] = value.curves[channel].map(([x, y]) => [x, y]);
  return { kind: 'curves', name: value.name, amount: value.amount, supportsAmount: value.supportsAmount, curves, ...(value.uuid && /^[a-fA-F0-9]{32}$/.test(value.uuid) ? { uuid: value.uuid } : {}) };
}

export function renderingLook(look: Look) {
  if (!look || look.amount === 0) return null;
  return look.kind === 'lut' ? { kind: look.kind, amount: look.amount, assetId: look.assetId } : { kind: look.kind, amount: look.amount, curves: look.curves };
}
