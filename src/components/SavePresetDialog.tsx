import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { allPresetGroups, type PresetGroups } from '../presets/export';

export interface SavePresetOptions { name: string; save: boolean; download: boolean; groups: PresetGroups }
export function SavePresetDialog({ busy, error, onSave, onCancel }: { busy: boolean; error: string; onSave: (options: SavePresetOptions) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<SavePresetOptions>({ name: '', save: true, download: true, groups: allPresetGroups });
  useLayoutEffect(() => { dialog.current!.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} class="export-dialog" aria-labelledby="save-preset-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div class="dialog-heading"><div><span class="eyebrow">Keep your look</span><h2 id="save-preset-title">Save as preset</h2></div><button class="icon-button" aria-label="Cancel saving preset" disabled={busy} onClick={onCancel}>✕</button></div>
    <label class="export-field">Preset name<input class="preset-title-input" aria-label="New preset name" autoFocus maxLength={96} value={options.name} placeholder="Warm afternoon" disabled={busy} onInput={event => setOptions({ ...options, name: event.currentTarget.value })} /></label>
    <p class="curve-help">Save light and color adjustments for another photo. Crop and rotation stay with this image.</p>
    <label class="preset-checkbox"><input type="checkbox" checked={options.save} disabled={busy} onChange={event => setOptions({ ...options, save: event.currentTarget.checked })} />Save in this browser</label>
    <label class="preset-checkbox"><input type="checkbox" checked={options.download} disabled={busy} onChange={event => setOptions({ ...options, download: event.currentTarget.checked })} />Download XMP file</label>
    <details class="preset-groups"><summary>Settings to include</summary>{(['light', 'color', 'curves', 'hsl'] as const).map(group => <label class="preset-checkbox" key={group}><input type="checkbox" aria-label={`Include ${group}`} checked={options.groups[group]} disabled={busy} onChange={event => setOptions({ ...options, groups: { ...options.groups, [group]: event.currentTarget.checked } })} />{({ light: 'Light', color: 'Color', curves: 'Tone curves', hsl: 'Color mix' })[group]}</label>)}</details>
    <p class="curve-help">The XMP uses mapped Camera Raw settings. Other editors can render the same values differently.</p>
    {error && <p class="export-error" role="alert">{error}</p>}
    <div class="dialog-footer"><button class="button button-quiet" disabled={busy} onClick={onCancel}>Cancel</button><button class="button button-primary" disabled={busy || !options.name.trim() || (!options.save && !options.download) || !Object.values(options.groups).some(Boolean)} onClick={() => onSave(options)}>{busy ? 'Saving…' : 'Save preset'}</button></div>
  </dialog>;
}
