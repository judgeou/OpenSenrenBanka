import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid saved motion source identity');
  return value;
}
const keys = ['schemaVersion', 'profile', 'sourceId', 'playSerial', 'initialized', 'lastFrame', 'lastCounter', 'activeSlot', 'enqueued', 'dispatched'] as const;
/** Concrete live SD002BA cursor providers only. No callbacks are dispatched here;
 * the provider is a pure source capture closure, never app/script event code.
 */
export class MotionActionRegistry {
  private serial = 0;
  private readonly live = new Map<number, () => PsbValue>();
  private readonly awaitingRestore = new Set<number>();
  reserve(savedId?: number): number {
    if (this.live.size) throw new Error('The first motion action profile supports only one live root');
    if (savedId !== undefined) { id(savedId); this.serial = Math.max(this.serial, savedId); return savedId; }
    if (this.serial >= Number.MAX_SAFE_INTEGER) throw new Error('Motion source identity budget exhausted');
    return ++this.serial;
  }
  register(sourceId: number, capture: () => PsbValue, restored = false): void {
    id(sourceId);
    if (sourceId > this.serial || this.live.size || this.live.has(sourceId)) throw new Error('Motion source identity is not a unique reserved root');
    this.live.set(sourceId, capture); if (restored) this.awaitingRestore.add(sourceId);
  }
  remove(sourceId: number): void { this.live.delete(sourceId); this.awaitingRestore.delete(sourceId); }
  preflightUse(acked: number): void {
    if (this.awaitingRestore.size) throw new Error('Restored v9 source is waiting for its collector snapshot');
    for (const capture of this.live.values()) if (Number(psbRecord(capture()).dispatched) > acked) throw new Error('Source dispatch cursor is ahead of its collector');
  }
  ids(): readonly number[] { return [...this.live.keys()]; }
  capture(): PsbValue {
    return { schemaVersion: 1n, serial: this.serial, sources: [...this.live].map(([sourceId, capture]) => ({ sourceId, cursor: capture() })) };
  }
  preflightRestore(value: PsbValue, acked: number): void {
    const row = psbRecord(value);
    if (row.schemaVersion !== 1n || typeof row.serial !== 'number' || !Number.isSafeInteger(row.serial) || row.serial < this.serial || !Array.isArray(row.sources) || row.sources.length !== this.live.size || row.sources.length > 1) throw new Error('Saved motion source registry differs from rebuilt v9 sources');
    const seen = new Set<number>();
    for (const raw of row.sources) {
      const item = psbRecord(raw), sourceId = id(item.sourceId), capture = this.live.get(sourceId);
      if (sourceId > row.serial || seen.has(sourceId) || !capture) throw new Error('Saved collector references an absent/duplicate v9 source');
      seen.add(sourceId);
      const saved = psbRecord(item.cursor), current = psbRecord(capture());
      if (Number(current.dispatched) > acked || keys.some(key => saved[key] !== current[key]) || !Array.isArray(saved.slots) || !Array.isArray(current.slots) || saved.slots.length !== 2 || current.slots.length !== 2 || saved.slots.some((slot, index) => slot !== (current.slots as PsbValue[])[index])) throw new Error('Collector/source scan or dispatch cursor mismatch');
    }
  }
  restore(value: PsbValue, acked: number): void {
    this.preflightRestore(value, acked); this.serial = Number(psbRecord(value).serial); this.awaitingRestore.clear();
  }
}
