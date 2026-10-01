import { parseXmp, PARSER_VERSION, type SavedPreset } from './xmp';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wasm-image-editor', 1);
    let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore('presets', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => { abandoned = true; reject(new Error('Preset storage is busy.')); };
    request.onsuccess = () => { if (abandoned) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction('presets', mode);
      const request = action(tx.objectStore('presets'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Preset storage could not be updated.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { database.close(); }
}

export const savePreset = (preset: SavedPreset) => transaction('readwrite', store => store.put({ ...preset, sessionOnly: false }));
export const deletePreset = (id: string) => transaction('readwrite', store => store.delete(id));
export async function loadPresets(): Promise<SavedPreset[]> {
  const records = await transaction('readonly', store => store.getAll()) as SavedPreset[];
  return records.flatMap(record => {
    try {
      if (typeof record.id !== 'string' || typeof record.xml !== 'string' || typeof record.name !== 'string') return [];
      // Reparse original XML so stored patches never outlive the parser's semantics.
      return [{ ...record, ...parseXmp(record.xml, record.name), name: record.name.slice(0, 96), parserVersion: PARSER_VERSION, sessionOnly: false }];
    } catch { return []; }
  }).sort((a, b) => b.createdAt - a.createdAt);
}
