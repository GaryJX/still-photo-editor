export interface HistorySnapshot<T> { current: T; past: T[]; future: T[] }

/** Snapshot history with one entry per completed gesture and bounded memory. */
export class EditHistory<T> {
  current: T;
  private past: T[] = [];
  private future: T[] = [];
  private start?: T;

  constructor(initial: T, private key: (value: T) => string, private limit = 100) {
    this.current = initial;
  }
  get canUndo() { return this.past.length > 0 || (this.start !== undefined && this.key(this.start) !== this.key(this.current)); }
  get canRedo() { return this.future.length > 0 && this.start === undefined; }
  begin() { if (this.start === undefined) this.start = this.current; }
  preview(next: T) { this.begin(); this.current = next; }
  commit() {
    if (this.start !== undefined && this.key(this.start) !== this.key(this.current)) {
      this.past.push(this.start);
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    this.start = undefined;
  }
  apply(next: T) { this.commit(); this.preview(next); this.commit(); }
  undo() {
    this.commit();
    if (!this.past.length) return;
    this.future.push(this.current);
    this.current = this.past.pop()!;
  }
  redo() {
    this.commit();
    if (!this.future.length) return;
    this.past.push(this.current);
    this.current = this.future.pop()!;
  }
  snapshot(): HistorySnapshot<T> {
    const pending = this.start !== undefined && this.key(this.start) !== this.key(this.current);
    return { current: this.current, past: (pending ? [...this.past, this.start!] : [...this.past]).slice(-this.limit), future: pending ? [] : [...this.future] };
  }
  restore(snapshot: HistorySnapshot<T>) {
    this.current = snapshot.current; this.past = snapshot.past.slice(-this.limit); this.future = snapshot.future.slice(-this.limit); this.start = undefined;
  }
  reset(next: T) { this.current = next; this.past = []; this.future = []; this.start = undefined; }
}
