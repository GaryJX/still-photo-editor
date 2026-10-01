import { describe, expect, it } from 'vitest';
import { LatestRenderer } from './scheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

describe('preview scheduling', () => {
  it('skips intermediate requests and never presents an obsolete result', async () => {
    const jobs = [deferred<number>(), deferred<number>()];
    const rendered: number[] = [];
    const shown: number[] = [];
    const scheduler = new LatestRenderer<number, number>(
      (value) => { rendered.push(value); return jobs[rendered.length - 1].promise; },
      (value) => shown.push(value),
      () => { throw new Error('Unexpected failure'); },
    );
    scheduler.request(1);
    scheduler.request(2);
    scheduler.request(3);
    jobs[0].resolve(1);
    await Promise.resolve();
    expect(rendered).toEqual([1, 3]);
    expect(shown).toEqual([]);
    jobs[1].resolve(3);
    await Promise.resolve();
    expect(shown).toEqual([3]);
  });

  it('invalidates work when replacing a photo and recovers after failure', async () => {
    const old = deferred<number>();
    const shown: number[] = [];
    const errors: unknown[] = [];
    const scheduler = new LatestRenderer<number, number>(
      (n) => n === 1 ? old.promise : n === 2 ? Promise.reject('failure') : Promise.resolve(n),
      (n) => shown.push(n), (e) => errors.push(e),
    );
    scheduler.request(1);
    scheduler.invalidate();
    old.resolve(1);
    await Promise.resolve();
    expect(shown).toEqual([]);
    scheduler.request(2);
    await Promise.resolve();
    expect(errors).toEqual(['failure']);
    scheduler.request(3);
    await Promise.resolve();
    expect(shown).toEqual([3]);
    scheduler.dispose();
    scheduler.request(4);
    await Promise.resolve();
    expect(shown).toEqual([3]);
  });
});
