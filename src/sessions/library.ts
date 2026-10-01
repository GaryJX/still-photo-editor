import { photoStorage, type PhotoStorage } from './storage';
import { restoreSession, sessionLutIds, type PhotoSession, type SessionEntry } from './schema';
import type { HistorySnapshot } from '../editor/history';
import type { Recipe } from '../editor/recipe';
import type { LutAsset } from '../editor/cube';
import type { PhotoInfo } from '../worker/types';

interface Entry extends SessionEntry { revision: number; stored: boolean }
export interface LibraryState { entries: SessionEntry[]; resumeId?: string; notice: string; loaded: boolean }

/** One immutable compressed source per photo; coalesced, serialized document writes. */
export class PhotoLibrary {
  private entries = new Map<string, Entry>();
  private sources = new Map<string, File>();
  private assets = new Map<string, LutAsset>();
  private savedAssets = new Set<string>();
  private pending = new Set<string>();
  private deleted = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private checkpoint?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private activeId?: string;
  private resumeId?: string;
  private notice = '';
  private loaded = false;
  private disposed = false;

  constructor(private publish: (state: LibraryState) => void, private storage: PhotoStorage = photoStorage) {}
  private emit() {
    if (!this.disposed) this.publish({ entries: Array.from(this.entries.values()).sort((a, b) => b.document.createdAt - a.document.createdAt).map(({ document, status }) => ({ document, status })), resumeId: this.resumeId, notice: this.notice, loaded: this.loaded });
  }
  async load() {
    try {
      const saved = await this.storage.list();
      for (const value of saved.photos) {
        try { const document = restoreSession(value); if (!this.entries.has(document.id) && !this.deleted.has(document.id)) this.entries.set(document.id, { document, status: 'saved', revision: 0, stored: true }); }
        catch { this.notice = 'Some saved photos could not be read. Their stored data has been kept.'; }
      }
      this.resumeId = this.entries.has(saved.activeId ?? '') ? saved.activeId : this.entries.keys().next().value;
    } catch { this.notice = 'Photo storage is unavailable. You can still edit and switch photos in this tab.'; }
    finally { this.loaded = true; this.emit(); }
  }
  document(id: string) { return this.entries.get(id)?.document; }
  add(file: File, info: PhotoInfo, history: HistorySnapshot<Recipe>) {
    const id = crypto.randomUUID(), now = Date.now();
    const document: PhotoSession = { version: 1, id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, info, history, comparison: 50, createdAt: now, updatedAt: now };
    this.entries.set(id, { document, revision: 1, status: 'saving', stored: false }); this.sources.set(id, file);
    this.activeId = id; this.resumeId = id; this.pending.add(id); this.schedule(); this.emit();
    return id;
  }
  update(id: string, patch: Partial<Pick<PhotoSession, 'history' | 'comparison' | 'lastExportedKey' | 'thumbnail'>>, assets: LutAsset[] = []) {
    const entry = this.entries.get(id); if (!entry || this.deleted.has(id)) return;
    for (const asset of assets) this.assets.set(asset.id, asset);
    if (Object.entries(patch).every(([key, value]) => key === 'thumbnail' ? value === entry.document.thumbnail : JSON.stringify(value) === JSON.stringify(entry.document[key as keyof PhotoSession]))) return;
    entry.document = { ...entry.document, ...patch, updatedAt: Date.now() }; entry.revision++;
    if (entry.status !== 'session') { entry.status = 'saving'; this.pending.add(id); this.schedule(); }
    this.emit();
  }
  select(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    this.activeId = id; this.resumeId = id; entry.revision++;
    if (entry.status !== 'session') { entry.status = 'saving'; this.pending.add(id); this.schedule(); }
    this.emit();
  }
  retry(id: string) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.status = 'saving'; this.pending.add(id); this.emit(); void this.flush();
  }
  async open(id: string) {
    const document = this.entries.get(id)?.document;
    if (!document) throw new Error('This photo is no longer in the list.');
    const source = this.sources.get(id) ?? await this.storage.source(id);
    if (!(source instanceof Blob)) throw new Error('The saved original is unavailable. Reopen the photo from your computer.');
    const ids = Array.from(sessionLutIds(document.history));
    const missing = ids.filter(id => !this.assets.has(id));
    if (missing.length) {
      for (const asset of await this.storage.luts(missing)) { this.assets.set(asset.id, asset); this.savedAssets.add(asset.id); }
    }
    return { document, file: new File([source], document.name, { type: document.type, lastModified: document.lastModified }), assets: ids.flatMap(id => this.assets.has(id) ? [this.assets.get(id)!] : []) };
  }
  async remove(id: string) {
    if (!this.entries.has(id)) return;
    // Finish older writes before deletion so no late save can resurrect a photo.
    this.deleted.add(id); this.pending.delete(id);
    await this.running;
    try { if (this.entries.get(id)?.stored) await this.storage.remove(id); }
    catch { this.deleted.delete(id); throw new Error('Could not remove the saved photo. Please try again.'); }
    this.entries.delete(id); this.sources.delete(id); this.savedAssets.clear();
    if (this.activeId === id) this.activeId = undefined;
    if (this.resumeId === id) this.resumeId = this.entries.keys().next().value;
    this.emit();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 300);
    this.checkpoint ??= setTimeout(() => { void this.flush(); }, 1000);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer); clearTimeout(this.checkpoint);
    this.timer = this.checkpoint = undefined;
    if (this.running) return this.running;
    const drain = async () => {
      while (this.pending.size && !this.disposed) {
        const id = this.pending.values().next().value!; this.pending.delete(id);
        const entry = this.entries.get(id); if (!entry || this.deleted.has(id)) continue;
        const { document, revision } = entry;
        const assets = Array.from(sessionLutIds(document.history)).flatMap(id => !this.savedAssets.has(id) && this.assets.has(id) ? [this.assets.get(id)!] : []);
        try {
          await this.storage.save(document, this.sources.get(id), assets, this.activeId === id);
          if (this.notice.startsWith('Photo storage is unavailable.')) this.notice = '';
          entry.stored = true; this.sources.delete(id); for (const asset of assets) this.savedAssets.add(asset.id);
          if (entry.revision === revision) entry.status = 'saved';
        } catch { entry.status = 'session'; this.pending.delete(id); }
        this.emit();
      }
    };
    this.running = drain();
    try { await this.running; } finally { this.running = undefined; }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); clearTimeout(this.checkpoint); }
}
