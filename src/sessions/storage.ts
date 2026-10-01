import type { LutAsset } from '../editor/cube';
import { sessionLutIds, type PhotoSession } from './schema';

export const SESSION_DATABASE = 'still-photo-sessions';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let done = false;
    const request = indexedDB.open(SESSION_DATABASE, 1);
    const fail = () => { if (!done) { done = true; clearTimeout(timeout); reject(new Error('Photo storage is unavailable.')); } };
    const timeout = setTimeout(fail, 3000);
    request.onupgradeneeded = () => {
      for (const name of ['photos', 'sources', 'luts', 'settings']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onerror = fail; request.onblocked = fail;
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (done) { request.result.close(); return; }
      done = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transact<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result: () => T;
      try { result = work(tx); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(result());
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not save this photo.'));
    });
  } finally { db.close(); }
}
export const photoStorage = {
  list() {
    return transact(['photos', 'settings'], 'readonly', tx => {
      const photos = tx.objectStore('photos').getAll(); const active = tx.objectStore('settings').get('active');
      return () => ({ photos: photos.result as unknown[], activeId: active.result as string | undefined });
    });
  },
  source(id: string) {
    return transact(['sources'], 'readonly', tx => { const request = tx.objectStore('sources').get(id); return () => request.result instanceof ArrayBuffer ? new Blob([request.result]) : request.result as Blob | undefined; });
  },
  luts(ids: string[]) {
    return transact(['luts'], 'readonly', tx => { const requests = ids.map(id => tx.objectStore('luts').get(id)); return () => requests.map(request => request.result as LutAsset | undefined).filter((asset): asset is LutAsset => !!asset); });
  },
  async save(document: PhotoSession, source: File | undefined, luts: LutAsset[], active: boolean) {
    // ArrayBuffers avoid Blob/File serialization failures in some WebKit builds.
    // Convert before opening the transaction so async work cannot auto-close it.
    const sourceBytes = await source?.arrayBuffer();
    const thumbnail = await document.thumbnail?.arrayBuffer();
    const stored = { ...document, thumbnail };
    return transact(['photos', 'sources', 'luts', 'settings'], 'readwrite', tx => {
      tx.objectStore('photos').put(stored, document.id);
      if (sourceBytes) tx.objectStore('sources').put(sourceBytes, document.id);
      for (const lut of luts) tx.objectStore('luts').put(lut, lut.id);
      if (active) tx.objectStore('settings').put(document.id, 'active');
      return () => {};
    });
  },
  remove(id: string) {
    return transact(['photos', 'sources', 'luts', 'settings'], 'readwrite', tx => {
      tx.objectStore('photos').delete(id); tx.objectStore('sources').delete(id);
      const photos = tx.objectStore('photos').getAll();
      photos.onsuccess = () => {
        let used: Set<string>;
        try { used = new Set(photos.result.flatMap((photo: PhotoSession) => Array.from(sessionLutIds(photo.history)))); }
        catch { return; } // Keep dependencies if an unknown document cannot be inspected.
        const keys = tx.objectStore('luts').getAllKeys();
        keys.onsuccess = () => { for (const key of keys.result) if (!used.has(String(key))) tx.objectStore('luts').delete(key); };
      };
      const active = tx.objectStore('settings').get('active');
      active.onsuccess = () => { if (active.result === id) tx.objectStore('settings').delete('active'); };
      return () => {};
    });
  },
};
export type PhotoStorage = typeof photoStorage;
