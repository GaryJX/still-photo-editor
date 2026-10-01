import { useState } from 'preact/hooks';
import { NumberInput } from './NumberInput';
import { bandLabel, colorBands, emptyBand, hslKeys, hslLabels, type ColorBand, type HslKey, type HslSettings } from '../editor/hsl';

const swatches = ['#d96359', '#e69e53', '#e4c958', '#75a969', '#63b8b0', '#6a98d2', '#9c7bcb', '#c778ac'];
export function HslEditor({ settings, disabled, onChange, onReset, onCommit }: {
  settings: HslSettings; disabled: boolean;
  onChange: (band: ColorBand, key: HslKey, value: number, transient?: boolean) => void;
  onReset: (band: ColorBand) => void; onCommit: () => void;
}) {
  const [band, setBand] = useState<ColorBand>('red');
  const label = bandLabel(band);
  const values = settings[band];
  return <details class="adjustment-section hsl-section">
    <summary>Color mix</summary>
    <p class="curve-help">Choose a color to change its hue, intensity, or brightness.</p>
    <div class="color-swatches" role="group" aria-label="Color range">{colorBands.map((color, index) => <button key={color} type="button" aria-label={`Edit ${color} colors`} aria-pressed={color === band} title={bandLabel(color)} onClick={() => { onCommit(); setBand(color); }}><span style={{ background: swatches[index] }} /></button>)}</div>
    <div class="section-heading"><h3>{label}</h3><button class="text-button" disabled={disabled || JSON.stringify(values) === JSON.stringify(emptyBand())} onClick={() => onReset(band)}>Reset {band}</button></div>
    {hslKeys.map(key => <div class="adjustment-control" key={key}>
      <div class="slider-heading"><label for={`hsl-${key}`}>{hslLabels[key]}</label><div class="value-actions">
        <button class="reset-control" aria-label={`Reset ${band} ${hslLabels[key].toLowerCase()}`} disabled={disabled || values[key] === 0} onClick={() => onChange(band, key, 0)}>↺</button>
        <div class="numeric-control"><NumberInput label={`${label} ${hslLabels[key].toLowerCase()} value`} min={-100} max={100} value={values[key]} disabled={disabled} onCommit={value => onChange(band, key, value)} /></div>
      </div></div>
      <input id={`hsl-${key}`} class="exposure-slider" type="range" min="-100" max="100" step="1" value={values[key]} disabled={disabled} aria-label={`${label} ${hslLabels[key].toLowerCase()}`} onInput={event => onChange(band, key, event.currentTarget.valueAsNumber, true)} onChange={onCommit} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
      <div class="range-labels" aria-hidden="true"><span>{key === 'hue' ? 'Shift back' : key === 'saturation' ? 'Muted' : 'Darker'}</span><span>{key === 'hue' ? 'Shift forward' : key === 'saturation' ? 'Vivid' : 'Brighter'}</span></div>
    </div>)}
  </details>;
}
