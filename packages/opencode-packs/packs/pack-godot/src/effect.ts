// Activation scope for the Godot plugin effect lifecycle.
// Owns finalizers registered during one activation; dispose is idempotent
// and runs disposers once in reverse (LIFO) order.

export type Disposer = () => Promise<void> | void;

export class ActivationScope {
  private disposers: Disposer[] = [];
  private _disposed = false;
  private _disposing: Promise<void> | null = null;

  get disposed(): boolean {
    return this._disposed;
  }

  get size(): number {
    return this._disposed ? 0 : this.disposers.length;
  }

  register(fn: Disposer): () => Promise<void> {
    // Register-after-dispose: run immediately so callers never leak.
    if (this._disposed) {
      let result: Promise<void>;
      try {
        result = Promise.resolve().then(() => fn());
      } catch (err) {
        result = Promise.reject(err);
      }
      // Swallow here; caller may still await the returned handle.
      result = result.catch(() => undefined);
      return () => result;
    }
    this.disposers.push(fn);
    let removed = false;
    return async () => {
      if (removed) return;
      removed = true;
      const idx = this.disposers.lastIndexOf(fn);
      if (idx >= 0) this.disposers.splice(idx, 1);
    };
  }

  dispose(): Promise<void> {
    if (this._disposing) return this._disposing;
    this._disposing = (async () => {
      const pending = this.disposers.splice(0).reverse();
      for (const fn of pending) {
        try {
          await fn();
        } catch {
          // Continue: one failing finalizer must not block the rest.
        }
      }
      this._disposed = true;
    })();
    return this._disposing;
  }
}
