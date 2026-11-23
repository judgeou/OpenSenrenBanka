import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { CommandBlock } from '../src/runtime/types.ts';
import { sessionData } from './session-data.ts';
export type SessionWait =
  | { readonly kind: 'time'; readonly until: number }
  | { readonly kind: 'reveal'; readonly key: string }
  | { readonly kind: 'voice'; readonly channel: string; readonly playbackToken: string }
  | { readonly kind: 'screen'; readonly generation: number }
  | { readonly kind:'op'; readonly token:number }
  | { readonly kind: 'world'; readonly name: string; readonly mode: 0 | 1 | 2 };
export interface SessionWaitPort { ready(wait: SessionWait): boolean; cancel(wait: SessionWait): Promise<void> }
function string(value: PsbValue | undefined): string {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Invalid saved wait identity'); return value;
}
function parseWait(value: PsbValue): SessionWait {
  const row = psbRecord(value);
  if (row.kind === 'reveal') return { kind: 'reveal', key: string(row.key) };
  if (row.kind === 'voice') return { kind: 'voice', channel: string(row.channel), playbackToken: string(row.playbackToken) };
  if (row.kind === 'time' && typeof row.until === 'number' && Number.isFinite(row.until) && row.until >= 0) return { kind: 'time', until: row.until };
  if (row.kind === 'screen' && typeof row.generation === 'number' && Number.isSafeInteger(row.generation) && row.generation >= 0) return { kind: 'screen', generation: row.generation };
  if (row.kind === 'world' && (row.mode === 0 || row.mode === 1 || row.mode === 2)) return { kind: 'world', name: string(row.name), mode: row.mode };
  throw new Error('Unknown/malformed saved session wait');
}
/** Only the session loop polls/completes waits. Native callbacks never call notify.
 * Already-ready conditions produce no block; new tokens are polled only AFTER the
 * caller registered its returned ticket/block with ScenePlayer. This ordering also
 * handles native completion before a waiter is registered, without lost signals. */
export class SessionWaits {
  private pending = new Map<string, SessionWait>();
  private serial = 0;
  private epoch = 0;
  constructor(private readonly owner: string, private readonly port: SessionWaitPort) {
    if (!owner || owner.length > 256) throw new Error('Invalid session wait owner');
  }
  get generation(): number { return this.epoch; }
  get count(): number { return this.pending.size; }
  add(wait: SessionWait): string {
    if (this.pending.size >= 100000 || !Number.isSafeInteger(this.serial + 1)) throw new Error('Session wait budget exhausted');
    const token = 'wait/' + this.owner + '/' + this.epoch + '/' + ++this.serial;
    this.pending.set(token, Object.freeze({ ...wait })); return token;
  }
  block(waits: readonly SessionWait[], interruptible: boolean): CommandBlock | undefined {
    const tokens = waits.filter(wait => !this.port.ready(wait)).map(wait => this.add(wait));
    return tokens.length ? { tokens, interruptible } : undefined;
  }
  get nextTime(): number {
    let at = Infinity; for (const w of this.pending.values()) if (w.kind === 'time') at = Math.min(at, w.until); return at;
  }
  get hasWorldWait(): boolean { for (const w of this.pending.values()) if (w.kind === 'world' || w.kind === 'screen') return true; return false; }
  find(token: string): SessionWait | undefined { return this.pending.get(token); }
  findToken(test: (wait: SessionWait) => boolean): string | undefined { for (const [token, wait] of this.pending) if (test(wait)) return token; return undefined; }
  poll(notify: (token: string) => void): boolean {
    let released = false;
    for (const [token, wait] of this.pending) if (this.port.ready(wait)) { this.pending.delete(token); notify(token); released = true; }
    return released;
  }
  async cancel(tokens: readonly string[]): Promise<void> {
    if (tokens.length > 100000) throw new Error('Wait cancellation budget exceeded');
    for (const token of new Set(tokens)) {
      const wait = this.pending.get(token); if (!wait) continue;
      this.pending.delete(token); await this.port.cancel(wait);
    }
  }
  /** Clear invalidates all captured external generations; no callback is rebound by token alone. */
  clear(): void { if (!Number.isSafeInteger(this.epoch + 1)) throw new Error('Session wait generation exhausted'); this.epoch++; this.pending.clear(); }
  capture(): PsbValue { if([...this.pending.values()].some(w=>w.kind==='op'))throw Error('原片头播放期间不能保存'); return sessionData({ schemaVersion: 1n, serial: this.serial, waits: [...this.pending].map(([token, wait]) => ({ token, wait })) }); }
  restore(value: PsbValue): void {
    const row = psbRecord(value);
    if (row.schemaVersion !== 1n || typeof row.serial !== 'number' || !Number.isSafeInteger(row.serial) || row.serial < 0 || !Array.isArray(row.waits) || row.waits.length > 100000) throw new Error('Invalid session wait snapshot');
    const rebuilt = new Map<string, SessionWait>();
    for (const item of row.waits) { const entry = psbRecord(item), token = string(entry.token); if (rebuilt.has(token)) throw new Error('Duplicate saved waiter'); rebuilt.set(token, parseWait(entry.wait)); }
    this.clear(); this.pending = rebuilt; this.serial = Math.max(this.serial, row.serial);
  }
  validate(tokens: readonly string[]): void {
    const expected = new Set(tokens);
    if (expected.size !== tokens.length || expected.size !== this.pending.size || [...expected].some(token => !this.pending.has(token))) throw new Error('Player and host saved wait ownership differs');
  }
}
