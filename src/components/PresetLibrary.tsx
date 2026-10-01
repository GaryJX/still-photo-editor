import { useState } from 'preact/hooks';
import { Icon } from './Icon';
import type { SavedPreset } from '../presets/xmp';

export function PresetLibrary({ presets, disabled, storageNotice, report, onImport, onApply, onRename, onDelete, onDownload }: {
  presets: SavedPreset[]; disabled: boolean; storageNotice: string; report?: SavedPreset;
  onImport: () => void; onApply: (preset: SavedPreset) => void;
  onRename: (preset: SavedPreset, name: string) => void; onDelete: (preset: SavedPreset) => void; onDownload: (preset: SavedPreset) => void;
}) {
  const [renaming, setRenaming] = useState('');
  const [draft, setDraft] = useState('');
  return <section class="preset-section" aria-label="Presets">
    <div class="section-heading"><h3>Presets</h3><button class="text-button" disabled={disabled} onClick={onImport}><Icon name="plus" size={13} />Import XMP</button></div>
    {!presets.length && <p class="preset-note">Drop in an XMP preset to try a look. Saved presets stay in this browser.</p>}
    {!!presets.length && <ul class="preset-list">{presets.map(preset => <li key={preset.id}>
      {renaming === preset.id ? <form class="preset-rename" onSubmit={event => { event.preventDefault(); if (draft.trim()) { onRename(preset, draft.trim().slice(0, 96)); setRenaming(''); } }}><input aria-label="Preset name" maxLength={96} value={draft} onInput={event => setDraft(event.currentTarget.value)} /><button class="text-button" type="submit" disabled={disabled || !draft.trim()}>Save</button><button class="text-button" type="button" onClick={() => setRenaming('')}>Cancel</button></form> : <>
        <button class="preset-name" disabled={disabled} title={preset.name} aria-label={`Apply preset ${preset.name}`} onClick={() => onApply(preset)}>{preset.name}{preset.sessionOnly && <small>Session only</small>}</button>
        <details class="preset-menu"><summary aria-label={`Options for ${preset.name}`}>•••</summary><div>
          <button disabled={disabled} onClick={() => { setDraft(preset.name); setRenaming(preset.id); }}>Rename</button>
          <button disabled={disabled} onClick={() => onDownload(preset)}>Download original XMP</button>
          <button disabled={disabled} onClick={() => onDelete(preset)}>Delete</button>
        </div></details>
      </>}
    </li>)}</ul>}
    {storageNotice && <p class="preset-note" role="status">{storageNotice}</p>}
    {report && <details class="preset-report"><summary>{report.report.applied.length} supported settings · {report.report.unsupported.length + report.report.invalid.length} unavailable</summary>
      <p>{report.name}</p>
      {!!report.report.applied.length && <p>Supported: {report.report.applied.join(', ')}.</p>}
      {!!report.report.approximated.length && <p>Approximate mappings: {report.report.approximated.join(', ')}. The result can differ from Lightroom.</p>}
      {!!report.report.unsupported.length && <p>Unsupported: {report.report.unsupported.join(', ')}.</p>}
      {!!report.report.invalid.length && <p>Invalid settings: {report.report.invalid.join('; ')}.</p>}
      {report.report.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </details>}
  </section>;
}
