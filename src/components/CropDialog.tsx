import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { NumberInput } from './NumberInput';
import { centeredCrop, fullCrop, type Crop } from '../editor/geometry';
import type { Frame } from '../worker/types';

const MINIMUM = 0.0025;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function bounded(crop: Crop): Crop {
  const x = clamp(crop.x, 0, 1 - MINIMUM), y = clamp(crop.y, 0, 1 - MINIMUM);
  return { x, y, width: clamp(crop.width, MINIMUM, 1 - x), height: clamp(crop.height, MINIMUM, 1 - y) };
}
type Drag = { pointerId: number; mode: string; x: number; y: number; crop: Crop };

export function CropDialog({ frame, initial, onApply, onCancel }: { frame: Frame; initial: Crop; onApply: (crop: Crop) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [crop, setCrop] = useState(initial);
  const [aspect, setAspect] = useState('free');
  const ratio = aspect === 'free' ? undefined : Number(aspect) * frame.outputHeight / frame.outputWidth;

  useLayoutEffect(() => {
    const context = canvas.current!.getContext('2d', { colorSpace: 'srgb' })!;
    canvas.current!.width = frame.width; canvas.current!.height = frame.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.buffer as ArrayBuffer), frame.width, frame.height), 0, 0);
    dialog.current!.showModal();
    return () => dialog.current?.close();
  }, [frame]);

  function position(event: PointerEvent, element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
  }
  function move(event: PointerEvent, element: HTMLElement) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = position(event, element);
    const original = gesture.crop;
    if (gesture.mode === 'move') {
      setCrop({ ...original, x: clamp(original.x + point.x - gesture.x, 0, 1 - original.width), y: clamp(original.y + point.y - gesture.y, 0, 1 - original.height) });
      return;
    }
    const west = gesture.mode.includes('w'), north = gesture.mode.includes('n');
    const anchorX = west ? original.x + original.width : original.x;
    const anchorY = north ? original.y + original.height : original.y;
    let width = clamp((point.x - anchorX) * (west ? -1 : 1), MINIMUM, west ? anchorX : 1 - anchorX);
    let height = clamp((point.y - anchorY) * (north ? -1 : 1), MINIMUM, north ? anchorY : 1 - anchorY);
    if (ratio) {
      width = Math.min(Math.max(width, height * ratio), west ? anchorX : 1 - anchorX, (north ? anchorY : 1 - anchorY) * ratio);
      height = width / ratio;
    }
    setCrop(bounded({ x: west ? anchorX - width : anchorX, y: north ? anchorY - height : anchorY, width, height }));
  }

  return <dialog ref={dialog} class="crop-dialog" aria-labelledby="crop-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div class="dialog-heading"><div><span class="eyebrow">Find your frame</span><h2 id="crop-title">Crop photo</h2></div><button class="icon-button" aria-label="Cancel crop" onClick={onCancel}>✕</button></div>
    <div class="crop-options"><label>Aspect ratio <select aria-label="Crop aspect ratio" value={aspect} onChange={event => { const value = event.currentTarget.value; setAspect(value); if (value !== 'free') setCrop(centeredCrop(frame.outputWidth, frame.outputHeight, Number(value))); }}><option value="free">Free</option><option value="1">Square · 1:1</option><option value={4 / 3}>Landscape · 4:3</option><option value={3 / 2}>Photo · 3:2</option><option value={16 / 9}>Wide · 16:9</option><option value={4 / 5}>Portrait · 4:5</option><option value={9 / 16}>Tall · 9:16</option></select></label><button class="text-button" onClick={() => { setCrop(fullCrop()); setAspect('free'); }}>Use full image</button></div>
    <div class="crop-workspace"><div class="crop-preview"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        const target = event.target as Element;
        if (!target.closest('.crop-selection')) return;
        const point = position(event, event.currentTarget);
        drag.current = { pointerId: event.pointerId, mode: target.closest('[data-handle]')?.getAttribute('data-handle') ?? 'move', ...point, crop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => move(event, event.currentTarget)}
      onPointerUp={event => { move(event, event.currentTarget); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <canvas ref={canvas} aria-label="Uncropped image for framing" />
      <div class="crop-selection" role="group" aria-label="Crop selection" tabIndex={0} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const step = event.shiftKey ? 0.05 : 0.01;
          setCrop({ ...crop, x: clamp(crop.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1 - crop.width), y: clamp(crop.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), 0, 1 - crop.height) });
        }}>
        <span class="crop-grid" aria-hidden="true" />
        {(['nw', 'ne', 'sw', 'se'] as const).map(corner => <span key={corner} class={`crop-handle crop-${corner}`} data-handle={corner} aria-hidden="true" />)}
      </div>
    </div></div>
    <p class="curve-help">Drag the corners to resize, or drag inside to move. Arrow keys move a focused selection.</p>
    <details class="crop-fine"><summary>Fine tune</summary><div>{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} (%)<NumberInput label={`Crop ${key} percent`} min={0} max={100} step={0.1} disabled={!!ratio && (key === 'width' || key === 'height')} value={Math.round(crop[key] * 10000) / 100} onCommit={value => setCrop(bounded({ ...crop, [key]: value / 100 }))} /></label>)}</div></details>
    <div class="dialog-footer"><span>{Math.max(1, Math.round(crop.width * frame.outputWidth)).toLocaleString()} × {Math.max(1, Math.round(crop.height * frame.outputHeight)).toLocaleString()} px</span><div><button class="button button-quiet" onClick={onCancel}>Cancel</button><button class="button button-primary" onClick={() => onApply(crop)}>Apply crop</button></div></div>
  </dialog>;
}
