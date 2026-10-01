import { adjustmentValue, type Adjustment } from '../editor/recipe';

const descriptions: Record<Adjustment, [string, string, string, string]> = {
  exposure: ['Exposure', 'Darker', 'Brighter', 'Change the overall brightness of your photo.'],
  contrast: ['Contrast', 'Softer', 'Stronger', 'Change the separation between light and dark tones.'],
  warmth: ['Warmth', 'Cooler', 'Warmer', 'Shift the overall color toward blue or amber.'],
  tint: ['Tint', 'Greener', 'More magenta', 'Balance green and magenta color casts.'],
  saturation: ['Color intensity', 'Muted', 'Vivid', 'Adjust the saturation of every color.'],
  vibrance: ['Vibrance', 'Subtle', 'Lively', 'Adjust muted colors more than already vivid colors.'],
};

export function AdjustmentSlider({ name, value, disabled, onInput, onCommit, onChange }: {
  name: Adjustment; value: number; disabled: boolean;
  onInput: (value: number) => void; onCommit: () => void; onChange: (value: number) => void;
}) {
  const [label, left, right, help] = descriptions[name];
  const limit = name === 'exposure' ? 4 : 100;
  const step = name === 'exposure' ? 0.05 : 1;
  return <div class="adjustment-control">
    <div class="slider-heading"><label for={name}>{label}</label>
      <div class="value-actions">
        <button class="reset-control" title={`Reset ${label.toLowerCase()}`} aria-label={`Reset ${label.toLowerCase()}`} disabled={disabled || value === 0} onClick={() => onChange(0)}>↺</button>
        <div class="numeric-control"><input aria-label={`${label} value`} type="number" min={-limit} max={limit} step={step} value={value} disabled={disabled} onChange={(event) => {
          const input = event.currentTarget;
          if (!Number.isFinite(input.valueAsNumber)) { input.value = String(value); return; }
          const next = adjustmentValue(name, input.valueAsNumber);
          input.value = String(next); onChange(next);
        }} />{name === 'exposure' && <span>EV</span>}</div>
      </div>
    </div>
    <input id={name} class="exposure-slider" type="range" min={-limit} max={limit} step={step} value={value} disabled={disabled} aria-describedby={`${name}-help`}
      onInput={event => onInput(event.currentTarget.valueAsNumber)} onChange={onCommit} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    <div class="range-labels" aria-hidden="true"><span>{left}</span><span>{right}</span></div>
    <span class="sr-only" id={`${name}-help`}>{help}</span>
  </div>;
}
