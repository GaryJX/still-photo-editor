import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { DetailFrame, DetailRegion, Frame, RenderMetrics } from '../worker/types';
import type { Recipe } from '../editor/recipe';
import { recipeKey } from '../editor/recipe';
import type { EngineClient } from '../editor/engine-client';
import { LatestRenderer } from '../editor/scheduler';
import { boundView, detailRegion, fitView, zoomAt, type Size, type View } from '../editor/viewport';

type Point = { x: number; y: number };
type Gesture = { kind: 'compare' } | { kind: 'pan'; start: Point; view: View } | { kind: 'pinch'; start: Point; distance: number; view: View };

function draw(canvas: HTMLCanvasElement | null, frame: Frame) {
  const context = canvas?.getContext('2d', { colorSpace: 'srgb' });
  if (!canvas || !context) return;
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.buffer as ArrayBuffer), frame.width, frame.height), 0, 0);
}

function DetailCanvas({ frame, region, kind }: { frame: Frame; region: DetailRegion; kind: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => draw(canvas.current, frame), [frame]);
  return <canvas ref={canvas} class="detail-canvas" data-detail={kind} data-region={JSON.stringify(region)} data-recipe={frame.recipeKey} aria-hidden="true"
    style={{ left: `${region.x / frame.outputWidth * 100}%`, top: `${region.y / frame.outputHeight * 100}%`, width: `${region.width / frame.outputWidth * 100}%`, height: `${region.height / frame.outputHeight * 100}%` }} />;
}

export function ComparisonPreview({ frame, original, name, metrics, position, onPositionChange, client, recipe, detailEnabled, revealForEdit, onThumbnail }: {
  frame: Frame; original: Frame; name: string; metrics?: RenderMetrics;
  position: number; onPositionChange: (position: number) => void;
  client?: EngineClient; recipe: Recipe; detailEnabled: boolean; revealForEdit: boolean; onThumbnail?: (blob: Blob, recipeKey: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [view, setView] = useState<View>(fitView);
  const viewRef = useRef(view);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [interacting, setInteracting] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | undefined>(undefined);
  const [detail, setDetail] = useState<DetailFrame>();
  const [detailError, setDetailError] = useState(false);
  const [retry, setRetry] = useState(0);
  const scheduler = useRef<LatestRenderer<{ recipe: Recipe; region: DetailRegion }, DetailFrame> | undefined>(undefined);
  const fitScale = size.width / frame.outputWidth || 1;
  const maxZoom = Math.max(1, 4 / fitScale);
  const zoomed = view.zoom > 1.00001;
  const region = detailRegion(view, size, { width: frame.outputWidth, height: frame.outputHeight }, window.devicePixelRatio);
  const regionKey = JSON.stringify(region);
  const currentRecipeKey = recipeKey(recipe);
  const currentDetail = zoomed && detail?.edited.recipeKey === frame.recipeKey && frame.recipeKey === currentRecipeKey && JSON.stringify(detail.region) === regionKey ? detail : undefined;

  useLayoutEffect(() => draw(editedCanvas.current, frame), [frame]);
  useLayoutEffect(() => draw(originalCanvas.current, original), [original]);
  const thumbnailCallback = useRef(onThumbnail);
  thumbnailCallback.current = onThumbnail;
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (!editedCanvas.current || !thumbnailCallback.current) return;
      const callback = thumbnailCallback.current;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 128 / frame.width, 96 / frame.height);
      canvas.width = Math.max(1, Math.round(frame.width * scale)); canvas.height = Math.max(1, Math.round(frame.height * scale));
      const context = canvas.getContext('2d'); if (!context) return;
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(editedCanvas.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (active && blob) callback(blob, frame.recipeKey); }, 'image/jpeg', 0.75);
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [frame]);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      const next = { width: bounds.width, height: bounds.height };
      setSize(next);
      const bounded = boundView(viewRef.current, next, Math.max(1, 4 * frame.outputWidth / (next.width || 1)));
      viewRef.current = bounded; setView(bounded);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame.outputWidth]);

  useEffect(() => {
    if (!client) return;
    const next = new LatestRenderer<{ recipe: Recipe; region: DetailRegion }, DetailFrame>(
      input => client.renderDetail(input.recipe, input.region),
      result => { setDetail(result); setDetailError(false); },
      () => { setDetail(undefined); setDetailError(true); },
    );
    scheduler.current = next;
    return () => { next.dispose(); };
  }, [client]);

  useEffect(() => {
    scheduler.current?.invalidate();
    setDetailError(false);
    if (!region || !detailEnabled || frame.recipeKey !== currentRecipeKey) { setDetail(undefined); return; }
    // Let a drag settle, then request only its latest visible rectangle.
    const timeout = window.setTimeout(() => scheduler.current?.request({ recipe, region }), 100);
    return () => { clearTimeout(timeout); scheduler.current?.invalidate(); };
  }, [client, detailEnabled, frame.recipeKey, currentRecipeKey, regionKey, retry]);

  function updateView(next: View) {
    const bounded = boundView(next, size, maxZoom);
    viewRef.current = bounded; setView(bounded);
  }
  function localPoint(clientX: number, clientY: number): Point {
    const bounds = viewport.current!.getBoundingClientRect();
    return { x: clientX - bounds.left - bounds.width / 2, y: clientY - bounds.top - bounds.height / 2 };
  }
  function zoomTo(zoom: number, anchor: Point = { x: 0, y: 0 }) {
    updateView(zoomAt(viewRef.current, zoom, anchor, size, maxZoom));
  }
  function compare(clientX: number) {
    const bounds = viewport.current!.getBoundingClientRect();
    if (bounds.width) onPositionChange(Math.round(Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100)) * 10) / 10);
  }
  function pinch() {
    const [a, b] = Array.from(pointers.current.values());
    return { center: localPoint((a.x + b.x) / 2, (a.y + b.y) / 2), distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  function endPointer(id: number) {
    if (!pointers.current.has(id)) return;
    pointers.current.delete(id);
    gesture.current = undefined;
    if (pointers.current.size === 1) gesture.current = { kind: 'pan', start: Array.from(pointers.current.values())[0], view: viewRef.current };
    setInteracting(pointers.current.size > 0);
  }

  // A non-passive listener makes wheel zoom local to the image. Ctrl/Cmd-wheel
  // remains browser zoom for accessibility; trackpad pinches use that shortcut.
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = event => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    zoomTo(viewRef.current.zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.003), localPoint(event.clientX, event.clientY));
  };
  useEffect(() => {
    const element = viewport.current!;
    const handler = (event: WheelEvent) => wheelHandler.current(event);
    element.addEventListener('wheel', handler, { passive: false });
    return () => element.removeEventListener('wheel', handler);
  }, []);

  const transform = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` };
  return <div class="image-viewer">
    <div ref={viewport} class="photo-frame comparison-preview" role="group" aria-label="Image zoom and pan" aria-describedby="zoom-help"
      tabIndex={zoomed ? 0 : -1} data-zoom={view.zoom} data-pan-x={view.x} data-pan-y={view.y}
      data-editing={revealForEdit} data-keyboard-focus={keyboardFocus} data-interacting={interacting} data-zoomed={zoomed}
      style={{ '--comparison': `${position}%`, '--image-ratio': frame.outputWidth / frame.outputHeight, '--source-width': `${frame.outputWidth}px` }}
      onPointerDown={event => {
        if (event.button !== 0 || pointers.current.size >= 2) return;
        const point = { x: event.clientX, y: event.clientY };
        pointers.current.set(event.pointerId, point);
        event.currentTarget.setPointerCapture(event.pointerId);
        setInteracting(true);
        if (pointers.current.size === 2) {
          const state = pinch();
          gesture.current = { kind: 'pinch', start: state.center, distance: state.distance, view: viewRef.current };
        } else if ((event.target as HTMLElement).closest('.comparison-interaction')) {
          gesture.current = { kind: 'compare' };
          divider.current?.focus({ preventScroll: true });
          if (event.pointerType !== 'touch') compare(event.clientX);
        } else {
          gesture.current = { kind: 'pan', start: point, view: viewRef.current };
          event.currentTarget.focus({ preventScroll: true });
        }
        setKeyboardFocus(false);
        event.preventDefault();
      }}
      onPointerMove={event => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const active = gesture.current;
        if (active?.kind === 'pinch' && pointers.current.size === 2) {
          const state = pinch();
          const next = zoomAt(active.view, active.view.zoom * state.distance / active.distance, active.start, size, maxZoom);
          updateView({ ...next, x: next.x + state.center.x - active.start.x, y: next.y + state.center.y - active.start.y });
        } else if (active?.kind === 'compare') compare(event.clientX);
        else if (active?.kind === 'pan') updateView({ ...active.view, x: active.view.x + event.clientX - active.start.x, y: active.view.y + event.clientY - active.start.y });
      }}
      onPointerUp={event => {
        if (!pointers.current.has(event.pointerId)) return;
        if (gesture.current?.kind === 'compare') compare(event.clientX);
        endPointer(event.pointerId);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => endPointer(event.pointerId)}
      onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) endPointer(event.pointerId); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
        const step = event.shiftKey ? 100 : 30;
        const next = { ...viewRef.current };
        if (event.key === 'ArrowLeft') next.x += step;
        else if (event.key === 'ArrowRight') next.x -= step;
        else if (event.key === 'ArrowUp') next.y += step;
        else if (event.key === 'ArrowDown') next.y -= step;
        else if (event.key === '+' || event.key === '=') { zoomTo(next.zoom * 1.5); event.preventDefault(); return; }
        else if (event.key === '-') { zoomTo(next.zoom / 1.5); event.preventDefault(); return; }
        else if (event.key === '0' || event.key === 'Home') { updateView(fitView()); event.preventDefault(); return; }
        else return;
        event.preventDefault(); updateView(next);
      }}>
      <div class="comparison-image" style={transform}>
        <canvas ref={editedCanvas} data-preview aria-label={`Edited preview of ${name}`}
          data-exposure={frame.exposure} data-recipe={frame.recipeKey} data-render-ms={frame.metrics.renderMs}
          data-output-width={frame.outputWidth} data-output-height={frame.outputHeight}
          data-wasm-bytes={metrics?.wasmMemoryBytes} data-retained-bytes={metrics?.retainedBytes} />
        {currentDetail && <DetailCanvas frame={currentDetail.edited} region={currentDetail.region} kind="edited" />}
      </div>
      <div class="comparison-original-layer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <div class="comparison-image" style={transform}>
          <canvas ref={originalCanvas} data-original aria-hidden="true" />
          {currentDetail && <DetailCanvas frame={currentDetail.original} region={currentDetail.region} kind="original" />}
        </div>
      </div>
      {position > 12 && <span class="comparison-label comparison-label-original" aria-hidden="true">Original</span>}
      {position < 88 && <span class="comparison-label comparison-label-edited" aria-hidden="true">Edited</span>}
      <span class="comparison-line" aria-hidden="true" />
      <div ref={divider} class="comparison-interaction" role="slider" tabIndex={0}
        aria-label="Before and after comparison" aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={position}
        aria-valuetext={`${Math.round(position)}% original, ${Math.round(100 - position)}% edited`}
        aria-describedby="comparison-help"
        onFocus={() => setKeyboardFocus(true)} onBlur={() => setKeyboardFocus(false)}
        onDblClick={() => onPositionChange(50)}
        onKeyDown={event => {
          setKeyboardFocus(true);
          const step = event.shiftKey ? 10 : 1;
          let next: number;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = position - step;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = position + step;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = 100;
          else return;
          event.preventDefault(); onPositionChange(Math.max(0, Math.min(100, next)));
        }}>
        <span class="comparison-handle" aria-hidden="true"><svg width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m7 6-4 4 4 4M15 6l4 4-4 4M11 4v12" /></svg></span>
      </div>
    </div>
    <div class="zoom-toolbar" role="group" aria-label="Zoom controls">
      <button class="button button-small button-quiet" aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomTo(view.zoom / 1.5)}>−</button>
      <output aria-label="Image zoom">{Math.round(fitScale * view.zoom * 100)}%</output>
      <button class="button button-small button-quiet" aria-label="Zoom in" disabled={view.zoom >= maxZoom - 0.00001} onClick={() => zoomTo(view.zoom * 1.5)}>+</button>
      <button class="button button-small button-quiet" title="One image pixel per screen CSS pixel" onClick={() => zoomTo(1 / fitScale)}>100%</button>
      <button class="button button-small button-quiet" disabled={!zoomed} onClick={() => updateView(fitView())}>Fit</button>
    </div>
    <span class="zoom-help" id="zoom-help">{zoomed ? 'Drag the photo to pan. Drag the divider to compare.' : 'Scroll or pinch to zoom. Drag to compare.'}<span class="sr-only"> When zoomed, focus the image and use arrow keys to pan, plus or minus to zoom, and 0 to fit. Scroll outside the image to move the page.</span></span>
    {detailError && zoomed && <span class="zoom-help" role="status">Detail could not load. <button class="text-button" onClick={() => setRetry(value => value + 1)}>Retry detail</button></span>}
    <span id="comparison-help" class="sr-only">Original on the left, edited on the right. Use arrow keys to move, Home for all edited, or End for all original. Double-click to center.</span>
  </div>;
}
