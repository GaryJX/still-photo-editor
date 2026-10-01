import { useState } from 'preact/hooks';

/** Keep in-progress text independent of unrelated preview/state renders. */
export function NumberInput({ value, label, min, max, step = 1, disabled = false, onCommit }: {
  value: number; label: string; min: number; max: number; step?: number; disabled?: boolean; onCommit: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  return <input type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled} value={editing ? draft : String(value)}
    onFocus={() => { setDraft(String(value)); setEditing(true); }}
    onInput={event => setDraft(event.currentTarget.value)}
    onBlur={event => {
      const parsed = event.currentTarget.valueAsNumber;
      setEditing(false);
      if (Number.isFinite(parsed)) onCommit(Math.max(min, Math.min(max, parsed)));
    }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.value = String(value); setDraft(String(value)); event.currentTarget.blur(); }
      else if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    }} />;
}
