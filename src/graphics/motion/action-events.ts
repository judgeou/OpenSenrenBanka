import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import { MotionActionRegistry } from './action-registry.ts';
import {allowsMotionCue,rootMotionCue} from './se-profiles.ts';
import type {RootMotionCue,MotionCueId} from './se-profiles.ts';
import type {NestedSeKey} from './nested-se-profile.ts';
import type {NativeMotionActionProfile} from '../native-frame-stage.ts';

export const SD002BA_ACTION_PROFILE = 'sd002ba-se001-v1' as const;
export interface NativeMotionActionEvent {
  readonly deliveryId: number;
  readonly sourceId: number;
  readonly playSerial: 1;
  /** Future callback ordinal; committed dispatch count changes only on ack. */
  readonly actionOrdinal: number;
  readonly model: RootMotionCue['model']; readonly object: RootMotionCue['object']; readonly motion: RootMotionCue['motion'];
  readonly label: 'se'; readonly action: RootMotionCue['action'] | NestedSeKey['action'];
  readonly trackId: number; readonly frameSourceRef: number; readonly contentSourceRef: number;
  readonly now: number;
}
/** Frozen graph query data only; no source, frame, collector or app handles. */
export interface NativeMotionActionOwner {
  readonly profile: MotionCueId;
  readonly sourceId: number; readonly playSerial: 1;
  readonly ownerId: string; readonly ownerName: string;
  readonly dispatched: number;
  readonly label: 'se'; readonly action: RootMotionCue['action']; readonly actionOrdinal: 1;
}
export type MotionActionDraft = Omit<NativeMotionActionEvent, 'deliveryId'>;
function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid motion action ' + label);
  return value;
}
function draft(value: MotionActionDraft,profile:NativeMotionActionProfile): void {
  const cue=rootMotionCue(value.object,value.motion);
  integer(value.sourceId,'source');integer(value.actionOrdinal,'ordinal');
  if(!allowsMotionCue(profile,cue)||value.playSerial!==1||value.model!==cue.model||value.label!=='se'||!Number.isFinite(value.now)||value.now<0)throw Error('Motion action is outside its authored root');
  const match=(k:{action:string;trackId:number;frameSourceRef:number;contentSourceRef:number})=>value.action===k.action&&value.trackId===k.trackId&&value.frameSourceRef===k.frameSourceRef&&value.contentSourceRef===k.contentSourceRef;
  if('timeline' in cue ? !cue.timeline.keys.some(match) : value.actionOrdinal!==1||!match(cue))throw Error('Motion action is outside its authored slots');
}
/** Pure data only. One collector per graphics runtime, never a task/clock/audio queue.
 * Source scan reserves capacity BEFORE progress. Append follows its completed
 * layer/post-update boundary. Retirement does not discard pending responsibility.
 */
export class MotionActionOutbox {
  constructor(private readonly profile:NativeMotionActionProfile=SD002BA_ACTION_PROFILE) {}
  readonly sources = new MotionActionRegistry();
  private serial = 0;
  private acked = 0;
  private records: NativeMotionActionEvent[] = [];
  private faulted = false;
  static readonly capacity = 32;
  preflight(count = 1): void {
    if (this.faulted || !Number.isSafeInteger(count) || count < 0 || this.records.length + count > MotionActionOutbox.capacity || this.serial > Number.MAX_SAFE_INTEGER - count) throw new Error('Motion action outbox is faulted or exceeds its finite budget');
  }
  /** A usable frame/save boundary, distinct from pure restore inspection. */
  preflightUse(): void {
    this.preflight(0);
    if (this.records.length) throw new Error('Motion action delivery is still pending');
    this.sources.preflightUse(this.acked);
  }
  append(value: MotionActionDraft): NativeMotionActionEvent {
    draft(value,this.profile); this.preflight();
    // A sample play has only one act. The source separately owns its scan cursor;
    // this guard also rejects duplicate still-pending appends.
    if (this.records.some(record => record.sourceId === value.sourceId && record.playSerial === value.playSerial)) throw new Error('Duplicate pending SD002BA action');
    const record = Object.freeze({ ...value, deliveryId: ++this.serial });
    this.records.push(record); return record;
  }
  peek(): NativeMotionActionEvent | undefined { return this.records[0]; }
  ack(deliveryId: number): void {
    integer(deliveryId, 'delivery');
    if (this.faulted || this.records[0]?.deliveryId !== deliveryId || deliveryId !== this.acked + 1) throw new Error('Motion action acknowledgement is not the exact live head');
    this.records.shift(); this.acked = deliveryId;
  }
  fault(): void { this.faulted = true; }
  capture(): PsbValue {
    if (this.faulted) throw new Error('Cannot save partially failed motion action delivery');
    return { schemaVersion: 2n, profile: this.profile, serial: this.serial, acked: this.acked, records: this.records.map(record => ({ ...record })), registry: this.sources.capture() };
  }
  /** Validate all data before replacing; no source progress, callback or sound. */
  preflightRestore(value: PsbValue): void { this.saved(value); }
  restore(value: PsbValue): void {
    const { serial, acked, records, registry } = this.saved(value);
    this.sources.restore(registry, acked);
    this.records = records; this.serial = serial; this.acked = acked; this.faulted = false;
  }
  private saved(value: PsbValue): { serial: number; acked: number; records: NativeMotionActionEvent[]; registry: PsbValue } {
    if (this.faulted || this.serial !== 0 || this.records.length) throw new Error('Motion outbox restore requires a fresh collector');
    const row = psbRecord(value), serial = row.serial, acked = row.acked;
    if (row.schemaVersion !== 2n || row.profile !== this.profile || typeof serial !== 'number' || !Number.isSafeInteger(serial) || serial < 0 || typeof acked !== 'number' || !Number.isSafeInteger(acked) || acked < 0 || acked > serial || !Array.isArray(row.records) || row.records.length > MotionActionOutbox.capacity || row.records.length !== serial - acked) throw new Error('Invalid saved motion outbox');
    const records: NativeMotionActionEvent[] = [], sources = new Set<number>();
    for (const item of row.records) {
      const saved = psbRecord(item), record = { ...saved } as unknown as NativeMotionActionEvent;
      draft(record,this.profile);
      if (record.deliveryId !== acked + records.length + 1 || sources.has(record.sourceId)) throw new Error('Invalid saved motion action order/source');
      sources.add(record.sourceId); records.push(Object.freeze(record));
    }
    this.sources.preflightRestore(row.registry, acked);
    return { serial, acked, records, registry: row.registry };
  }
}
/** Implemented only by a fully decoded finite source. Merely having this port is
 * NOT activation: the concrete decoder still needs the explicitly installed
 * capability; the current app must not install it before its consumer/guards.
 */
export interface NativeMotionActionPort {
  readonly profile: MotionCueId;
  readonly sourceId: number;
  readonly playSerial: 1;
  readonly outbox: MotionActionOutbox;
  /** Live state, scan headroom, speed/profile, no borrow/override; pure read. */
  preflight(ownerId: string): void;
  /** Pure committed count only. Source wrapper requires a live paired collector. */
  completedActions(): number;
  /** Detach the published event owner; independent of a transition's pixel lease. */
  retire?(): void;
  /** Commit completed-delivery cursor. App increments _actionCount at callback
   * entry before effects; a partial failure faults instead of saving/retrying. */
  ack(deliveryId: number): void;
}
