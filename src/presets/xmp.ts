import type { Recipe } from '../editor/recipe';
import { CRS, RDF, STILL, scalarFields, curveFields, restorePrecision, type PresetPatch } from './schema';
export { CRS, RDF, scalarFields, curveFields, type PresetPatch } from './schema';
import { validCurve } from '../editor/curves';
import { cleanLook } from '../editor/look';
import { readLook } from './look';
import { readCurveField } from './curve-field';
import { bandLabel, hslLabels, mergeHsl, xmpHslFields } from '../editor/hsl';

export const PARSER_VERSION = 4;
export const MAX_XMP_BYTES = 2 * 1024 * 1024;
export interface ImportReport { applied: string[]; approximated: string[]; unsupported: string[]; invalid: string[]; warnings: string[] }
export interface ParsedPreset { name: string; patch: PresetPatch; report: ImportReport }
export interface SavedPreset extends ParsedPreset { id: string; xml: string; parserVersion: number; createdAt: number; sessionOnly?: boolean }

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
  const precision: Element[] = [];
  const localLooks: Element[] = [];
  const add = (key: string, text: string, element?: Element) => {
    if (fields.has(key)) duplicates.add(key);
    else fields.set(key, { text: text.trim(), element });
  };
  for (const description of document.getElementsByTagNameNS(RDF, 'Description')) {
    // Nested RDF descriptions may describe masks or profiles, not global edits.
    if (description.parentElement?.namespaceURI !== RDF || description.parentElement.localName !== 'RDF') continue;
    for (const attribute of description.attributes) if (attribute.namespaceURI === CRS) add(attribute.localName, attribute.value);
    for (const child of description.children) {
      if (child.namespaceURI === CRS) add(child.localName, child.textContent ?? '', child);
      else if (child.namespaceURI === STILL && child.localName === 'Settings') precision.push(child);
      else if (child.namespaceURI === STILL && child.localName === 'Look') localLooks.push(child);
    }
  }
  if (!fields.size) throw new Error('This XMP has no Camera Raw preset settings.');
  if (fields.size > 512) throw new Error('This XMP contains too many settings.');
  const patch: PresetPatch = {};
  for (const [key, field] of fields) {
    if (duplicates.has(key)) { report.invalid.push(`${key}: duplicate field`); continue; }
    if (Object.hasOwn(scalarFields, key)) {
      const [target, label] = scalarFields[key];
      const value = field.element?.childElementCount ? NaN : numeric(field.text);
      const limit = target === 'exposure' ? 4 : 100;
      if (!Number.isFinite(value) || Math.abs(value) > limit) { report.invalid.push(`${key}: expected a number from ${-limit} to ${limit}`); continue; }
      patch[target] = value;
      report.applied.push(label);
      if (target !== 'exposure') report.approximated.push(label);
    } else if (Object.hasOwn(xmpHslFields, key)) {
      const [band, component] = xmpHslFields[key];
      const value = field.element?.childElementCount ? NaN : numeric(field.text);
      if (!Number.isFinite(value) || Math.abs(value) > 100) { report.invalid.push(`${key}: expected a number from -100 to 100`); continue; }
      patch.hsl ??= {}; patch.hsl[band] ??= {}; patch.hsl[band]![component] = value;
      const label = `${bandLabel(band)} ${hslLabels[component].toLowerCase()}`;
      report.applied.push(label); report.approximated.push(label);
    } else if (Object.hasOwn(curveFields, key)) {
      const points = readCurveField(field.element);
      if (!validCurve(points)) { report.invalid.push(`${key}: expected 2–32 ordered points spanning input 0 to 255`); continue; }
      patch.curves ??= {};
      patch.curves[curveFields[key]] = points;
      const label = `${curveFields[key] === 'master' ? 'Master' : curveFields[key]} curve`;
      report.applied.push(label); report.approximated.push(label);
    } else if (key === 'Look') {
      const parsed = readLook(field.element, field.element ? 'Unnamed look' : field.text);
      if (parsed.look) { patch.look = parsed.look; report.applied.push(`Look: ${parsed.look.name}`); report.approximated.push(`Look: ${parsed.look.name}`); }
      else report.unsupported.push(parsed.message!);
    } else if (key === 'ProcessVersion') {
      if (!['6.7', '10.0', '11.0', '15.0', '15.4'].includes(field.text)) report.warnings.push(`Unrecognized ProcessVersion ${field.text.slice(0, 40)}; only explicitly supported fields are interpreted.`);
    } else if (!metadata.has(key) && !key.startsWith('Supports')) {
      report.unsupported.push(key === 'Temperature' || key === 'Tint' || key === 'WhiteBalance' ? `${key} (absolute RAW white balance)` : key);
    }
  }
  if (localLooks.length) {
    try {
      if (localLooks.length !== 1 || fields.has('Look') || localLooks[0].getAttribute('version') !== '1') throw new Error('Conflicting look data');
      patch.look = cleanLook(JSON.parse(localLooks[0].textContent ?? ''));
      report.applied.push(patch.look ? `Look: ${patch.look.name}` : 'Look reset');
    } catch { report.invalid.push('Still look metadata was invalid or conflicted with a Camera Raw look.'); }
  }
  if (precision.length) {
    try {
      if (precision.length !== 1 || precision[0].getAttribute('version') !== '1') throw new Error('Unrecognized precision metadata');
      restorePrecision(patch, JSON.parse(precision[0].textContent ?? ''));
    } catch { report.invalid.push('Still full-precision settings were invalid; standard XMP values were used.'); }
  }
  return { name: (fields.get('Name')?.text || fallbackName.replace(/\.xmp$/i, '') || 'Imported preset').slice(0, 96), patch, report };
}

export function applyPresetPatch(recipe: Recipe, patch: PresetPatch): Recipe {
  return { ...recipe, ...patch, curves: { ...recipe.curves, ...patch.curves }, hsl: mergeHsl(recipe.hsl, patch.hsl) };
}

export async function createPreset(xml: string, filename: string): Promise<SavedPreset> {
  const parsed = parseXmp(xml, filename);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml));
  const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ...parsed, id, xml, parserVersion: PARSER_VERSION, createdAt: Date.now() };
}
