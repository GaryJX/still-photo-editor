import { defaultCurves, validCurve } from '../editor/curves';
import { cleanLook, type CurveLook } from '../editor/look';
import { CRS, RDF, curveFields } from './schema';
import { readCurveField } from './curve-field';

export function readLook(element?: Element, fallback = 'Unnamed look'): { look?: CurveLook; message?: string } {
  const description = Array.from(element?.children ?? []).find(child => child.namespaceURI === RDF && child.localName === 'Description');
  const property = (node: Element | undefined, key: string) => (node?.getAttributeNS(CRS, key) ?? Array.from(node?.children ?? []).find(child => child.namespaceURI === CRS && child.localName === key)?.textContent)?.trim();
  const name = (property(description, 'Name') || fallback || 'Unnamed look').slice(0, 96);
  const unavailable = (reason: string) => ({ message: `Look “${name}”: ${reason}` });
  const container = Array.from(description?.children ?? []).find(child => child.namespaceURI === CRS && child.localName === 'Parameters');
  const parameters = Array.from(container?.children ?? []).find(child => child.namespaceURI === RDF && child.localName === 'Description');
  const dependencies: string[] = [];
  if (property(parameters, 'CameraProfile')) dependencies.push(`camera profile “${property(parameters, 'CameraProfile')!.slice(0, 96)}”`);
  if (property(parameters, 'LookTable')) dependencies.push(`lookup table ${property(parameters, 'LookTable')!.slice(0, 96)}`);
  if (dependencies.length) return unavailable(`requires ${dependencies.join(' and ')}. Those Adobe profile/table formats are not supported here; a name or ID alone is not a usable transform.`);
  if (!parameters || ['true', '1'].includes(property(description, 'Stubbed')?.toLowerCase() ?? '')) return unavailable('references a profile without self-contained transform data.');
  if (['false', '0'].includes(property(description, 'SupportsOutputReferred')?.toLowerCase() ?? '')) return unavailable('requires a scene-referred/RAW pipeline; this editor processes rendered RGB photos.');
  const fields = new Map<string, { text: string; element?: Element }>();
  for (const attribute of parameters.attributes) if (attribute.namespaceURI === CRS) fields.set(attribute.localName, { text: attribute.value });
  for (const child of parameters.children) if (child.namespaceURI === CRS) fields.set(child.localName, { text: child.textContent ?? '', element: child });
  const unsupported: string[] = [];
  const curves = defaultCurves(); let count = 0;
  for (const [key, field] of fields) {
    if (Object.hasOwn(curveFields, key)) {
      const points = readCurveField(field.element);
      if (!validCurve(points)) return unavailable(`contains an invalid ${key} curve.`);
      curves[curveFields[key]] = points; count++;
    } else if (['Version', 'ProcessVersion', 'ToneCurveName2012'].includes(key)) continue;
    else if (key === 'ConvertToGrayscale' && ['false', '0'].includes(field.text.trim().toLowerCase())) continue;
    else if (['CameraProfile', 'LookTable'].includes(key) && !field.text.trim()) continue;
    else unsupported.push(key);
  }
  if (unsupported.length) return unavailable(`contains unsupported profile parameters: ${unsupported.join(', ')}.`);
  if (!count) return unavailable('contains no supported curve transform.');
  const supportsAmount = !['false', '0'].includes((property(description, 'SupportsAmount') ?? 'true').toLowerCase());
  const amount = supportsAmount ? Number(property(description, 'Amount') ?? '1') : 1;
  try {
    return { look: cleanLook({ kind: 'curves', name, amount, supportsAmount, curves, uuid: property(description, 'UUID') }) as CurveLook };
  } catch { return unavailable('contains an invalid profile amount.'); }
}
