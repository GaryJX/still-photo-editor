import { wrap, type Remote } from 'comlink';
import type { EngineApi, DecodedPhoto, LoadedPhoto } from '../worker/types';
import type { Recipe } from './recipe';
import type { ExportOptions } from './encoding';
import type { LutAsset } from './cube';

/** Reject in-flight RPCs when a worker dies instead of leaving UI jobs pending. */
export class EngineClient {
  private worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
  private api: Remote<EngineApi> = wrap<EngineApi>(this.worker);
  private pending = new Set<(error: Error) => void>();
  private closed = false;

  constructor(private onFailure: (error: Error) => void) {
    this.worker.addEventListener('error', event => { event.preventDefault(); this.fail(new Error(event.message || 'The image processor stopped.')); });
    this.worker.addEventListener('messageerror', () => this.fail(new Error('The image processor could not return its result.')));
  }
  private run<T>(call: (api: Remote<EngineApi>) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The image processor is unavailable.'));
    return new Promise((resolve, reject) => {
      const abort = (error: Error) => reject(error);
      this.pending.add(abort);
      Promise.resolve().then(() => call(this.api)).then(resolve, reject).finally(() => this.pending.delete(abort));
    });
  }
  private fail(error: Error) { if (!this.closed) { this.dispose(); this.onFailure(error); } }
  dispose() {
    this.closed = true;
    this.worker.terminate();
    for (const reject of this.pending) reject(new Error('The image processor stopped.'));
    this.pending.clear();
  }
  ready() { return this.run(api => api.ready()).catch(error => { this.fail(error instanceof Error ? error : new Error(String(error))); throw error; }); }
  importLut(file: File) { return this.run(api => api.importLut(file)); }
  installLut(asset: LutAsset) { return this.run(api => api.installLut(asset)); }
  open(file: File) { return this.run<LoadedPhoto | 'decode-on-main'>(api => api.open(file)); }
  openDecoded(photo: DecodedPhoto) { return this.run(api => api.openDecoded(photo)); }
  render(recipe: Recipe, knownOriginalGeometry?: string) { return this.run(api => api.render(recipe, knownOriginalGeometry)); }
  exportImage(recipe: Recipe, options: ExportOptions) { return this.run(api => api.exportImage(recipe, options)); }
}
