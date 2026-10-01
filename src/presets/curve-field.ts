import type { CurvePoint } from '../editor/curves';
import { RDF } from './schema';

export function readCurveField(element?: Element): CurvePoint[] {
  const sequence = Array.from(element?.children ?? []).find(child => child.namespaceURI === RDF && child.localName === 'Seq');
  return sequence ? Array.from(sequence.children).map(item => {
    if (item.namespaceURI !== RDF || item.localName !== 'li' || item.childElementCount) return [NaN, NaN] as CurvePoint;
    const values = (item.textContent ?? '').split(',').map(value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) / 255 : NaN);
    return values.length === 2 ? values as CurvePoint : [NaN, NaN] as CurvePoint;
  }) : [];
}
