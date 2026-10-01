/** One running job and one replaceable pending job. A newer request makes any
 * in-flight result obsolete, without trying to interrupt synchronous WASM. */
export class LatestRenderer<Input, Output> {
  private revision = 0;
  private pending?: { input: Input; revision: number };
  private running = false;
  private disposed = false;

  constructor(
    private render: (input: Input) => Promise<Output>,
    private present: (output: Output) => void,
    private fail: (error: unknown) => void,
  ) {}

  request(input: Input) {
    if (this.disposed) return;
    this.pending = { input, revision: ++this.revision };
    void this.drain();
  }

  invalidate() {
    this.revision++;
    this.pending = undefined;
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
  }

  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const job = this.pending;
        this.pending = undefined;
        try {
          const output = await this.render(job.input);
          if (!this.disposed && job.revision === this.revision) this.present(output);
        } catch (error) {
          if (!this.disposed && job.revision === this.revision) this.fail(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
