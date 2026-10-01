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
import { CropDialog } from '../components/CropDialog';
import { ExportDialog } from '../components/ExportDialog';
import { defaultExportOptions, formatExtensions, supportedExportFormats, type ExportFormat, type ExportOptions } from '../editor/encoding';
import { defaultGeometry, displayCrop, fullCrop, geometryKey, snapCrop, sourceCrop, type Crop } from '../editor/geometry';
import { emptyBand } from '../editor/hsl';
import { PresetLibrary } from '../components/PresetLibrary';
import { SavePresetDialog, type SavePresetOptions } from '../components/SavePresetDialog';
import { presetPatch, serializeXmpPreset } from '../presets/export';
import { applyPresetPatch, createPreset, MAX_XMP_BYTES, type SavedPreset } from '../presets/xmp';
import { loadPresets, savePreset, deletePreset } from '../presets/storage';
import { useUnsavedEditWarning } from '../editor/unsaved';
import { LatestRenderer } from '../editor/scheduler';
import type { Frame, PhotoInfo, RenderMetrics } from '../worker/types';

type Photo = PhotoInfo & { name: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Photo>();
  const [frame, setFrame] = useState<Frame>();
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [lastExportedKey, setLastExportedKey] = useState<string>();
  const [exportDialog, setExportDialog] = useState(false);
  const [savePresetDialog, setSavePresetDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState(defaultExportOptions);
  const [formats, setFormats] = useState<ExportFormat[]>(['image/png']);
  useUnsavedEditWarning(!!photo, recipe, lastExportedKey);
  const history = useRef(new EditHistory(initialRecipe, recipeKey));
  const [, updateHistory] = useState(0);
  const [originalFrame, setOriginalFrame] = useState<Frame>();
  const originalGeometry = useRef('');
  const [cropSession, setCropSession] = useState<{ frame: Frame; initial: Crop; rotation: number }>();
  const [comparison, setComparison] = useState(50);
  const [busy, setBusy] = useState<'opening' | 'exporting' | 'preset' | 'crop' | 'recovering' | 'save-preset' | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
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

  function usePreset(preset: SavedPreset) {
    if (busyRef.current) return;
    setError('');
    if (photo && preset.report.applied.length) applyRecipe(applyPresetPatch(history.current.current, preset.patch));
    setPresetReport(preset);
    const incomplete = preset.report.unsupported.length + preset.report.invalid.length + preset.report.warnings.length > 0;
    setNotice(!photo ? 'Preset ready. Open a photo, then select the preset to apply it.' : !preset.report.applied.length ? 'This preset has no supported settings to apply. See its compatibility details.' : incomplete ? `Applied ${preset.name} with some unavailable settings. See its compatibility details.` : `Applied ${preset.name}.`);
  }

  async function importPreset(file: File) {
    if (busyRef.current || !ready) return;
    if (file.size > MAX_XMP_BYTES) { setError('Choose an XMP preset smaller than 2 MB.'); return; }
    busyRef.current = true; setBusy('preset'); setError('');
    try {
      let preset = await createPreset(await file.text(), file.name);
      const existing = presets.find(item => item.id === preset.id);
      if (existing) preset = { ...preset, name: existing.name, createdAt: existing.createdAt };
      try { await savePreset(preset); }
      catch { preset = { ...preset, sessionOnly: true }; setStorageNotice('This preset is available for this session only. Browser storage could not save it.'); }
      setPresets(current => [preset, ...current.filter(item => item.id !== preset.id)]);
      busyRef.current = false;
      usePreset(preset);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  async function saveCurrentPreset(options: SavePresetOptions) {
    if (!photo || busyRef.current) return;
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
    finally { busyRef.current = false; setBusy(null); }
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
      setPhoto({ ...loaded.info, name: file.name });
      setFrame(loaded.frame);
      setOriginalFrame(loaded.frame);
      originalGeometry.current = loaded.frame.geometryKey;
      setMetrics(loaded.frame.metrics);
      history.current.reset(initialRecipe);
      setLastExportedKey(undefined);
      setRecipe(initialRecipe);
      updateHistory(value => value + 1);
      setComparison(50);
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
  }

  function applyRecipe(next: Recipe, transient = false) {
    if (busyRef.current || !photo || !ready) return;
    if (transient) history.current.preview(next);
    else history.current.apply(next);
    presentRecipe();
  }

  function adjust(name: Adjustment, value: number, transient = false) {
    if (!Number.isFinite(value)) return;
    applyRecipe({ ...history.current.current, [name]: adjustmentValue(name, value) }, transient);
  }

  function commitGesture() {
    history.current.commit();
    updateHistory(value => value + 1);
  }

  function navigateHistory(direction: 'undo' | 'redo') {
    if (busyRef.current || !photo || !ready) return;
    history.current[direction]();
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
      setLastExportedKey(exportedKey);
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
  const status = busy === 'opening' ? 'Opening your photo…' : busy === 'exporting' ? 'Preparing your full-size image…' : busy === 'preset' ? 'Reading your preset…' : busy === 'crop' ? 'Preparing crop preview…' : busy === 'recovering' ? 'Recovering your photo and edits…' : busy === 'save-preset' ? 'Saving your preset…' : rendering ? 'Updating preview…' : notice;

  return (
    <div class="app-shell"
      onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault(); dragDepth.current = 0; setDragging(false);
        const files = event.dataTransfer?.files;
        if (files?.length === 1) { if (/\.xmp$/i.test(files[0].name)) void importPreset(files[0]); else void openPhoto(files[0]); }
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

      {error && <div class="error-banner" role="alert"><span>{error}</span>{!ready && <button class="button button-small button-quiet" disabled={!!busy} onClick={() => void recoverEditor()}>Recover editor</button>}<button class="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={18} /></button></div>}

      <main class={`workspace ${photo ? 'has-photo' : ''}`}>
        <section class="stage" aria-label="Photo preview" aria-busy={!!busy || rendering}>
          <div class="stage-toolbar">
            <span class="eyebrow">{photo ? 'Your canvas' : 'Something good starts here'}</span>
            <span class="local-badge"><span class="status-dot" />On your device</span>
          </div>

          <div class={`canvas-area ${photo ? 'loaded' : ''}`}>
            {photo && frame && originalFrame ? <ComparisonPreview frame={frame} original={originalFrame} name={photo.name} metrics={metrics} position={comparison} onPositionChange={setComparison} /> : <div class="empty-state">
              <div class="photo-illustration" aria-hidden="true"><div class="illustration-back" /><div class="illustration-front"><div class="illustration-sun" /><div class="illustration-hill hill-back" /><div class="illustration-hill hill-front" /><span class="illustration-spark">✦</span></div></div>
              <span class="eyebrow empty-eyebrow">A fresh point of view</span>
              <h1>Your photo.<br />A little brighter.</h1>
              <p>Drop a photo here and make it your own.<br />Simple adjustments, right in your browser.</p>
              <button class="button button-primary button-large" disabled={!!busy || !ready} onClick={() => input.current?.click()}>Choose a photo<Icon name="arrow" size={18} /></button>
              <span class="format-note">JPEG, PNG, or WebP</span>
            </div>}
            {busy === 'opening' && <div class="loading-overlay"><span class="spinner" /><span>Opening your photo…</span></div>}
          </div>

          <div class="stage-footer">
            <div class="photo-caption">{photo ? <><span class="photo-name" title={photo.name}>{photo.name}</span><span class="dimensions">{(frame?.outputWidth ?? photo.width).toLocaleString()} × {(frame?.outputHeight ?? photo.height).toLocaleString()}</span></> : <span>Open. Adjust. Make it yours.</span>}</div>
            {photo && <div class="comparison-actions"><button class="button button-small button-quiet" disabled={disabled || comparison === 50} onClick={() => setComparison(50)}>Split view</button><button class={`button button-small ${comparison === 100 ? 'button-selected' : 'button-quiet'}`} disabled={disabled} aria-pressed={comparison === 100} onClick={() => setComparison(comparison === 100 ? 0 : 100)}>Show original</button></div>}
          </div>
        </section>

        <aside class={`controls ${controlsCollapsed ? 'controls-collapsed' : ''}`} aria-label="Photo adjustments">
          <div class="panel-heading"><div><span class="eyebrow">Make it yours</span><h2>Adjustments</h2></div><span class="panel-icon"><Icon name="sun" size={22} /></span><button class="button button-small button-quiet mobile-controls-toggle" aria-expanded={!controlsCollapsed} aria-controls="editor-controls" onClick={() => setControlsCollapsed(value => !value)}>{controlsCollapsed ? 'Show controls' : 'Hide controls'}</button></div>
          <div class="controls-content" id="editor-controls">
          <PresetLibrary presets={presets} disabled={!!busy || !ready} storageNotice={storageNotice} report={presetReport}
            onImport={() => presetInput.current?.click()} onApply={usePreset} onRename={(preset, name) => void renamePreset(preset, name)} onDelete={preset => void removePreset(preset)} onDownload={downloadOriginalPreset} />
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
      {savePresetDialog && <SavePresetDialog busy={busy === 'save-preset'} error={error} onSave={options => void saveCurrentPreset(options)} onCancel={() => setSavePresetDialog(false)} />}
      {exportDialog && frame && <ExportDialog width={frame.outputWidth} height={frame.outputHeight} formats={formats} initial={exportOptions} busy={busy === 'exporting'} error={error} onExport={options => void exportPhoto(options)} onCancel={() => setExportDialog(false)} />}
      {cropSession && <CropDialog frame={cropSession.frame} initial={cropSession.initial} onApply={selection => closeCrop(selection)} onCancel={() => closeCrop()} />}
      {dragging && <div class="drop-overlay"><div><Icon name="image" size={38} /><h2>Drop a photo or preset</h2><p>JPEG, PNG, WebP, or XMP · one at a time</p></div></div>}
    </div>
  );
}
