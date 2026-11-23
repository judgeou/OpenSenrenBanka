/** Crosses a browser frame after a real draw; hidden pages wake the owner without claiming presentation.
 * Native callbacks only resolve the owner's queued continuation, never touch story/UI/audio state. */
export class PaintBarrier {
  private closed = false; private readonly pending = new Set<(painted: boolean) => void>();
  private readonly hidden = () => { if (document.hidden) for (const wake of [...this.pending]) wake(false); };
  constructor() { document.addEventListener('visibilitychange', this.hidden); }
  wait(): Promise<boolean> {
    if (this.closed || document.hidden) return Promise.resolve(false);
    return new Promise(resolve => { let frame = 0;
      const finish = (painted: boolean) => { if (!this.pending.delete(finish)) return; cancelAnimationFrame(frame); resolve(painted); };
      this.pending.add(finish); frame = requestAnimationFrame(() => finish(!document.hidden && !this.closed)); });
  }
  close(): void { if (this.closed) return; this.closed = true; document.removeEventListener('visibilitychange', this.hidden); for (const wake of [...this.pending]) wake(false); }
}
