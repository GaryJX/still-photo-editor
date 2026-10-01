import { useEffect, useRef, useState } from 'preact/hooks';
import { transfer, wrap, type Remote } from 'comlink';
import { Icon } from '../components/Icon';
import { ComparisonPreview } from '../components/ComparisonPreview';
import { decodeOnMain, encodeOnMain, validatePhoto } from '../editor/image';
import { exposureRecipe, initialRecipe, type Recipe } from '../editor/recipe';
import { LatestRenderer } from '../editor/scheduler';
import type { EngineApi, Frame, PhotoInfo, RenderMetrics } from '../worker/types';

type Photo = PhotoInfo & { name: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Photo>();
  const [frame, setFrame] = useState<Frame>();
  const [recipe, setRecipe] = useState<Recipe>(initialRecipe);
  const [originalFrame, setOriginalFrame] = useState<Frame>();
  const [comparison, setComparison] = useState(50);
  const [busy, setBusy] = useState<'opening' | 'exporting' | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<RenderMetrics>();
  const input = useRef<HTMLInputElement>(null);
  const api = useRef<Remote<EngineApi> | undefined>(undefined);
  const scheduler = useRef<LatestRenderer<Recipe, Frame> | undefined>(undefined);
  const busyRef = useRef(false);
  const dragDepth = useRef(0);
  const downloadUrls = useRef(new Set<string>());

  useEffect(() => {
    const worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    api.current = wrap<EngineApi>(worker);
    scheduler.current = new LatestRenderer(
      (next) => api.current!.render(next),
      (result) => { setFrame(result); setMetrics(result.metrics); setRendering(false); },
      (failure) => { setError(errorMessage(failure)); setRendering(false); },
    );
    worker.addEventListener('error', () => {
      setError('The editor stopped unexpectedly. Reload this page to open your photo again.');
      setReady(false);
      setBusy(null);
      setRendering(false);
      busyRef.current = false;
    });
    setReady(true);
    return () => {
      scheduler.current?.dispose();
      worker.terminate();
      for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function openPhoto(file: File) {
    if (busyRef.current || !api.current || !ready) return;
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
      setPhoto({ ...loaded.info, name: file.name });
      setFrame(loaded.frame);
      setOriginalFrame(loaded.frame);
      setMetrics(loaded.frame.metrics);
      setRecipe(initialRecipe);
      setComparison(50);
    } catch (failure) {
      setError(`Couldn't open this photo. ${errorMessage(failure)}`);
      if (photo) {
        setRendering(true);
        scheduler.current?.request(recipe);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function adjustExposure(value: number) {
    if (!Number.isFinite(value) || busyRef.current || !photo) return;
    const next = exposureRecipe(value);
    setRecipe(next);
    setRendering(true);
    setNotice('');
    scheduler.current?.request(next);
  }

  async function exportPhoto() {
    if (!api.current || !photo || busyRef.current) return;
    busyRef.current = true;
    setBusy('exporting');
    setError('');
    setNotice('');
    try {
      // Export the current edits even when the comparison view shows the original.
      const result = await api.current.exportPng(recipe);
      const blob = result.blob ?? await encodeOnMain(result.frame!.pixels, result.frame!.width, result.frame!.height);
      setMetrics(result.metrics);
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${photo.name.replace(/\.[^.]+$/, '')}-edited.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 60_000);
      setNotice('Your edited photo is ready.');
    } catch (failure) {
      setError(`Couldn't export this photo. ${errorMessage(failure)}`);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const disabled = !photo || !!busy || !ready;
  const status = busy === 'opening' ? 'Opening your photo…' : busy === 'exporting' ? 'Preparing your full-size PNG…' : rendering ? 'Updating preview…' : notice;

  return (
    <div class="app-shell"
      onDragEnter={(event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { dragDepth.current++; setDragging(true); } }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault(); dragDepth.current = 0; setDragging(false);
        const files = event.dataTransfer?.files;
        if (files?.length === 1) void openPhoto(files[0]);
        else if (files && files.length > 1) setError('Open one photo at a time.');
      }}
    >
      <header class="topbar">
        <a class="brand" href={import.meta.env.BASE_URL} aria-label="Still photo editor home"><span class="brand-mark"><Icon name="image" size={22} /></span><span>still<span class="brand-dot">.</span></span></a>
        <span class="header-description">A little light. A new perspective.</span>
        <div class="header-actions">
          <button class="button button-quiet" disabled={!!busy || !ready} onClick={() => input.current?.click()}><Icon name="plus" size={17} />Open photo</button>
          <button class="button button-primary" disabled={disabled} onClick={() => void exportPhoto()}><Icon name="download" size={17} />{busy === 'exporting' ? 'Exporting…' : 'Export PNG'}</button>
        </div>
      </header>

      <input ref={input} class="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void openPhoto(file);
        event.currentTarget.value = '';
      }} />

      {error && <div class="error-banner" role="alert"><span>{error}</span><button class="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={18} /></button></div>}

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
            <div class="photo-caption">{photo ? <><span class="photo-name" title={photo.name}>{photo.name}</span><span class="dimensions">{photo.width.toLocaleString()} × {photo.height.toLocaleString()}</span></> : <span>Open. Adjust. Make it yours.</span>}</div>
            {photo && <div class="comparison-actions"><button class="button button-small button-quiet" disabled={disabled || comparison === 50} onClick={() => setComparison(50)}>Split view</button><button class={`button button-small ${comparison === 100 ? 'button-selected' : 'button-quiet'}`} disabled={disabled} aria-pressed={comparison === 100} onClick={() => setComparison(comparison === 100 ? 0 : 100)}>Show original</button></div>}
          </div>
        </section>

        <aside class="controls" aria-label="Photo adjustments">
          <div class="panel-heading"><div><span class="eyebrow">Make it yours</span><h2>Adjustments</h2></div><span class="panel-icon"><Icon name="sun" size={22} /></span></div>
          <div class={`adjustment-section ${!photo ? 'inactive' : ''}`}>
            <div class="section-heading"><h3>Light</h3><button class="text-button" disabled={disabled || recipe.exposure === 0} onClick={() => adjustExposure(0)}><Icon name="reset" size={13} />Reset</button></div>
            <div class="slider-heading"><label for="exposure">Exposure</label><div class="numeric-control"><input aria-label="Exposure value" type="number" min="-4" max="4" step="0.05" value={recipe.exposure} disabled={disabled} onChange={(event) => { adjustExposure(event.currentTarget.valueAsNumber); event.currentTarget.value = String(recipe.exposure); }} /><span>EV</span></div></div>
            <input id="exposure" class="exposure-slider" type="range" min="-4" max="4" step="0.05" value={recipe.exposure} disabled={disabled} aria-describedby="exposure-help" onInput={(event) => adjustExposure(event.currentTarget.valueAsNumber)} />
            <div class="range-labels" aria-hidden="true"><span>Darker</span><span>Brighter</span></div>
            <p id="exposure-help" class="control-help">Bring a little more light into your photo, or dial it back for a softer mood.</p>
          </div>
          <div class="panel-bottom">
            <div class="tip"><span class="tip-mark"><Icon name="check" size={15} /></span><div><strong>Room to experiment</strong><p>Your original stays untouched. Reset your edits whenever you like.</p></div></div>
            <div class="export-note"><span class="tiny-dot" />Full-size PNG export</div>
          </div>
        </aside>
      </main>

      <footer class="app-footer"><span>Made for a moment of focus.</span><span role="status" aria-live="polite" class="operation-status">{status || 'Your photos stay on your device.'}</span></footer>
      {dragging && <div class="drop-overlay"><div><Icon name="image" size={38} /><h2>Drop your photo here</h2><p>JPEG, PNG, or WebP · one at a time</p></div></div>}
    </div>
  );
}
