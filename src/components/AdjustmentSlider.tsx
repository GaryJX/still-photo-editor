import { adjustmentValue, type Adjustment } from '../editor/recipe';
import { NumberInput } from './NumberInput';

const descriptions: Record<Adjustment, [string, string, string, string]> = {
  exposure: ['Exposure', 'Darker', 'Brighter', 'Change the overall brightness of your photo.'],
  contrast: ['Contrast', 'Softer', 'Stronger', 'Change the separation between light and dark tones.'],
  highlights: ['Highlights', 'Darker', 'Brighter', 'Adjust lighter tones while preserving pure white.'],
  shadows: ['Shadows', 'Deeper', 'Brighter', 'Adjust darker tones while preserving pure black.'],
  whites: ['Whites', 'Dimmer', 'Brighter', 'Adjust the brightest tones and the white point.'],
  blacks: ['Blacks', 'Deeper', 'Lifted', 'Deepen or lift the darkest tones and the black point.'],
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
        <div class="numeric-control"><NumberInput label={`${label} value`} min={-limit} max={limit} step={step} value={value} disabled={disabled} onCommit={next => onChange(adjustmentValue(name, next))} />{name === 'exposure' && <span>EV</span>}</div>
      </div>
    </div>
    <input id={name} class="exposure-slider" type="range" min={-limit} max={limit} step={step} value={value} disabled={disabled} aria-describedby={`${name}-help`}
      onInput={event => onInput(event.currentTarget.valueAsNumber)} onChange={onCommit} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
    <div class="range-labels" aria-hidden="true"><span>{left}</span><span>{right}</span></div>
    <span class="sr-only" id={`${name}-help`}>{help}</span>
  </div>;
}
