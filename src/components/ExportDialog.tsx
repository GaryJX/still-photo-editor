import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatNames, type ExportFormat, type ExportOptions } from '../editor/encoding';

export function ExportDialog({ width, height, formats, initial, busy, error, onExport, onCancel }: {
  width: number; height: number; formats: ExportFormat[]; initial: ExportOptions; busy: boolean; error: string;
  onExport: (options: ExportOptions) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState(initial);
  useLayoutEffect(() => { dialog.current!.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} class="export-dialog" aria-labelledby="export-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div class="dialog-heading"><div><span class="eyebrow">Ready to keep</span><h2 id="export-title">Export photo</h2></div><button class="icon-button" aria-label="Cancel export" disabled={busy} onClick={onCancel}>✕</button></div>
    <p class="curve-help">{width.toLocaleString()} × {height.toLocaleString()} pixels · current crop and edits</p>
    <label class="export-field">Format<select aria-label="Export format" value={options.format} disabled={busy} onChange={event => setOptions({ ...options, format: event.currentTarget.value as ExportFormat })}>{formats.map(format => <option key={format} value={format}>{formatNames[format]}</option>)}</select></label>
    <p class="curve-help">{options.format === 'image/png' ? 'Lossless quality with transparency. Best when keeping every detail matters.' : options.format === 'image/jpeg' ? 'A smaller photo file. Transparent areas use the background color below.' : 'A compact image format with transparency support.'}</p>
    {options.format !== 'image/png' && <div class="export-field"><label for="export-quality">Quality <output>{Math.round(options.quality * 100)}%</output></label><input id="export-quality" type="range" min="10" max="100" step="1" value={Math.round(options.quality * 100)} disabled={busy} onInput={event => setOptions({ ...options, quality: event.currentTarget.valueAsNumber / 100 })} /></div>}
    {options.format === 'image/jpeg' && <label class="export-field">Transparency background<select aria-label="JPEG background" value={options.background} disabled={busy} onChange={event => setOptions({ ...options, background: event.currentTarget.value as 'white' | 'black' })}><option value="white">White</option><option value="black">Black</option></select></label>}
    {error && <p class="export-error" role="alert">{error}</p>}
    <div class="dialog-footer"><button class="button button-quiet" disabled={busy} onClick={onCancel}>Cancel</button><button class="button button-primary" disabled={busy} onClick={() => onExport(options)}>{busy ? 'Exporting…' : `Export ${formatNames[options.format]}`}</button></div>
  </dialog>;
}
