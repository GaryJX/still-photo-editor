import { useEffect, useRef, useState } from 'preact/hooks';
import type { LibraryState } from '../sessions/library';
import type { SessionEntry } from '../sessions/schema';

function PhotoRow({ entry, active, busy, onSelect, onRemove, onRetry }: {
  entry: SessionEntry; active: boolean; busy: boolean;
  onSelect: () => void; onRemove: () => Promise<void>; onRetry: () => void;
}) {
  const { document: photo, status } = entry;
  const [url, setUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!photo.thumbnail) { setUrl(''); return; }
    const next = URL.createObjectURL(photo.thumbnail); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.thumbnail]);
  const saved = status === 'saved' ? 'Saved in this browser' : status === 'saving' ? 'Saving…' : 'Session only';
  return <li class={`photo-library-row ${active ? 'active' : ''}`}>
    <div class="photo-library-item">
      <button class="photo-select" aria-label={`Edit photo ${photo.name}`} aria-describedby={`photo-status-${photo.id}`} aria-pressed={active} disabled={busy || active} onClick={onSelect}>
        {url ? <img src={url} alt="" /> : <span class="photo-thumbnail-placeholder" aria-hidden="true">▧</span>}
        <span class="photo-row-text"><strong title={photo.name}>{photo.name}</strong><span>{photo.info.width.toLocaleString()} × {photo.info.height.toLocaleString()}{active ? ' · Editing' : ''}</span><span id={`photo-status-${photo.id}`}>{saved}</span></span>
      </button>
      <button class="icon-button" aria-label={`Remove photo ${photo.name}`} title="Remove photo" disabled={busy} onClick={() => setConfirming(!confirming)}>×</button>
    </div>
    {status === 'session' && <div class="photo-row-note">Keep this tab open to retain the latest edits. <button class="text-button" disabled={busy} onClick={onRetry}>Retry saving</button></div>}
    {confirming && <div class="photo-removal"><p>Remove this photo and its edits from this browser? Your original file stays on your computer.</p><div><button class="button button-small button-quiet" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button class="button button-small button-quiet" disabled={busy} onClick={() => { void onRemove().then(() => setConfirming(false)); }}>Remove photo and edits</button></div></div>}
  </li>;
}

export function PhotoLibrary({ state, activeId, busy, onSelect, onRemove, onRetry, onAdd }: {
  state: LibraryState; activeId?: string; busy: boolean;
  onSelect: (id: string) => void; onRemove: (id: string) => Promise<void>; onRetry: (id: string) => void; onAdd: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (details.current && !details.current.contains(event.target as Node)) details.current.open = false; };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return <details class="photo-library" ref={details} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); details.current!.open = false; summary.current?.focus(); } }}>
    <summary ref={summary}>Photos <span class="photo-count">{state.entries.length}</span></summary>
    <section class="photo-library-panel" aria-label="Your photos">
      <div class="photo-library-heading"><div><strong>Your photos</strong><p>Photos and edits stay on this device</p></div><button class="button button-small button-quiet" disabled={busy} onClick={onAdd}>Add photo</button></div>
      {state.notice && <p class="photo-library-notice">{state.notice}</p>}
      {!state.entries.length && <p class="photo-library-notice">{state.loaded ? 'Photos you open will appear here with their edits.' : 'Loading saved photos…'}</p>}
      <ul>{state.entries.map(entry => <PhotoRow key={entry.document.id} entry={entry} active={entry.document.id === activeId} busy={busy}
        onSelect={() => { onSelect(entry.document.id); details.current!.open = false; summary.current?.focus(); }}
        onRemove={async () => { await onRemove(entry.document.id); summary.current?.focus(); }} onRetry={() => onRetry(entry.document.id)} />)}</ul>
      <p class="photo-library-notice">Export images you want to keep. Clearing browser data also clears this list.</p>
    </section>
  </details>;
}
