import { psbRecord, psbValue } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import type { MtnProgram } from '../mtn-program.ts';
import { validateCounter } from './native-counter.ts';
import type { NativeCounterState } from './native-counter.ts';
import { MotionActionOutbox } from './action-events.ts';
import {motionCue} from './se-profiles.ts';
import type {MotionCue,MotionCueId} from './se-profiles.ts';
import type { MotionActionDraft, NativeMotionActionPort } from './action-events.ts';

function numericEquals(value: PsbValue | undefined, expected: number): boolean {
  return (typeof value === 'number' || typeof value === 'bigint') && Number(value) === expected;
}
function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid SD002BA cursor ' + name);
  return value;
}
/** Validate the actual existing IR, not a filename-only event acceptance. This
 * proves only this act track; it does NOT approve layout/other nodes/textures.
 */
export function motionSeActionDefinition(document: MtnDocument, program: MtnProgram, cue:MotionCue): Omit<MotionActionDraft, 'sourceId' | 'now'> {
  if (document.name.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() !== cue.model.toLowerCase() || program.objectName !== cue.object || program.motionName !== cue.motion || program.sourceRef !== cue.rootRef || program.lastTime !== cue.lastTime || program.loopTime?.kind !== 'integer' || program.loopTime.nativeValue !== -1n) throw new Error('Original motion SE act profile identity mismatch');
  const field = (ref: number, name: string) => { const at = document.reader.property(ref, name); return at === undefined ? undefined : psbValue(document.reader, at); };
  const tag = field(program.sourceRef, 'tag');
  if (!Array.isArray(tag) || tag.length) throw new Error('Original motion SE act profile forbids top-level tags');
  const track = program.tracks[cue.trackId];
  if (!track || track.id !== cue.trackId || track.sourceRef !== cue.trackRef || track.label !== 'se' || track.parent !== undefined || track.children.length || !numericEquals(field(track.sourceRef, 'type'), 2) || track.frames.length !== 4) throw new Error('Original motion SE act track identity/topology mismatch');
  for (let index = 0; index < track.frames.length; index++) {
    const frame = track.frames[index];
    if (frame.time !== cue.times[index] || frame.type !== (index === 1 ? 2 : 0)) throw new Error('Original motion SE act slots differ from the finite native profile');
    if (index !== 1) {
      if (frame.contentRef !== undefined && psbValue(document.reader, frame.contentRef) !== null) throw new Error('Original motion SE blank act slot has content');
      continue;
    }
    if (frame.sourceRef !== cue.frameSourceRef || frame.contentRef !== cue.contentSourceRef) throw new Error('Original motion SE act frame references differ');
    const content = psbRecord(psbValue(document.reader, frame.contentRef));
    if (Object.keys(content).some(key => !['act', 'mask', 'ox', 'oy', 'src'].includes(key)) || content.act !== cue.action || content.src !== 'layout' || !numericEquals(content.mask, 262145) || !numericEquals(content.ox, 0) || !numericEquals(content.oy, 0)) throw new Error('Original motion SE act content differs');
  }
  for (const other of program.tracks) for (const frame of other.frames) {
    if (other.id === cue.trackId || frame.contentRef === undefined) continue;
    const value = psbValue(document.reader, frame.contentRef); if (value === null) continue;
    const content = psbRecord(value), mask = content.mask;
    if ('act' in content || (typeof mask === 'number' || typeof mask === 'bigint') && (Number(mask) & 0x40000)) throw new Error('Original motion SE finite cursor cannot skip another root act');
  }
  return { model:cue.model,object:cue.object,motion:cue.motion,label:'se',action:cue.action,trackId:cue.trackId,frameSourceRef:cue.frameSourceRef,contentSourceRef:cue.contentSourceRef, playSerial: 1, actionOrdinal: 1 };
}
export function sd002baActionDefinition(document:MtnDocument,program:MtnProgram) {
  return motionSeActionDefinition(document,program,motionCue('SD002','SD002BA')!);
}
/** Concrete root-only dual-slot scan, called AFTER the source's actual layer and
 * post-update completion with real before/after counters. No counter prediction,
 * timeline sampling, task scheduling or callback execution lives in this class.
 * MotionSources wires this to finite layout/post-update and v9 state;
 * the app capability remains disabled until its consumer/guards are installed.
 */
export class Sd002baActionCursor implements NativeMotionActionPort {
  readonly profile:MotionCueId;
  private readonly cue:MotionCue;
  readonly playSerial = 1 as const;
  private initialized = false;
  private lastFrame = 0;
  private lastCounter = 0;
  private activeSlot: 0 | 1 = 0;
  private slots: [number, number] = [0, 1];
  private enqueued: 0 | 1 = 0;
  private dispatched: 0 | 1 = 0;
  private readonly definition: Omit<MotionActionDraft, 'sourceId' | 'now'>;
  constructor(document: MtnDocument, program: MtnProgram, readonly sourceId: number, readonly outbox: MotionActionOutbox, saved?: PsbValue) {
    integer(sourceId, 'source', 1);
    const cue=motionCue(program.objectName,program.motionName);if(!cue)throw new Error('Unbound original SE cursor');
    this.cue=cue;this.profile=cue.profile;this.definition=motionSeActionDefinition(document,program,cue);
    if (saved !== undefined) this.restore(saved);
  }
  preflight(ownerId: string): void {
    // Graph owns the precise frame-to-owner mapping and revision. A source is
    // loaded before publication, and restore rebinds physical owner ids.
    if (typeof ownerId !== 'string' || !ownerId) throw new Error('Original motion SE cursor has no published owner');
    this.ready();
  }
  private ready(): void {
    if (this.enqueued !== this.dispatched) throw new Error('Original motion SE source has an unconsumed delivery');
    this.outbox.preflight(this.enqueued ? 0 : 1);
  }
  /** Only a fresh root and monotonic ordinary progress are accepted. Rebuild at
   * time60 is NOT treated as ordinary forward: seek/control/borrow stay refused.
   */
  commitProgress(before: NativeCounterState, after: NativeCounterState, now: number): void {
    this.ready(); validateCounter(this.cue, before); validateCounter(this.cue, after);
    if (!Number.isFinite(now) || now < 0 || after.progressGate || after.layerGate || after.evalFrame < before.evalFrame || after.counterFrames < before.counterFrames || after.playing !== (after.counterFrames < this.cue.lastTime)) throw new Error('Unsupported SD002BA post-progress boundary');
    if (!this.initialized) {
      if (!before.layerGate || !before.progressGate || !before.playing || before.counterFrames !== 0 || before.evalFrame !== 0 || after.counterFrames !== 0 || after.evalFrame !== 0) throw new Error('Original motion SE first evaluation must be the fresh native zero boundary');
    } else {
      if (before.layerGate || before.progressGate || before.evalFrame !== this.lastFrame || before.counterFrames !== this.lastCounter || before.playing !== (before.counterFrames < this.cue.lastTime) || (!before.playing || after.scaledDeltaFrames === 0) && (after.evalFrame !== before.evalFrame || after.counterFrames !== before.counterFrames)) throw new Error('Original motion SE seek/rebuild/reverse is outside the action profile');
    }
    let active: 0 | 1 = this.activeSlot;
    const slots: [number, number] = [...this.slots];
    let emit = false;
    while (slots[active] < this.cue.times.length - 2 && after.evalFrame >= this.cue.times[slots[(active ^ 1) as 0 | 1]]) {
      active = (active ^ 1) as 0 | 1;
      slots[(active ^ 1) as 0 | 1] = slots[active] + 1;
      if (slots[active] === 1) emit = true;
    }
    if (emit) {
      if (this.enqueued) throw new Error('Original motion SE action scan attempted duplicate promotion');
      this.outbox.append({ ...this.definition, sourceId: this.sourceId, now });
      this.enqueued = 1;
    }
    this.activeSlot = active; this.slots = slots;
    this.lastFrame = after.evalFrame; this.lastCounter = after.counterFrames; this.initialized = true;
  }
  ack(deliveryId: number): void {
    const event = this.outbox.peek();
    if (!event || event.deliveryId !== deliveryId || event.sourceId !== this.sourceId || event.playSerial !== 1 || this.enqueued !== 1 || this.dispatched !== 0) throw new Error('Original motion SE ack is not its exact pending act');
    this.outbox.ack(deliveryId); this.dispatched = 1;
  }
  /** Actual committed ack cursor, never predicted from counter or scanned slots. */
  completedActions(): 0 | 1 { return this.dispatched; }
  /** The v9 source cross-checks this against its saved counter, never recreating
   * by progressing to the saved frame. Pending source snapshots stay refused.
   */
  validatePlayback(state: NativeCounterState, evaluated: boolean): void {
    validateCounter(this.cue, state);
    if (state.evalFrame !== this.lastFrame || state.counterFrames !== this.lastCounter || evaluated !== this.initialized || state.playing !== (state.counterFrames < this.cue.lastTime) || this.initialized && (state.layerGate || state.progressGate) || !this.initialized && (!state.layerGate || !state.progressGate || !state.playing)) throw new Error('Original motion SE source/cursor boundary mismatch');
  }
  capture(): PsbValue {
    this.outbox.preflight(0);
    if (this.enqueued !== this.dispatched) throw new Error('Original motion SE stable pending snapshot is not supported');
    return { schemaVersion: 1n, profile: this.profile, sourceId: this.sourceId, playSerial: 1, initialized: this.initialized, lastFrame: this.lastFrame, lastCounter: this.lastCounter, activeSlot: this.activeSlot, slots: [...this.slots], enqueued: this.enqueued, dispatched: this.dispatched };
  }
  private restore(value: PsbValue): void {
    const row = psbRecord(value);
    if (row.schemaVersion !== 1n || row.profile !== this.profile || row.sourceId !== this.sourceId || row.playSerial !== 1 || typeof row.initialized !== 'boolean' || (row.activeSlot !== 0 && row.activeSlot !== 1) || !Array.isArray(row.slots) || row.slots.length !== 2 || (row.enqueued !== 0 && row.enqueued !== 1) || row.dispatched !== row.enqueued) throw new Error('Invalid or pending saved SD002BA cursor');
    const frame = row.lastFrame, counter = row.lastCounter;
    if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0 || frame > this.cue.lastTime || typeof counter !== 'number' || !Number.isFinite(counter) || counter < 0 || counter > Number.MAX_SAFE_INTEGER || frame !== Math.min(counter,this.cue.lastTime)) throw new Error('Invalid saved SD002BA counter/frame');
    const index = frame < this.cue.times[1] ? 0 : frame < this.cue.times[2] ? 1 : 2, active = (index % 2) as 0 | 1;
    const slots = row.slots.map(item => integer(item, 'slot'));
    if (row.activeSlot !== active || slots[active] !== index || slots[(active ^ 1) as 0 | 1] !== index + 1 || row.enqueued !== (index >= 1 ? 1 : 0) || !row.initialized && (counter !== 0 || row.enqueued !== 0)) throw new Error('Saved SD002BA dual-slot/scan cursor mismatch');
    this.initialized = row.initialized; this.lastFrame = frame; this.lastCounter = counter;
    this.activeSlot = active; this.slots = [slots[0], slots[1]]; this.enqueued = row.enqueued; this.dispatched = row.enqueued;
  }
}
