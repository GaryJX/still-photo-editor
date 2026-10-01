import { type Adjustment, type Recipe } from '../editor/recipe';
import { validCurve, type CurveChannel, type CurvePoint, type Curves } from '../editor/curves';

export const PARSER_VERSION = 1;
export const MAX_XMP_BYTES = 2 * 1024 * 1024;
const CRS = 'http://ns.adobe.com/camera-raw-settings/1.0/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export type PresetPatch = Partial<Record<Adjustment, number>> & { curves?: Partial<Curves> };
export interface ImportReport { applied: string[]; approximated: string[]; unsupported: string[]; invalid: string[]; warnings: string[] }
export interface ParsedPreset { name: string; patch: PresetPatch; report: ImportReport }
export interface SavedPreset extends ParsedPreset { id: string; xml: string; parserVersion: number; createdAt: number; sessionOnly?: boolean }

const scalarFields: Record<string, [Adjustment, string]> = {
  Exposure2012: ['exposure', 'Exposure'], Contrast2012: ['contrast', 'Contrast'],
  Saturation: ['saturation', 'Color intensity'], Vibrance: ['vibrance', 'Vibrance'],
  IncrementalTemperature: ['warmth', 'Warmth'], IncrementalTint: ['tint', 'Tint'],
};
const curveFields: Record<string, CurveChannel> = {
  ToneCurvePV2012: 'master', ToneCurvePV2012Red: 'red', ToneCurvePV2012Green: 'green', ToneCurvePV2012Blue: 'blue',
};
const metadata = new Set(['Name', 'ShortName', 'SortName', 'Group', 'Description', 'UUID', 'Version', 'ProcessVersion', 'PresetType', 'Cluster', 'Copyright', 'ContactInfo', 'HasSettings', 'HasCrop', 'AlreadyApplied', 'ToneCurveName2012', 'CameraModelRestriction', 'CameraModel', 'CameraSerialNumber', 'RawFileName', 'Digest', 'IsStub', 'IsHidden', 'RequiresRGBTables', 'SupportsAmount']);
const numeric = (value: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : NaN;

export function parseXmp(xml: string, fallbackName: string): ParsedPreset {
  if (new TextEncoder().encode(xml).length > MAX_XMP_BYTES) throw new Error('Choose an XMP preset smaller than 2 MB.');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error('XMP files containing document types or entity declarations are not supported.');
  const document = new DOMParser().parseFromString(xml.trimStart(), 'application/xml');
  if (document.getElementsByTagName('parsererror').length || !document.documentElement) throw new Error('This XMP file contains invalid XML.');
  const fields = new Map<string, { text: string; element?: Element }>();
  const report: ImportReport = { applied: [], approximated: [], unsupported: [], invalid: [], warnings: [] };
  const duplicates = new Set<string>();
  const add = (key: string, text: string, element?: Element) => {
    if (fields.has(key)) duplicates.add(key);
    else fields.set(key, { text: text.trim(), element });
  };
  for (const description of document.getElementsByTagNameNS(RDF, 'Description')) {
    // Nested RDF descriptions may describe masks or profiles, not global edits.
    if (description.parentElement?.namespaceURI !== RDF || description.parentElement.localName !== 'RDF') continue;
    for (const attribute of description.attributes) if (attribute.namespaceURI === CRS) add(attribute.localName, attribute.value);
    for (const child of description.children) if (child.namespaceURI === CRS) add(child.localName, child.textContent ?? '', child);
  }
  if (!fields.size) throw new Error('This XMP has no Camera Raw preset settings.');
  if (fields.size > 512) throw new Error('This XMP contains too many settings.');
  const patch: PresetPatch = {};
  for (const [key, field] of fields) {
    if (duplicates.has(key)) { report.invalid.push(`${key}: duplicate field`); continue; }
    if (scalarFields[key]) {
      const [target, label] = scalarFields[key];
      const value = field.element?.childElementCount ? NaN : numeric(field.text);
      const limit = target === 'exposure' ? 4 : 100;
      if (!Number.isFinite(value) || Math.abs(value) > limit) { report.invalid.push(`${key}: expected a number from ${-limit} to ${limit}`); continue; }
      patch[target] = value;
      report.applied.push(label);
      if (target !== 'exposure') report.approximated.push(label);
    } else if (curveFields[key]) {
      const sequence = Array.from(field.element?.children ?? []).find(child => child.namespaceURI === RDF && child.localName === 'Seq');
      const points = sequence ? Array.from(sequence.children).map(item => {
        if (item.namespaceURI !== RDF || item.localName !== 'li' || item.childElementCount) return [NaN, NaN] as CurvePoint;
        const values = (item.textContent ?? '').split(',').map(value => numeric(value.trim()) / 255);
        return values.length === 2 ? values as CurvePoint : [NaN, NaN] as CurvePoint;
      }) : [];
      if (!validCurve(points)) { report.invalid.push(`${key}: expected 2–32 ordered points spanning input 0 to 255`); continue; }
      patch.curves ??= {};
      patch.curves[curveFields[key]] = points;
      const label = `${curveFields[key] === 'master' ? 'Master' : curveFields[key]} curve`;
      report.applied.push(label); report.approximated.push(label);
    } else if (key === 'ProcessVersion') {
      if (!['6.7', '10.0', '11.0', '15.0', '15.4'].includes(field.text)) report.warnings.push(`Unrecognized ProcessVersion ${field.text.slice(0, 40)}; only explicitly supported fields are interpreted.`);
    } else if (!metadata.has(key) && !key.startsWith('Supports')) {
      report.unsupported.push(key === 'Temperature' || key === 'Tint' || key === 'WhiteBalance' ? `${key} (absolute RAW white balance)` : key);
    }
  }
  return { name: (fields.get('Name')?.text || fallbackName.replace(/\.xmp$/i, '') || 'Imported preset').slice(0, 96), patch, report };
}

export function applyPresetPatch(recipe: Recipe, patch: PresetPatch): Recipe {
  return { ...recipe, ...patch, curves: { ...recipe.curves, ...patch.curves } };
}

export async function createPreset(xml: string, filename: string): Promise<SavedPreset> {
  const parsed = parseXmp(xml, filename);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml));
  const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ...parsed, id, xml, parserVersion: PARSER_VERSION, createdAt: Date.now() };
}
