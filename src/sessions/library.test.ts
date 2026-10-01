import { expect, test, vi } from 'vitest';
import { PhotoLibrary, type LibraryState } from './library';
import type { PhotoStorage } from './storage';
import { restoreSession, type PhotoSession } from './schema';
import { initialRecipe, recipeKey } from '../editor/recipe';
import { EditHistory } from '../editor/history';
import { imageInfo } from '../editor/image';

function memoryStorage() {
  const documents = new Map<string, PhotoSession>(), sources = new Map<string, Blob>();
  const writes: boolean[] = [];
  const storage: PhotoStorage = {
    list: async () => ({ photos: [...documents.values()], activeId: undefined }),
    source: async id => sources.get(id), luts: async () => [],
    save: async (document, source) => { documents.set(document.id, structuredClone(document)); if (source) sources.set(document.id, source); writes.push(!!source); },
    remove: async id => { documents.delete(id); sources.delete(id); },
  };
  return { storage, documents, sources, writes };
}
const file = () => new File(['photo'], 'photo.png', { type: 'image/png' });
const history = () => new EditHistory(initialRecipe, recipeKey);

test('coalesces edits, writes the original once, and restores independent history', async () => {
  const memory = memoryStorage(); const states: LibraryState[] = [];
  const library = new PhotoLibrary(state => states.push(state), memory.storage);
  const edits = history(); const id = library.add(file(), imageInfo(400, 300), edits.snapshot());
  edits.preview({ ...initialRecipe, exposure: 1 }); library.update(id, { history: edits.snapshot() });
  edits.preview({ ...initialRecipe, exposure: 2 }); library.update(id, { history: edits.snapshot() });
  await library.flush();
  expect(memory.writes).toEqual([true]);
  edits.commit(); edits.apply({ ...initialRecipe, exposure: 3 }); library.update(id, { history: edits.snapshot() });
  await library.flush(); expect(memory.writes).toEqual([true, false]);
  const restored = await library.open(id);
  const recovered = history(); recovered.restore(restored.document.history); recovered.undo();
  expect(recovered.current.exposure).toBe(2);
  expect(states.at(-1)!.entries[0].status).toBe('saved');
  expect(await restored.file.text()).toBe('photo');
  library.dispose();
});

test('quota failure retains the latest photo/edits in memory and supports retry', async () => {
  const memory = memoryStorage(); let fail = true; let state: LibraryState | undefined;
  const storage = { ...memory.storage, save: async (...args: Parameters<PhotoStorage['save']>) => { if (fail) throw new Error('quota'); await memory.storage.save(...args); } };
  const library = new PhotoLibrary(next => { state = next; }, storage);
  const edits = history(); const id = library.add(file(), imageInfo(400, 300), edits.snapshot());
  await library.flush(); expect(state!.entries[0].status).toBe('session');
  edits.apply({ ...initialRecipe, exposure: 2 }); library.update(id, { history: edits.snapshot() });
  expect((await library.open(id)).document.history.current.exposure).toBe(2);
  fail = false; library.retry(id); await library.flush();
  expect(state!.entries[0].status).toBe('saved'); expect(memory.documents.get(id)!.history.current.exposure).toBe(2);
  library.dispose();
});

test('deletion waits for an in-flight save and never resurrects the removed photo', async () => {
  const memory = memoryStorage(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const library = new PhotoLibrary(() => {}, { ...memory.storage, save: async (...args) => { await gate; await memory.storage.save(...args); } });
  const id = library.add(file(), imageInfo(400, 300), history().snapshot());
  const saving = library.flush(); const deleting = library.remove(id);
  release(); await saving; await deleting;
  expect(memory.documents.size).toBe(0); expect(memory.sources.size).toBe(0);
  await expect(library.open(id)).rejects.toThrow('no longer');
  library.dispose();
});

test('stored recipes reject unsupported versions and preserve LUT export baselines', async () => {
  const memory = memoryStorage(); const library = new PhotoLibrary(() => {}, memory.storage);
  const edits = history(); edits.apply({ ...initialRecipe, look: { kind: 'lut', name: 'Example', amount: 1, assetId: 'a'.repeat(64) } });
  const id = library.add(file(), imageInfo(400, 300), edits.snapshot());
  library.update(id, { lastExportedKey: recipeKey(edits.current) });
  const document = library.document(id)!;
  expect(restoreSession(document).lastExportedKey).toBe(recipeKey(edits.current));
  expect(() => restoreSession({ ...document, history: { ...document.history, current: { ...edits.current, engineVersion: 'future' } } })).toThrow('unsupported');
  library.dispose();
});


test('continuous edits checkpoint without waiting for the gesture to stop', async () => {
  vi.useFakeTimers();
  const memory = memoryStorage(); const library = new PhotoLibrary(() => {}, memory.storage); const edits = history();
  try {
    const id = library.add(file(), imageInfo(400, 300), edits.snapshot());
    for (let i = 1; i <= 10; i++) {
      edits.preview({ ...initialRecipe, exposure: i / 10 }); library.update(id, { history: edits.snapshot() });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(memory.documents.get(id)!.history.current.exposure).toBe(1);
    expect(memory.writes).toEqual([true]);
  } finally { library.dispose(); vi.useRealTimers(); }
});
