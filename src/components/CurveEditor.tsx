import { useRef, useState } from 'preact/hooks';
import { NumberInput } from './NumberInput';
import { curveChannels, linearCurve, type CurveChannel, type CurvePoint, type Curves } from '../editor/curves';

export function CurveEditor({ curves, disabled, onChange, onCommit }: {
  curves: Curves; disabled: boolean;
  onChange: (channel: CurveChannel, points: CurvePoint[], transient?: boolean) => void;
  onCommit: () => void;
}) {
  const [channel, setChannel] = useState<CurveChannel>('master');
  const [selection, setSelection] = useState(0);
  const pointer = useRef<{ id: number; index: number } | null>(null);
  const points = curves[channel];
  const selected = Math.min(selection, points.length - 1);
  const point = points[selected];
  const names = { master: 'All colors', red: 'Red', green: 'Green', blue: 'Blue' };

  function changePoint(index: number, x: number, y: number, transient: boolean) {
    if (disabled || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = points.map(p => [...p] as CurvePoint);
    const epsilon = index > 0 && index < points.length - 1 ? Math.min(1 / 255, (points[index + 1][0] - points[index - 1][0]) / 3) : 0;
    const low = index === 0 ? 0 : points[index - 1][0] + epsilon;
    const high = index === points.length - 1 ? 1 : points[index + 1][0] - epsilon;
    next[index] = [index === 0 ? 0 : index === points.length - 1 ? 1 : Math.max(low, Math.min(high, x)), Math.max(0, Math.min(1, y))];
    onChange(channel, next, transient);
  }
  function coordinates(clientX: number, clientY: number, element: SVGSVGElement): CurvePoint {
    const bounds = element.getBoundingClientRect();
    return [Math.max(0, Math.min(1, ((clientX - bounds.left) / bounds.width * 272 - 8) / 256)), Math.max(0, Math.min(1, 1 - ((clientY - bounds.top) / bounds.height * 272 - 8) / 256))];
  }
  function removePoint() {
    if (disabled || selected === 0 || selected === points.length - 1) return;
    onChange(channel, points.filter((_, i) => i !== selected));
    setSelection(selected - 1);
  }

  return <details class="curve-section adjustment-section">
    <summary>Tone curves</summary>
    <p class="curve-help">Click to add a point. Drag up to brighten tones, or down to darken them.</p>
    <div class="curve-toolbar"><select aria-label="Curve channel" value={channel} disabled={disabled} onChange={event => { onCommit(); setChannel(event.currentTarget.value as CurveChannel); setSelection(0); }}>{curveChannels.map(key => <option key={key} value={key}>{names[key]}</option>)}</select>
      <button class="text-button" disabled={disabled} onClick={() => { onChange(channel, linearCurve()); setSelection(0); }}>Reset curve</button></div>
    <svg class={`curve-plot curve-${channel}`} viewBox="-8 -8 272 272" role="group" aria-label={`${names[channel]} tone curve`}
      onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        const [x, y] = coordinates(event.clientX, event.clientY, event.currentTarget);
        const attribute = (event.target as Element).getAttribute('data-point');
        let index = attribute === null ? -1 : Number(attribute);
        if (index < 0) {
          if (points.length >= 32 || points.some(p => Math.abs(p[0] - x) < 2 / 255)) return;
          const next = [...points, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
          index = next.findIndex(p => p[0] === x);
          onChange(channel, next, true);
        }
        setSelection(index);
        pointer.current = { id: event.pointerId, index };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (pointer.current?.id !== event.pointerId) return;
        const [x, y] = coordinates(event.clientX, event.clientY, event.currentTarget);
        changePoint(pointer.current.index, x, y, true);
      }}
      onPointerUp={event => { if (pointer.current?.id === event.pointerId) { pointer.current = null; onCommit(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { pointer.current = null; onCommit(); }}
      onLostPointerCapture={() => { pointer.current = null; onCommit(); }}>
      <rect x="0" y="0" width="256" height="256" fill="#f6f7f3" stroke="#dfe4d8" />
      {[64, 128, 192].map(p => <path key={p} d={`M${p} 0V256M0 ${p}H256`} stroke="#e1e5da" />)}
      <path d="M0 256L256 0" stroke="#b9c2b1" stroke-dasharray="4 5" />
      <polyline points={points.map(([x, y]) => `${x * 256},${(1 - y) * 256}`).join(' ')} fill="none" stroke="currentColor" stroke-width="2" />
      {points.map(([x, y], index) => <circle key={index} data-point={index} class={selected === index ? 'selected-point' : ''} cx={x * 256} cy={(1 - y) * 256} r="5" fill="white" stroke="currentColor" stroke-width="2" role="button" tabindex={disabled ? -1 : 0} aria-disabled={disabled}
        aria-label={`Curve point ${index + 1}: input ${Math.round(x * 255)}, output ${Math.round(y * 255)}`}
        onFocus={() => setSelection(index)}
        onKeyDown={event => {
          if (disabled) return;
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removePoint(); return; }
          const step = (event.shiftKey ? 10 : 1) / 255;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          changePoint(index, x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), true);
        }} onKeyUp={onCommit} onBlur={onCommit} />)}
    </svg>
    <div class="curve-numbers">
      <label>Input<NumberInput label="Point input" min={0} max={255} value={Math.round(point[0] * 255)} disabled={disabled || selected === 0 || selected === points.length - 1} onCommit={value => changePoint(selected, value / 255, point[1], false)} /></label>
      <label>Output<NumberInput label="Point output" min={0} max={255} value={Math.round(point[1] * 255)} disabled={disabled} onCommit={value => changePoint(selected, point[0], value / 255, false)} /></label>
      <button class="text-button" disabled={disabled || selected === 0 || selected === points.length - 1} onClick={removePoint}>Remove</button>
    </div>
    <p class="curve-help">Left: shadows · Right: highlights</p>
  </details>;
}
