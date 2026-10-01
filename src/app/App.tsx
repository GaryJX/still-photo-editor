import { useEffect, useRef, useState } from 'preact/hooks';
import { transfer } from 'comlink';
import { EngineClient } from '../editor/engine-client';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { ComparisonPreview } from '../components/ComparisonPreview';
import { decodeOnMain, encodeOnMain, validatePhoto } from '../editor/image';
import { adjustmentValue, initialRecipe, recipeKey, type Adjustment, type Recipe } from '../editor/recipe';
import { EditHistory } from '../editor/history';
import { AdjustmentSlider } from '../components/AdjustmentSlider';
import { CurveEditor } from '../components/CurveEditor';
import { HslEditor } from '../components/HslEditor';
import { LookPanel } from '../components/LookPanel';
import { MAX_CUBE_BYTES, type LutAsset } from '../editor/cube';
import { CropDialog } from '../components/CropDialog';
import { ExportDialog } from '../components/ExportDialog';
import { defaultExportOptions, formatExtensions, supportedExportFormats, type ExportFormat, type ExportOptions } from '../editor/encoding';
import { defaultGeometry, displayCrop, fullCrop, geometryKey, snapCrop, sourceCrop, type Crop } from '../editor/geometry';
import { emptyBand } from '../editor/hsl';
import { PresetLibrary } from '../components/PresetLibrary';
import { SavePresetDialog, type SavePresetOptions } from '../components/SavePresetDialog';
import { presetPatch, serializeXmpPreset } from '../presets/export';
import { applyPresetPatch, createPreset, MAX_XMP_BYTES, type SavedPreset } from '../presets/xmp';
import { loadPresets, savePreset, deletePreset, loadLuts, saveLut } from '../presets/storage';
import { useComparisonActivity } from '../editor/comparison-activity';
import { PhotoLibrary as PhotoLibraryStore, type LibraryState } from '../sessions/library';
import { PhotoLibrary } from '../components/PhotoLibrary';
import { sessionLutIds } from '../sessions/schema';
import { hasUnexportedEdits, useUnsavedEditWarning } from '../editor/unsaved';
import { LatestRenderer } from '../editor/scheduler';
import type { Frame, PhotoInfo, RenderMetrics } from '../worker/types';

type Photo = PhotoInfo & { name: string; id: number; sessionId: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Photo>();
  const [frame, setFrame] = useState<Frame>();
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [sessions, setSessions] = useState<LibraryState>({ entries: [], notice: '', loaded: false });
  const [library] = useState(() => new PhotoLibraryStore(setSessions));
  const activeSessionId = useRef<string | undefined>(undefined);
  const exportedBaseline = useRef<string | undefined>(undefined);
  const comparisonRef = useRef(50);
  const [lastExportedKey, setLastExportedKey] = useState<string>();
  const [exportDialog, setExportDialog] = useState(false);
  const [savePresetDialog, setSavePresetDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState(defaultExportOptions);
  const [formats, setFormats] = useState<ExportFormat[]>(['image/png']);
  useUnsavedEditWarning(!!photo, recipe, lastExportedKey, sessions.entries.some(entry => entry.document.id !== activeSessionId.current && entry.status !== 'saved' && hasUnexportedEdits(true, entry.document.history.current, entry.document.lastExportedKey)));
  const history = useRef(new EditHistory(initialRecipe, recipeKey));
  const [, updateHistory] = useState(0);
  const [originalFrame, setOriginalFrame] = useState<Frame>();
  const originalGeometry = useRef('');
  const [cropSession, setCropSession] = useState<{ frame: Frame; initial: Crop; rotation: number }>();
  const [comparison, setComparison] = useState(50);
  const comparisonActivity = useComparisonActivity();
  const [busy, setBusy] = useState<'opening' | 'exporting' | 'preset' | 'crop' | 'recovering' | 'save-preset' | 'look' | 'restoring' | 'removing' | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [luts, setLuts] = useState<LutAsset[]>([]);
  const lutsRef = useRef<LutAsset[]>([]);
  const lutInput = useRef<HTMLInputElement>(null);
  const [presetReport, setPresetReport] = useState<SavedPreset>();
  const [storageNotice, setStorageNotice] = useState('');
  const presetInput = useRef<HTMLInputElement>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<RenderMetrics>();
  const input = useRef<HTMLInputElement>(null);
  const api = useRef<EngineClient | undefined>(undefined);
  const photoSerial = useRef(0);
  const sourceFile = useRef<File | undefined>(undefined);
  const workerEpoch = useRef(0);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const scheduler = useRef<LatestRenderer<Recipe, Frame> | undefined>(undefined);
  const busyRef = useRef(false);
  const dragDepth = useRef(0);
  const downloadUrls = useRef(new Set<string>());

  function startEngine() {
    scheduler.current?.dispose();
    api.current?.dispose();
    const epoch = ++workerEpoch.current;
    const client = new EngineClient(() => {
      if (epoch !== workerEpoch.current) return;
      workerEpoch.current++;
      comparisonActivity.finish();
      scheduler.current?.invalidate();
      setError(sourceFile.current ? 'The image processor stopped. Your photo and edits are still here. Choose Recover editor to continue.' : 'The image processor could not start. Choose Recover editor to retry.');
      setReady(false); setBusy(null); setRendering(false); setCropSession(undefined); setExportDialog(false); setSavePresetDialog(false);
      busyRef.current = false;
    });
    api.current = client;
    scheduler.current = new LatestRenderer(
      next => client.render(next, originalGeometry.current),
      result => { if (result.original) { setOriginalFrame(result.original); originalGeometry.current = result.geometryKey; } setFrame(result); setMetrics(result.metrics); setRendering(false); },
      failure => { if (epoch === workerEpoch.current) { setError(errorMessage(failure)); setRendering(false); } },
    );
    return { client, epoch };
  }

  useEffect(() => {
    const { client } = startEngine();
    setReady(true);
    void client.ready().catch(() => {});
    return () => {
      workerEpoch.current++;
      scheduler.current?.dispose(); api.current?.dispose();
      for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    void library.load();
    const save = () => { if (document.visibilityState === 'hidden') void library.flush(); };
    document.addEventListener('visibilitychange', save);
    return () => { document.removeEventListener('visibilitychange', save); library.dispose(); };
  }, []);

  function persistCurrent() {
    const id = activeSessionId.current;
    if (id) library.update(id, { history: history.current.snapshot(), lastExportedKey: exportedBaseline.current, comparison: comparisonRef.current }, lutsRef.current);
  }
  function changeComparison(value: number) {
    comparisonRef.current = value; setComparison(value); persistCurrent();
  }
  async function decodePhoto(client: EngineClient, file: File) {
    const loaded = await client.open(file);
    if (loaded !== 'decode-on-main') return loaded;
    const decoded = await decodeOnMain(file);
    return client.openDecoded(transfer(decoded, [decoded.pixels.buffer as ArrayBuffer, decoded.previewPixels.buffer as ArrayBuffer]));
  }
  async function installHistoryLuts(client: EngineClient, snapshot = history.current.snapshot()) {
    for (const id of sessionLutIds(snapshot)) {
      const asset = lutsRef.current.find(asset => asset.id === id);
      if (asset) await client.installLut(asset);
    }
  }
  async function restorePhoto(id: string) {
    if (busyRef.current || !api.current || !ready || activeSessionId.current === id) return;
    history.current.commit(); persistCurrent(); comparisonActivity.reset();
    const client = api.current, epoch = workerEpoch.current;
    busyRef.current = true; setBusy('restoring'); setError(''); setNotice(''); setRendering(false); scheduler.current?.invalidate();
    let changedSource = false;
    try {
      const saved = await library.open(id);
      validatePhoto(saved.file);
      const assets = Array.from(new Map([...saved.assets, ...lutsRef.current].map(asset => [asset.id, asset])).values());
      for (const asset of assets.filter(asset => sessionLutIds(saved.document.history).has(asset.id))) await client.installLut(asset);
      const look = saved.document.history.current.look;
      if (look?.kind === 'lut' && look.amount > 0 && !assets.some(asset => asset.id === look.assetId)) throw new Error(`Import the .cube file for ${look.name}, then resume this photo.`);
      const loaded = await decodePhoto(client, saved.file); changedSource = true;
      const restored = await client.render(saved.document.history.current);
      if (epoch !== workerEpoch.current) return;
      updateLuts(assets);
      sourceFile.current = saved.file; activeSessionId.current = id;
      setPhoto({ ...loaded.info, name: saved.document.name, id: ++photoSerial.current, sessionId: id });
      setFrame(restored); setOriginalFrame(restored.original ?? loaded.frame); originalGeometry.current = restored.geometryKey; setMetrics(restored.metrics);
      history.current.restore(saved.document.history); setRecipe(history.current.current); updateHistory(value => value + 1);
      exportedBaseline.current = saved.document.lastExportedKey; setLastExportedKey(exportedBaseline.current);
      comparisonRef.current = saved.document.comparison; setComparison(comparisonRef.current);
      library.select(id); setNotice('Your photo and edits are ready.');
    } catch (failure) {
      if (epoch !== workerEpoch.current) return;
      if (changedSource && sourceFile.current) {
        try {
          await decodePhoto(client, sourceFile.current); await installHistoryLuts(client);
          const restored = await client.render(history.current.current);
          if (epoch !== workerEpoch.current) return;
          setFrame(restored); setOriginalFrame(restored.original); originalGeometry.current = restored.geometryKey;
        } catch { setReady(false); }
      }
      setError(`Could not resume this photo. ${errorMessage(failure)}`);
    } finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }
  async function removePhoto(id: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('removing'); setError('');
    try {
      await library.remove(id);
      if (activeSessionId.current === id) {
        sourceFile.current = undefined; activeSessionId.current = undefined; exportedBaseline.current = undefined;
        setPhoto(undefined); setFrame(undefined); setOriginalFrame(undefined); originalGeometry.current = '';
        history.current.reset(initialRecipe); setRecipe(initialRecipe); setLastExportedKey(undefined); updateHistory(value => value + 1);
        comparisonRef.current = 50; setComparison(50); comparisonActivity.reset();
        const { client } = startEngine(); setReady(true); void client.ready().catch(() => {});
      }
      setNotice('Photo and edits removed from this browser.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  async function recoverEditor() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('recovering'); setError(''); setReady(false);
    const { client, epoch } = startEngine();
    try {
      await client.ready();
      if (sourceFile.current) {
        let loaded = await client.open(sourceFile.current);
        if (loaded === 'decode-on-main') {
          const decoded = await decodeOnMain(sourceFile.current);
          loaded = await client.openDecoded(transfer(decoded, [decoded.pixels.buffer as ArrayBuffer, decoded.previewPixels.buffer as ArrayBuffer]));
        }
        await installHistoryLuts(client);
        const restored = await client.render(history.current.current);
        if (epoch !== workerEpoch.current) return;
        setFrame(restored); setMetrics(restored.metrics); setOriginalFrame(restored.original ?? loaded.frame); originalGeometry.current = restored.geometryKey;
      }
      if (epoch === workerEpoch.current) { setReady(true); setNotice('Your photo and edits have been restored.'); }
    } catch (failure) {
      if (epoch === workerEpoch.current) setError(`Could not recover the editor. ${errorMessage(failure)}`);
    } finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  useEffect(() => {
    let active = true;
    void loadPresets().then(saved => {
      if (active) setPresets(current => Array.from(new Map([...saved, ...current].map(preset => [preset.id, preset])).values()));
    }).catch(() => { if (active) setStorageNotice('Browser storage is unavailable. Presets will be available for this session only.'); });
    return () => { active = false; };
  }, []);

  function updateLuts(assets: LutAsset[]) { lutsRef.current = assets; setLuts(assets); }

  useEffect(() => {
    let active = true;
    void loadLuts().then(saved => { if (active) updateLuts(Array.from(new Map([...saved, ...lutsRef.current].map(asset => [asset.id, asset])).values())); }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function usePreset(preset: SavedPreset) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('look'); setError('');
    const epoch = workerEpoch.current;
    let shown = preset;
    try {
      if (preset.patch.look?.kind === 'lut' && preset.patch.look.amount > 0) {
        const look = preset.patch.look;
        const asset = lutsRef.current.find(item => item.id === look.assetId);
        if (asset && api.current) await api.current.installLut(asset);
        else {
          const patch = { ...preset.patch }; delete patch.look;
          shown = { ...preset, patch, report: { ...preset.report, applied: preset.report.applied.filter(label => !label.startsWith('Look:')), unsupported: [...preset.report.unsupported, `Look “${look.name}” needs its .cube file. Import it, then apply this preset again. The current look is unchanged.`] } };
        }
      }
      if (epoch !== workerEpoch.current) return;
      busyRef.current = false;
      if (photo && shown.report.applied.length) applyRecipe(applyPresetPatch(history.current.current, shown.patch));
      setPresetReport(shown);
      const incomplete = shown.report.unsupported.length + shown.report.invalid.length + shown.report.warnings.length > 0;
      setNotice(!photo ? 'Preset ready. Open a photo, then select the preset to apply it.' : !shown.report.applied.length ? 'This preset has no available settings to apply. See its compatibility details.' : incomplete ? `Applied ${shown.name} with some unavailable settings. See its compatibility details.` : `Applied ${shown.name}.`);
    } catch (failure) { if (epoch === workerEpoch.current) setError(errorMessage(failure)); }
    finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  async function importLut(file: File) {
    if (busyRef.current || !api.current || !ready) return;
    if (file.size > MAX_CUBE_BYTES) { setError('Choose a .cube file smaller than 20 MB.'); return; }
    busyRef.current = true; setBusy('look'); setError(''); const epoch = workerEpoch.current;
    try {
      let asset = await api.current.importLut(file);
      try { await saveLut(asset); } catch { asset = { ...asset, sessionOnly: true }; setStorageNotice('This LUT is available for this session only. Keep its original .cube file.'); }
      if (epoch !== workerEpoch.current) return;
      updateLuts([asset, ...lutsRef.current.filter(item => item.id !== asset.id)]);
      busyRef.current = false;
      if (photo) applyRecipe({ ...history.current.current, look: { kind: 'lut', name: asset.name, amount: 1, assetId: asset.id } });
      setNotice(photo ? `Applied ${asset.name}.` : 'LUT saved. Open a photo, then choose it in Look & LUT.');
    } catch (failure) { if (epoch === workerEpoch.current) setError(errorMessage(failure)); }
    finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  async function chooseLook(id: string) {
    if (busyRef.current || !photo) return;
    if (!id) { applyRecipe({ ...history.current.current, look: null }); return; }
    if (id === 'embedded') return;
    const asset = lutsRef.current.find(item => item.id === id);
    if (!asset || !api.current) { setError('Import the required .cube file first.'); return; }
    busyRef.current = true; setBusy('look'); setError(''); const epoch = workerEpoch.current;
    try {
      await api.current.installLut(asset);
      if (epoch !== workerEpoch.current) return;
      busyRef.current = false;
      applyRecipe({ ...history.current.current, look: { kind: 'lut', name: asset.name, amount: 1, assetId: asset.id } });
    } catch (failure) { if (epoch === workerEpoch.current) setError(errorMessage(failure)); }
    finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  function downloadLut(asset: LutAsset) {
    const url = URL.createObjectURL(new Blob([asset.source], { type: 'text/plain' })); downloadUrls.current.add(url);
    const link = document.createElement('a'); link.href = url; link.download = `${asset.name.replace(/[<>:"/\\|?*]/g, '_')}.cube`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
  }

  async function importPreset(file: File) {
    if (busyRef.current || !ready) return;
    if (file.size > MAX_XMP_BYTES) { setError('Choose an XMP preset smaller than 2 MB.'); return; }
    const epoch = workerEpoch.current;
    busyRef.current = true; setBusy('preset'); setError('');
    try {
      let preset = await createPreset(await file.text(), file.name);
      const existing = presets.find(item => item.id === preset.id);
      if (existing) preset = { ...preset, name: existing.name, createdAt: existing.createdAt };
      try { await savePreset(preset); }
      catch { preset = { ...preset, sessionOnly: true }; setStorageNotice('This preset is available for this session only. Browser storage could not save it.'); }
      setPresets(current => [preset, ...current.filter(item => item.id !== preset.id)]);
      if (epoch === workerEpoch.current) { busyRef.current = false; await usePreset(preset); }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  async function saveCurrentPreset(options: SavePresetOptions) {
    if (!photo || busyRef.current) return;
    const epoch = workerEpoch.current;
    busyRef.current = true; setBusy('save-preset'); setError('');
    try {
      const xml = serializeXmpPreset(presetPatch(history.current.current, options.groups), options.name);
      let preset = await createPreset(xml, `${options.name}.xmp`);
      if (options.save) {
        try { await savePreset(preset); }
        catch { preset = { ...preset, sessionOnly: true }; setStorageNotice('This preset is available for this session only. Download its XMP file to keep a copy.'); }
        setPresets(current => [preset, ...current.filter(item => item.id !== preset.id)]);
      }
      if (options.download) downloadOriginalPreset(preset);
      setSavePresetDialog(false);
      setNotice(preset.sessionOnly ? 'Preset ready for this session. Download its XMP to keep it.' : options.save ? `Saved ${preset.name}.` : 'Your XMP preset is ready.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); } }
  }

  async function renamePreset(preset: SavedPreset, name: string) {
    let renamed = { ...preset, name };
    try { await savePreset(renamed); renamed = { ...renamed, sessionOnly: false }; }
    catch { renamed = { ...renamed, sessionOnly: true }; setStorageNotice('The new name is available for this session only.'); }
    setPresets(current => current.map(item => item.id === renamed.id ? renamed : item));
  }

  async function removePreset(preset: SavedPreset) {
    try { await deletePreset(preset.id); }
    catch { setStorageNotice('Removed for this session. Browser storage could not be updated.'); }
    setPresets(current => current.filter(item => item.id !== preset.id));
    if (presetReport?.id === preset.id) setPresetReport(undefined);
  }

  function downloadOriginalPreset(preset: SavedPreset) {
    const url = URL.createObjectURL(new Blob([preset.xml], { type: 'application/rdf+xml' }));
    downloadUrls.current.add(url);
    const link = document.createElement('a'); link.href = url;
    link.download = `${preset.name.replace(/[<>:"/\\|?*]/g, '_')}.xmp`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
  }

  useEffect(() => {
    void supportedExportFormats().then(setFormats).catch(() => setFormats(['image/png']));
  }, []);

  async function openPhoto(file: File) {
    if (busyRef.current || !api.current || !ready) return;
    const epoch = workerEpoch.current;
    try { validatePhoto(file); }
    catch (failure) { setError(errorMessage(failure)); return; }
    history.current.commit(); persistCurrent();
    busyRef.current = true;
    setBusy('opening');
    setError('');
    setNotice('');
    setRendering(false);
    scheduler.current?.invalidate();
    try {
      let loaded = await api.current.open(file);
      if (loaded === 'decode-on-main') {
        const decoded = await decodeOnMain(file);
        loaded = await api.current.openDecoded(transfer(decoded, [decoded.pixels.buffer as ArrayBuffer, decoded.previewPixels.buffer as ArrayBuffer]));
      }
      if (epoch !== workerEpoch.current) return;
      sourceFile.current = file;
      history.current.reset(initialRecipe);
      const sessionId = library.add(file, loaded.info, history.current.snapshot());
      activeSessionId.current = sessionId;
      setPhoto({ ...loaded.info, name: file.name, id: ++photoSerial.current, sessionId });
      setFrame(loaded.frame);
      setOriginalFrame(loaded.frame);
      originalGeometry.current = loaded.frame.geometryKey;
      setMetrics(loaded.frame.metrics);
      exportedBaseline.current = undefined;
      setLastExportedKey(undefined);
      setRecipe(initialRecipe);
      updateHistory(value => value + 1);
      comparisonRef.current = 50; setComparison(50);
      comparisonActivity.reset();
    } catch (failure) {
      if (epoch !== workerEpoch.current) return;
      setError(`Couldn't open this photo. ${errorMessage(failure)}`);
      if (photo) {
        setRendering(true);
        scheduler.current?.request(recipe);
      }
    } finally {
      if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); }
    }
  }

  function presentRecipe() {
    const next = history.current.current;
    setRecipe(next);
    updateHistory(value => value + 1);
    setRendering(true);
    setNotice('');
    scheduler.current?.request(next);
    persistCurrent();
  }

  function applyRecipe(next: Recipe, transient = false) {
    if (busyRef.current || !photo || !ready) return;
    const changed = recipeKey(next) !== recipeKey(history.current.current);
    if (transient) history.current.preview(next);
    else history.current.apply(next);
    if (changed) comparisonActivity.change(transient);
    else if (!transient) comparisonActivity.finish();
    presentRecipe();
  }

  function adjust(name: Adjustment, value: number, transient = false) {
    if (!Number.isFinite(value)) return;
    applyRecipe({ ...history.current.current, [name]: adjustmentValue(name, value) }, transient);
  }

  function commitGesture() {
    comparisonActivity.finish();
    history.current.commit();
    persistCurrent();
    updateHistory(value => value + 1);
  }

  function navigateHistory(direction: 'undo' | 'redo') {
    if (busyRef.current || !photo || !ready) return;
    const previousKey = recipeKey(history.current.current);
    history.current[direction]();
    if (recipeKey(history.current.current) !== previousKey) comparisonActivity.change();
    presentRecipe();
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'range'))) return;
      if (!photo || busyRef.current || !ready || exportDialog || savePresetDialog) return;
      event.preventDefault();
      navigateHistory(event.shiftKey ? 'redo' : 'undo');
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [photo, ready, exportDialog, savePresetDialog]);

  async function openCrop() {
    if (!api.current || !photo || busyRef.current || !ready) return;
    const epoch = workerEpoch.current;
    commitGesture();
    scheduler.current?.invalidate();
    busyRef.current = true; setBusy('crop'); setError(''); setRendering(false);
    try {
      const current = history.current.current;
      const fullGeometry = { crop: fullCrop(), rotation: current.geometry.rotation };
      const cropFrame = await api.current.render({ ...current, geometry: fullGeometry }, geometryKey(fullGeometry));
      if (epoch !== workerEpoch.current) return;
      setCropSession({ frame: cropFrame, initial: displayCrop(current.geometry.crop, current.geometry.rotation), rotation: current.geometry.rotation });
    } catch (failure) {
      if (epoch === workerEpoch.current) { busyRef.current = false; setError(errorMessage(failure)); presentRecipe(); }
    } finally { if (epoch === workerEpoch.current) setBusy(null); }
  }

  function closeCrop(selection?: Crop) {
    if (!cropSession || !photo) return;
    const session = cropSession;
    setCropSession(undefined); busyRef.current = false;
    if (selection) {
      const crop = snapCrop(sourceCrop(selection, session.rotation), photo.width, photo.height);
      applyRecipe({ ...history.current.current, geometry: { crop, rotation: session.rotation } });
    } else presentRecipe();
  }

  function rotate(direction: number) {
    const current = history.current.current;
    applyRecipe({ ...current, geometry: { ...current.geometry, rotation: (current.geometry.rotation + direction + 4) % 4 } });
  }

  async function exportPhoto(options: ExportOptions) {
    if (!api.current || !photo || busyRef.current) return;
    const epoch = workerEpoch.current;
    const exportedKey = recipeKey(recipe);
    busyRef.current = true;
    setBusy('exporting');
    setError('');
    setNotice('');
    try {
      // Export the current edits even when the comparison view shows the original.
      const result = await api.current.exportImage(recipe, options);
      const blob = result.blob ?? await encodeOnMain(result.frame!.pixels, result.frame!.width, result.frame!.height, options);
      if (epoch !== workerEpoch.current) return;
      setMetrics(result.metrics);
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${photo.name.replace(/\.[^.]+$/, '')}-edited.${formatExtensions[options.format]}`;
      document.body.append(link);
      link.click();
      link.remove();
      exportedBaseline.current = exportedKey; setLastExportedKey(exportedKey); persistCurrent();
      setExportOptions(options);
      setExportDialog(false);
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
      setNotice('Your edited photo is ready.');
    } catch (failure) {
      if (epoch === workerEpoch.current) setError(`Couldn't export this photo. ${errorMessage(failure)}`);
    } finally {
      if (epoch === workerEpoch.current) { busyRef.current = false; setBusy(null); }
    }
  }

  const disabled = !photo || !!busy || !ready || !!cropSession;
  const status = busy === 'restoring' ? 'Restoring your photo…' : busy === 'removing' ? 'Removing the saved photo…' : busy === 'opening' ? 'Opening your photo…' : busy === 'exporting' ? 'Preparing your full-size image…' : busy === 'preset' ? 'Reading your preset…' : busy === 'crop' ? 'Preparing crop preview…' : busy === 'recovering' ? 'Recovering your photo and edits…' : busy === 'save-preset' ? 'Saving your preset…' : busy === 'look' ? 'Preparing your look…' : rendering ? 'Updating preview…' : notice;

  const resume = sessions.entries.find(entry => entry.document.id === sessions.resumeId) ?? sessions.entries[0];
  const activeSaveStatus = sessions.entries.find(entry => entry.document.id === activeSessionId.current)?.status;

  return (
    <div class="app-shell"
      onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault(); dragDepth.current = 0; setDragging(false);
        const files = event.dataTransfer?.files;
        if (files?.length === 1) { if (/\.xmp$/i.test(files[0].name)) void importPreset(files[0]); else if (/\.cube$/i.test(files[0].name)) void importLut(files[0]); else void openPhoto(files[0]); }
        else if (files && files.length > 1) setError('Open one photo or preset at a time.');
      }}
    >
      <header class="topbar">
        <a class="brand" href={import.meta.env.BASE_URL} aria-label="Still photo editor home"><span class="brand-mark"><Icon name="image" size={22} /></span><span>still<span class="brand-dot">.</span></span></a>
        <span class="header-description">A little light. A new perspective.</span>
        <div class="header-actions">
          <ThemeToggle />
          <button class="button button-quiet" disabled={!!busy || !ready} onClick={() => input.current?.click()}><Icon name="plus" size={17} />Open photo</button>
          <button class="button button-primary" disabled={disabled} onClick={() => { setError(''); setExportDialog(true); }}><Icon name="download" size={17} />Export</button>
        </div>
      </header>

      <input ref={input} class="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void openPhoto(file);
        event.currentTarget.value = '';
      }} />

      <input ref={presetInput} class="file-input" type="file" accept=".xmp,application/rdf+xml" aria-label="Choose an XMP preset" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importPreset(file); event.currentTarget.value = ''; }} />

      <input ref={lutInput} class="file-input" type="file" accept=".cube" aria-label="Choose a LUT file" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importLut(file); event.currentTarget.value = ''; }} />

      {error && <div class="error-banner" role="alert"><span>{error}</span>{!ready && <button class="button button-small button-quiet" disabled={!!busy} onClick={() => void recoverEditor()}>Recover editor</button>}<button class="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={18} /></button></div>}

      <main class={`workspace ${photo ? 'has-photo' : ''}`}>
        <section class="stage" aria-label="Photo preview" aria-busy={!!busy || rendering}>
          <div class="stage-toolbar">
            <PhotoLibrary state={sessions} activeId={activeSessionId.current} busy={!!busy || !ready || !!cropSession} onSelect={id => void restorePhoto(id)} onRemove={removePhoto} onRetry={id => library.retry(id)} onAdd={() => input.current?.click()} />
            <span class="local-badge" data-photo-save-status={activeSaveStatus}><span class="status-dot" />{activeSaveStatus === 'saving' ? 'Saving…' : activeSaveStatus === 'saved' ? 'Saved in this browser' : activeSaveStatus === 'session' ? 'Session only' : 'On your device'}</span>
          </div>

          <div class={`canvas-area ${photo ? 'loaded' : ''}`}>
            {photo && frame && originalFrame ? <ComparisonPreview revealForEdit={comparisonActivity.visible} key={`${photo.id}:${frame.geometryKey}`} client={api.current} recipe={recipe} detailEnabled={ready && !busy && !rendering} frame={frame} original={originalFrame} name={photo.name} metrics={metrics} position={comparison} onPositionChange={changeComparison} onThumbnail={(blob, key) => { if (activeSessionId.current === photo.sessionId && key === recipeKey(history.current.current)) library.update(photo.sessionId, { thumbnail: blob }); }} /> : <div class="empty-state">
              <div class="photo-illustration" aria-hidden="true"><div class="illustration-back" /><div class="illustration-front"><div class="illustration-sun" /><div class="illustration-hill hill-back" /><div class="illustration-hill hill-front" /><span class="illustration-spark">✦</span></div></div>
              <span class="eyebrow empty-eyebrow">A fresh point of view</span>
              <h1>{resume ? <>Pick up where<br />you left off.</> : <>Your photo.<br />A little brighter.</>}</h1>
              <p>{resume ? <>{resume.status === 'saved' ? 'Your photos and edits are saved in this browser.' : resume.status === 'session' ? 'Your photos and edits are available in this tab.' : 'Your photos and edits are being saved in this browser.'}<br /><span class="resume-photo-name" title={resume.document.name}>{resume.document.name}</span></> : <>Drop a photo here and make it your own.<br />Simple adjustments, right in your browser.</>}</p>
              {resume && <button class="button button-primary button-large resume-photo" disabled={!!busy || !ready} onClick={() => void restorePhoto(resume.document.id)}>Resume photo<Icon name="arrow" size={18} /></button>}
              <button class={`button ${resume ? 'button-quiet' : 'button-primary'} button-large`} disabled={!!busy || !ready} onClick={() => input.current?.click()}>Choose a photo<Icon name="arrow" size={18} /></button>
              <span class="format-note">JPEG, PNG, or WebP</span>
            </div>}
            {(busy === 'opening' || busy === 'restoring') && <div class="loading-overlay"><span class="spinner" /><span>{busy === 'restoring' ? 'Restoring your photo…' : 'Opening your photo…'}</span></div>}
          </div>

          <div class="stage-footer">
            <div class="photo-caption">{photo ? <><span class="photo-name" title={photo.name}>{photo.name}</span><span class="dimensions">{(frame?.outputWidth ?? photo.width).toLocaleString()} × {(frame?.outputHeight ?? photo.height).toLocaleString()}</span></> : <span>Open. Adjust. Make it yours.</span>}</div>
            {photo && <div class="comparison-actions"><button class="button button-small button-quiet" disabled={disabled || comparison === 50} onClick={() => changeComparison(50)}>Split view</button><button class={`button button-small ${comparison === 100 ? 'button-selected' : 'button-quiet'}`} disabled={disabled} aria-pressed={comparison === 100} onClick={() => changeComparison(comparison === 100 ? 0 : 100)}>Show original</button></div>}
          </div>
        </section>

        <aside class={`controls ${controlsCollapsed ? 'controls-collapsed' : ''}`} aria-label="Photo adjustments">
          <div class="panel-heading"><div><span class="eyebrow">Make it yours</span><h2>Adjustments</h2></div><span class="panel-icon"><Icon name="sun" size={22} /></span><button class="button button-small button-quiet mobile-controls-toggle" aria-expanded={!controlsCollapsed} aria-controls="editor-controls" onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? 'Show controls' : 'Hide controls'}</button></div>
          <div class="controls-content" id="editor-controls">
          <PresetLibrary presets={presets} disabled={!!busy || !ready} storageNotice={storageNotice} report={presetReport}
            onImport={() => presetInput.current?.click()} onApply={preset => void usePreset(preset)} onRename={(preset, name) => void renamePreset(preset, name)} onDelete={preset => void removePreset(preset)} onDownload={downloadOriginalPreset} />
          <button class="button button-small button-quiet save-preset-trigger" disabled={disabled} onClick={() => { commitGesture(); setError(''); setSavePresetDialog(true); }}>Save as preset</button>
          <div class="history-toolbar">
            <button class="button button-small button-quiet" disabled={disabled || !history.current.canUndo} onClick={() => navigateHistory('undo')} title="Undo (⌘/Ctrl Z)">Undo</button>
            <button class="button button-small button-quiet" disabled={disabled || !history.current.canRedo} onClick={() => navigateHistory('redo')} title="Redo (⌘/Ctrl Shift Z)">Redo</button>
            <button class="text-button" disabled={disabled || recipeKey(recipe) === recipeKey(initialRecipe)} onClick={() => applyRecipe(initialRecipe)}><Icon name="reset" size={13} />Reset</button>
          </div>
          <div class="frame-controls">
            <button class="button button-small button-quiet" disabled={disabled} onClick={() => void openCrop()}>Crop</button>
            <button class="button button-small button-quiet" disabled={disabled} aria-label="Rotate left" title="Rotate left 90°" onClick={() => rotate(-1)}>↶</button>
            <button class="button button-small button-quiet" disabled={disabled} aria-label="Rotate right" title="Rotate right 90°" onClick={() => rotate(1)}>↷</button>
            <button class="text-button" disabled={disabled || geometryKey(recipe.geometry) === geometryKey(defaultGeometry())} onClick={() => applyRecipe({ ...history.current.current, geometry: defaultGeometry() })}>Reset framing</button>
          </div>
          <div class={`adjustment-section ${!photo ? 'inactive' : ''}`}>
            <div class="section-heading"><h3>Light</h3></div>
            {(['exposure', 'contrast'] as const).map(name => <AdjustmentSlider key={name} name={name} value={recipe[name]} disabled={disabled} onInput={value => adjust(name, value, true)} onCommit={commitGesture} onChange={value => adjust(name, value)} />)}
          </div>
          <div class={`adjustment-section ${!photo ? 'inactive' : ''}`}>
            <div class="section-heading"><h3>Color</h3></div>
            {(['warmth', 'tint', 'saturation'] as const).map(name => <AdjustmentSlider key={name} name={name} value={recipe[name]} disabled={disabled} onInput={value => adjust(name, value, true)} onCommit={commitGesture} onChange={value => adjust(name, value)} />)}
            <details class="advanced-controls"><summary>More color controls</summary><AdjustmentSlider name="vibrance" value={recipe.vibrance} disabled={disabled} onInput={value => adjust('vibrance', value, true)} onCommit={commitGesture} onChange={value => adjust('vibrance', value)} /></details>
          </div>
          <LookPanel look={recipe.look} luts={luts} disabled={disabled} canImport={!busy && ready} onImport={() => lutInput.current?.click()} onSelect={id => void chooseLook(id)} onCommit={commitGesture}
            onAmount={(amount, transient) => { const look = history.current.current.look; if (look) applyRecipe({ ...history.current.current, look: { ...look, amount } }, transient); }} onDownload={downloadLut} />
          <CurveEditor curves={recipe.curves} disabled={disabled} onCommit={commitGesture} onChange={(channel, points, transient) => applyRecipe({ ...history.current.current, curves: { ...history.current.current.curves, [channel]: points } }, transient)} />
          <HslEditor settings={recipe.hsl} disabled={disabled} onCommit={commitGesture}
            onChange={(band, key, value, transient) => applyRecipe({ ...history.current.current, hsl: { ...history.current.current.hsl, [band]: { ...history.current.current.hsl[band], [key]: value } } }, transient)}
            onReset={band => applyRecipe({ ...history.current.current, hsl: { ...history.current.current.hsl, [band]: emptyBand() } })} />
          <div class="panel-bottom">
            <div class="tip"><span class="tip-mark"><Icon name="check" size={15} /></span><div><strong>Room to experiment</strong><p>Your original stays untouched. Reset your edits whenever you like.</p></div></div>
            <div class="export-note"><span class="tiny-dot" />Full-resolution export</div>
          </div>
          </div>
        </aside>
      </main>

      <footer class="app-footer"><span>Made for a moment of focus.</span><span role="status" aria-live="polite" class="operation-status">{status || 'Your photos stay on your device.'}</span></footer>
      {savePresetDialog && <SavePresetDialog hasLut={recipe.look?.kind === 'lut'} busy={busy === 'save-preset'} error={error} onSave={options => void saveCurrentPreset(options)} onCancel={() => setSavePresetDialog(false)} />}
      {exportDialog && frame && <ExportDialog width={frame.outputWidth} height={frame.outputHeight} formats={formats} initial={exportOptions} busy={busy === 'exporting'} error={error} onExport={options => void exportPhoto(options)} onCancel={() => setExportDialog(false)} />}
      {cropSession && <CropDialog frame={cropSession.frame} initial={cropSession.initial} onApply={selection => closeCrop(selection)} onCancel={() => closeCrop()} />}
      {dragging && <div class="drop-overlay"><div><Icon name="image" size={38} /><h2>Drop a photo, preset, or LUT</h2><p>JPEG, PNG, WebP, XMP, or .cube · one at a time</p></div></div>}
    </div>
  );
}
