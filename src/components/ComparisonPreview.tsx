import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Frame, RenderMetrics } from '../worker/types';

function draw(canvas: HTMLCanvasElement | null, frame: Frame) {
  const context = canvas?.getContext('2d', { colorSpace: 'srgb' });
  if (!canvas || !context) return;
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.buffer as ArrayBuffer), frame.width, frame.height), 0, 0);
}

export function ComparisonPreview({ frame, original, name, metrics, position, onPositionChange }: {
  frame: Frame; original: Frame; name: string; metrics?: RenderMetrics;
  position: number; onPositionChange: (position: number) => void;
}) {
  const editedCanvas = useRef<HTMLCanvasElement>(null);
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);

  useLayoutEffect(() => draw(editedCanvas.current, frame), [frame]);
  useLayoutEffect(() => draw(originalCanvas.current, original), [original]);

  function move(clientX: number, element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width) return;
    onPositionChange(Math.round(Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100)) * 10) / 10);
  }

  return <div class="photo-frame comparison-preview" style={{ '--comparison': `${position}%` }}>
    <canvas ref={editedCanvas} data-preview aria-label={`Edited preview of ${name}`}
      data-exposure={frame.exposure} data-recipe={frame.recipeKey} data-render-ms={frame.metrics.renderMs}
      data-wasm-bytes={metrics?.wasmMemoryBytes} data-retained-bytes={metrics?.retainedBytes}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }} />
    <div class="comparison-original-layer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
      <canvas ref={originalCanvas} data-original aria-hidden="true" />
    </div>
    {position > 12 && <span class="comparison-label comparison-label-original" aria-hidden="true">Original</span>}
    {position < 88 && <span class="comparison-label comparison-label-edited" aria-hidden="true">Edited</span>}
    <div class="comparison-interaction" role="slider" tabIndex={0}
      aria-label="Before and after comparison" aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={position}
      aria-valuetext={`${Math.round(position)}% original, ${Math.round(100 - position)}% edited`}
      aria-describedby="comparison-help"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        activePointer.current = event.pointerId;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientX, event.currentTarget);
      }}
      onPointerMove={event => { if (activePointer.current === event.pointerId) move(event.clientX, event.currentTarget); }}
      onPointerUp={event => {
        if (activePointer.current !== event.pointerId) return;
        move(event.clientX, event.currentTarget);
        activePointer.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { activePointer.current = null; }}
      onLostPointerCapture={() => { activePointer.current = null; }}
      onDblClick={() => onPositionChange(50)}
      onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        let next: number;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = position - step;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = position + step;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 100;
        else return;
        event.preventDefault();
        onPositionChange(Math.max(0, Math.min(100, next)));
      }}>
      <span class="comparison-line" aria-hidden="true" />
      <span class="comparison-handle" aria-hidden="true"><svg width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m7 6-4 4 4 4M15 6l4 4-4 4M11 4v12" /></svg></span>
    </div>
    <span id="comparison-help" class="sr-only">Drag to compare. Original on the left, edited on the right. Use arrow keys to move, Home for all edited, or End for all original. Double-click to center.</span>
  </div>;
}
