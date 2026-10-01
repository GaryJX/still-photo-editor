import { describe, it, expect } from 'vitest';
import { EditHistory } from './history';

describe('edit history', () => {
  it('groups a gesture, skips no-ops, and restores redo', () => {
    const history = new EditHistory<number>(0, String);
    history.preview(1); history.preview(2); history.preview(3); history.commit();
    history.undo(); expect(history.current).toBe(0); expect(history.canUndo).toBe(false);
    history.redo(); expect(history.current).toBe(3);
    history.apply(3); history.undo(); expect(history.current).toBe(0);
  });
  it('invalidates redo after a new edit, supports undo during a gesture, and bounds history', () => {
    const history = new EditHistory<number>(0, String, 2);
    history.apply(1); history.apply(2); history.apply(3);
    history.undo(); history.undo(); history.undo(); expect(history.current).toBe(1);
    history.preview(4); history.undo(); expect(history.current).toBe(1);
    history.apply(5); expect(history.canRedo).toBe(false);
    history.reset(0); expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false);
  });
});

describe('saved history', () => {
  it('recovers an interrupted gesture as one undo step without mutating the live history', () => {
    const live = new EditHistory<number>(0, String);
    live.apply(1); live.preview(2); live.preview(3);
    const restored = new EditHistory<number>(0, String); restored.restore(live.snapshot());
    restored.undo(); expect(restored.current).toBe(1);
    restored.redo(); expect(restored.current).toBe(3);
    live.preview(4); live.commit(); live.undo(); expect(live.current).toBe(1);
    restored.undo(); restored.undo(); expect(restored.current).toBe(0);
  });
});
