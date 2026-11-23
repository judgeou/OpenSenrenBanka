import type { CommandBlock } from './types.ts';
/** Extra blocks produced by deferred commands while another story wait already exists.
 * Owned by ScenePlayer; external completion arrives only through the session queue. */
export class HostBlocks {
  private readonly pending = new Map<string, boolean>();
  get blocked(): boolean { return this.pending.size !== 0; }
  add(block: CommandBlock): void {
    if (!block || typeof block.interruptible !== 'boolean' || !Array.isArray(block.tokens) || block.tokens.length > 100000) throw new Error('Invalid deferred host wait');
    const seen = new Set<string>();
    for (const token of block.tokens) {
      if (typeof token !== 'string' || !token || seen.has(token) || this.pending.has(token)) throw new Error('Duplicate/invalid host wait owner');
      seen.add(token);
    }
    if (seen.size + this.pending.size > 100000) throw new Error('Host wait budget exceeded');
    for (const token of seen) this.pending.set(token, block.interruptible);
  }
  complete(token: string): void { this.pending.delete(token); }
  take(interruptibleOnly = false): string[] {
    const result: string[] = [];
    for (const [token, interruptible] of this.pending) if (!interruptibleOnly || interruptible) { result.push(token); this.pending.delete(token); }
    return result;
  }
  capture(): readonly CommandBlock[] { return [...this.pending].map(([token, interruptible]) => ({ tokens: [token], interruptible })); }
  restore(blocks: readonly CommandBlock[]): void {
    if (!Array.isArray(blocks) || blocks.length > 100000) throw new Error('Invalid saved host waits');
    const rebuilt = new HostBlocks(); for (const block of blocks) rebuilt.add(block);
    this.pending.clear(); for (const [token, value] of rebuilt.pending) this.pending.set(token, value);
  }
}
