import { validCurve } from '../editor/curves';
import { xmpHslFields } from '../editor/hsl';
import type { Recipe } from '../editor/recipe';
import { CRS, RDF, STILL, curveFields, scalarFields, cleanPresetPatch, type PresetPatch } from './schema';
export { validatePresetPatch } from './schema';

export interface PresetGroups { light: boolean; color: boolean; curves: boolean; hsl: boolean; look: boolean }
export const allPresetGroups: PresetGroups = { light: true, color: true, curves: true, hsl: true, look: true };

export function presetPatch(recipe: Recipe, groups: PresetGroups): PresetPatch {
  return {
    ...(groups.light ? { exposure: recipe.exposure, contrast: recipe.contrast } : {}),
    ...(groups.color ? { warmth: recipe.warmth, tint: recipe.tint, saturation: recipe.saturation, vibrance: recipe.vibrance } : {}),
    ...(groups.curves ? { curves: recipe.curves } : {}),
    ...(groups.hsl ? { hsl: recipe.hsl } : {}),
    ...(groups.look ? { look: recipe.look } : {}),
  };
}

export function serializeXmpPreset(patch: PresetPatch, name: string, uuid = crypto.randomUUID().replaceAll('-', '').toUpperCase()): string {
  name = name.trim();
  if (!name || name.length > 96) throw new Error('Enter a preset name of 1–96 characters.');
  if (!/^[A-Fa-f0-9]{32}$/.test(uuid)) throw new Error('Invalid preset identifier.');
  patch = cleanPresetPatch(patch);
  const xml = document.implementation.createDocument('adobe:ns:meta/', 'x:xmpmeta');
  const root = xml.documentElement;
  root.setAttributeNS('adobe:ns:meta/', 'x:xmptk', 'Still');
  const rdf = root.appendChild(xml.createElementNS(RDF, 'rdf:RDF'));
  const description = rdf.appendChild(xml.createElementNS(RDF, 'rdf:Description'));
  description.setAttributeNS(RDF, 'rdf:about', '');
  description.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:crs', CRS);
  const attribute = (key: string, value: string) => description.setAttributeNS(CRS, `crs:${key}`, value);
  attribute('PresetType', 'Normal'); attribute('ProcessVersion', '11.0'); attribute('UUID', uuid); attribute('HasSettings', 'True');
  let count = 0;
  const number = (key: string, value: number, limit: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > limit) throw new Error(`${key} is outside its supported export range.`);
    attribute(key, String(key === 'Exposure2012' ? value : Math.round(value))); count++;
  };
  for (const [field, [key]] of Object.entries(scalarFields)) {
    const value = patch[key]; if (value !== undefined) number(field, value, key === 'exposure' ? 4 : 100);
  }
  for (const [field, [band, key]] of Object.entries(xmpHslFields)) {
    const value = patch.hsl?.[band]?.[key]; if (value !== undefined) number(field, value, 100);
  }
  for (const [field, channel] of Object.entries(curveFields)) {
    const points = patch.curves?.[channel]; if (!points) continue;
    if (!validCurve(points)) throw new Error(`The ${channel} curve cannot be exported.`);
    const property = description.appendChild(xml.createElementNS(CRS, `crs:${field}`));
    const sequence = property.appendChild(xml.createElementNS(RDF, 'rdf:Seq'));
    const rounded = new Map<number, number>();
    points.forEach(([x, y], index) => {
      const input = Math.round(x * 255);
      if ((input === 0 && index !== 0) || (input === 255 && index !== points.length - 1)) return;
      rounded.set(input, Math.round(y * 255));
    });
    for (const [x, y] of rounded) {
      const item = sequence.appendChild(xml.createElementNS(RDF, 'rdf:li'));
      item.textContent = `${x}, ${y}`;
    }
    count++;
  }
  if (patch.look !== undefined) {
    if (patch.look?.kind === 'curves') {
      const property = description.appendChild(xml.createElementNS(CRS, 'crs:Look'));
      const look = property.appendChild(xml.createElementNS(RDF, 'rdf:Description'));
      for (const [key, value] of Object.entries({ Name: patch.look.name, Amount: String(patch.look.amount), SupportsAmount: String(patch.look.supportsAmount), SupportsOutputReferred: 'true', UUID: patch.look.uuid ?? crypto.randomUUID().replaceAll('-', '').toUpperCase() })) look.setAttributeNS(CRS, `crs:${key}`, value);
      const parameters = look.appendChild(xml.createElementNS(CRS, 'crs:Parameters')).appendChild(xml.createElementNS(RDF, 'rdf:Description'));
      parameters.setAttributeNS(CRS, 'crs:ProcessVersion', '11.0');
      for (const [field, channel] of Object.entries(curveFields)) {
        const sequence = parameters.appendChild(xml.createElementNS(CRS, `crs:${field}`)).appendChild(xml.createElementNS(RDF, 'rdf:Seq'));
        const rounded = new Map<number, number>();
        patch.look.curves[channel].forEach(([x, y], index, points) => {
          const input = Math.round(x * 255);
          if ((input === 0 && index !== 0) || (input === 255 && index !== points.length - 1)) return;
          rounded.set(input, Math.round(y * 255));
        });
        for (const [x, y] of rounded) sequence.appendChild(xml.createElementNS(RDF, 'rdf:li')).textContent = `${x}, ${y}`;
      }
    } else {
      const property = description.appendChild(xml.createElementNS(STILL, 'still:Look'));
      property.setAttribute('version', '1'); property.textContent = JSON.stringify(patch.look);
    }
    count++;
  }
  if (!count) throw new Error('Select at least one adjustment group.');
  for (const [field, text] of [['Name', name], ['Group', 'Still']]) {
    const property = description.appendChild(xml.createElementNS(CRS, `crs:${field}`));
    const alternate = property.appendChild(xml.createElementNS(RDF, 'rdf:Alt'));
    const item = alternate.appendChild(xml.createElementNS(RDF, 'rdf:li'));
    item.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'x-default');
    item.textContent = text;
  }
  const precision = description.appendChild(xml.createElementNS(STILL, 'still:Settings'));
  precision.setAttribute('version', '1');
  precision.textContent = JSON.stringify(patch);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(xml).replaceAll('><', '>\n<')}\n`;
}
