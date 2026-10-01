import { useEffect, useRef, useState } from 'preact/hooks';

/** Presentation only: keep comparison visible through a gesture and its idle tail. */
export function useComparisonActivity() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef(false);
  const pointer = useRef<number | null>(null);

  function change(ongoing = false) {
    clearTimeout(timer.current);
    gesture.current = ongoing || pointer.current !== null;
    setVisible(true);
    if (!gesture.current) timer.current = setTimeout(() => setVisible(false), 1000);
  }
  function finish() {
    if (gesture.current && pointer.current === null) change();
  }
  function reset() {
    clearTimeout(timer.current);
    gesture.current = false;
    pointer.current = null;
    setVisible(false);
  }

  useEffect(() => {
    // Native range inputs can emit "change" before pointer release. Track the
    // actual pointer separately from history commits so a held drag stays visible.
    function start(event: PointerEvent) {
      if (event.button === 0 && event.isPrimary && event.target instanceof Element && event.target.closest('.controls input[type="range"], .controls .curve-plot')) pointer.current = event.pointerId;
    }
    function end(event: PointerEvent) {
      if (pointer.current === event.pointerId) { pointer.current = null; finish(); }
    }
    function blur() { pointer.current = null; finish(); }
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', blur);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return { visible, change, finish, reset };
}
