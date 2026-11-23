import { GraphicEntity } from '../src/world/graphic-entity.ts';
import { AudioEntity } from '../src/world/audio-entity.ts';
import { clonePsbValue, psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import { nativeBoolean, nativeNumber } from '../src/world/native-values.ts';
import type { NativeGraphics } from '../src/graphics/native-graphics.ts';
import type { NativeCameraTarget } from '../src/world/camera-target.ts';
import type { NativeProperties, PropertyTarget } from '../src/world/native-properties.ts';
import type { EntityWorld, WorldEffects, WorldEntity } from '../src/world/entity-world.ts';
import type { NativeWindow } from './ui/native-window.ts';
import type { NativeVoices } from './native-voices.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import { SessionWaits } from './session-waits.ts';
import type { SessionWait } from './session-waits.ts';
import type { TrackedGraphics } from './tracked-graphics.ts';
import type {NativeOp} from './native-op.ts';
export class WorldHost {
  private op?:NativeOp;
  bindOp(op:NativeOp):void{if(this.op)throw Error('Original movie owner already bound');this.op=op;}
  readonly waits: SessionWaits; private world: EntityWorld | undefined; private voices: NativeVoices | undefined;
  private screenDone = true; private screenGeneration = 0; private screenEvents: number[] = []; private alive = true; private preparing = false;
  private tag: PsbValue = null;
  constructor(readonly graphics: NativeGraphics, readonly camera: NativeCameraTarget, readonly properties: NativeProperties,
    readonly ui: NativeWindow, readonly now: () => number, readonly layers: TrackedGraphics,
    private readonly revealReady: (key: string) => boolean, private readonly preserveAuthoredWaits=false, private readonly wake?:()=>void) {
    this.waits = new SessionWaits('session', { ready: wait => this.ready(wait), cancel: wait => this.cancel(wait) });
  }
  connect(world: EntityWorld, voices: NativeVoices): void { if (this.world || this.voices) throw new Error('World host already connected'); this.world = world; this.voices = voices; }
  get transitionActive(): boolean { return !this.screenDone || this.preparing || this.layers.pending || this.ui.hasWorldTransition; }
  target(name: string): PropertyTarget | undefined {
    if (name === 'env') return this.camera; const entity = this.world?.get(name);
    if (entity instanceof GraphicEntity) return nativeBoolean(entity.read('visible')) ? entity : this.graphics.target('hide_' + name);
    return entity instanceof AudioEntity ? entity : undefined;
  }
  private ready(wait: SessionWait): boolean {
    if(wait.kind==='op'){if(!this.op)throw Error('Unbound original OP wait');return this.op.ready(wait.token);}
    if (wait.kind === 'time') return this.now() >= wait.until;
    if (wait.kind === 'reveal') return this.revealReady(wait.key);
    if (wait.kind === 'voice') return !this.voices?.current(wait.channel, wait.playbackToken);
    if (wait.kind === 'screen') return wait.generation !== this.screenGeneration || this.screenDone;
    const entity = this.world?.get(wait.name), target = this.target(wait.name);
    if (wait.mode === 0 || wait.name === 'env') return !target || !this.properties.workingWait(target);
    if (!entity) return true; // Original createWait on a missing named envobject returns no waiter.
    if (entity instanceof GraphicEntity && wait.mode === 1) {
      const hide = this.graphics.target('hide_' + wait.name);
      return !this.layers.waiting(wait.name) && !this.properties.working(entity, 'visvalue') && (!hide || !this.properties.working(hide, 'visvalue'));
    }
    if (entity instanceof GraphicEntity && wait.mode === 2) return !this.graphics.motionWaitState(wait.name, 'movie');
    throw new Error('Unbound original audio wait mode: ' + wait.name + '/' + wait.mode);
  }
  private async cancel(wait: SessionWait): Promise<void> {
    if(wait.kind==='op'){if(!this.op)throw Error('Unbound original OP wait');this.op.skip(wait.token);return;}
    if (wait.kind === 'time') return; // Original time wait has no underlying effect to undo.
    if (wait.kind === 'reveal') { this.ui.reveal(wait.key); return; }
    if (wait.kind === 'voice') { this.voices?.stop(wait.channel, wait.playbackToken); return; }
    if (wait.kind === 'screen') { if (wait.generation === this.screenGeneration) this.stopScreen(); return; }
    const entity = this.world?.get(wait.name), target = this.target(wait.name);
    if (wait.mode === 0 || wait.name === 'env') { if (target) this.properties.finishWaitable(target, this.now()); return; }
    if (!entity) return;
    if (entity instanceof GraphicEntity && wait.mode === 1) {
      this.graphics.preflightLayerTransitionCancel(wait.name, entity.id);
      this.properties.preflightFinishProperty(entity, 'visvalue'); const hide = this.graphics.target('hide_' + wait.name);
      if (hide) this.properties.preflightFinishProperty(hide, 'visvalue');
      this.properties.finishProperty(entity, 'visvalue'); this.graphics.completeVisibility(entity.id);
      if (hide) { this.properties.finishProperty(hide, 'visvalue'); this.graphics.completeVisibility(hide.id); }
      this.graphics.controlMotion(wait.name, 'sync'); this.stopScreen(); return;
    }
    if (entity instanceof GraphicEntity && wait.mode === 2) { this.graphics.preflightMotionControl(wait.name, 'stopMovie'); this.graphics.controlMotion(wait.name, 'stopMovie'); return; }
    throw new Error('Unbound original audio wait cancellation: ' + wait.name + '/' + wait.mode);
  }
  stopScreen(): void {
    this.graphics.preflightLayerTransitionCancel(); const token = this.ui.worldTransitionToken;
    if (token !== undefined) this.ui.preflightCompleteWorldUi(token);
    this.graphics.stopWorldScreen(); if (token !== undefined) this.ui.completeWorldUi(token);
  }
  private watchScreen(): void {
    const generation = ++this.screenGeneration; if (!Number.isSafeInteger(generation)) throw new Error('World transition generation exhausted'); this.screenDone = false;
    void this.graphics.worldFinished.then(() => { if (this.alive) {this.screenEvents.push(generation);this.wake?.();} });
  }
  /** Call only after command/block registration or a successful native paint. */
  synchronize(): void {
    this.layers.synchronize(); const events = this.screenEvents; this.screenEvents = [];
    for (const generation of events) if (generation === this.screenGeneration) { this.screenDone = true; const token = this.ui.worldTransitionToken; if (token !== undefined) this.ui.completeWorldUi(token); }
  }
  parseWait(value: PsbValue, kinds?: ReadonlyMap<string, WorldEntity['kind']>): { waits: SessionWait[]; interruptible: boolean } {
    const row = psbRecord(value); for (const key of Object.keys(row)) if (key !== 'list' && key !== 'canskip') throw new Error('Unimplemented world wait field: ' + key);
    if (!Array.isArray(row.list) || row.list.length > 10000) throw new Error('Missing/over-budget original world wait list');
    const interruptible = row.canskip === undefined || nativeBoolean(row.canskip), waits: SessionWait[] = [];
    for (const item of row.list) {
      if (item === null) { waits.push({ kind: 'screen', generation: this.screenGeneration }); continue; }
      const target = psbRecord(item); for (const key of Object.keys(target)) if (key !== 'name' && key !== 'mode') throw new Error('Unimplemented world wait target field: ' + key);
      if (typeof target.name !== 'string' || !target.name) throw new Error('Missing original world wait target');
      const mode = nativeNumber(target.mode, 0); if (mode !== 0 && mode !== 1 && mode !== 2) throw new Error('Unknown original wait mode');
      const kind = kinds?.get(target.name) ?? this.world?.get(target.name)?.kind;
      if (target.name !== 'env' && kind && (kind === 'music' || kind === 'sound') && mode !== 0) throw new Error('Unbound original audio wait shape: ' + target.name + '/' + mode);
      waits.push({ kind: 'world', name: target.name, mode });
    } return { waits, interruptible };
  }
  async wait(value: PsbValue, mode: Readonly<PlaybackMode>) {
    const parsed = this.parseWait(value);
    // Do not promise an early finish when the finite cancellation path would
    // reject live native SE or would retire a hidden layer with other actions.
    const interruptible=parsed.interruptible&&(!this.preserveAuthoredWaits||!parsed.waits.some(wait=>{
      if(wait.kind!=='world'||wait.name==='env'||wait.mode===0||this.ready(wait))return false;
      if(this.graphics.eventfulMotionWait(wait.name,wait.mode===1?'sync':'movie'))return true;
      const hide=wait.mode===1?this.graphics.target('hide_'+wait.name):undefined;
      return !!hide&&this.properties.hideHasOtherWork(hide);
    }));
    if (mode.skip !== 'none' && interruptible) { for (const wait of parsed.waits) if (!this.ready(wait)) await this.cancel(wait); return undefined; }
    return this.waits.block(parsed.waits, interruptible);
  }
  effects(): WorldEffects {
    return { reset: async () => { this.camera.reset(); this.tag = null; },
      camera: async (parameters, after) => { this.camera.apply(parameters, after); },
      tag: async value => { this.tag = clonePsbValue(value); },
      messageOff: async value => { if (nativeBoolean(value)) this.ui.hide(); },
      begin: async (value, mode) => { if (this.preparing) throw new Error('Nested world UI preparation'); this.preparing = true; this.ui.beginWorldUi(value, mode); this.watchScreen(); },
      finish: async () => { if (!this.preparing) throw new Error('World UI finish without begin'); this.ui.finishWorldUi(); this.preparing = false; },
      wait: (value, mode) => this.wait(value, mode),
      prepareSourceRestore: async () => { const token = this.ui.worldTransitionToken; if (token !== undefined) this.ui.completeWorldUi(token); this.ui.hide(); this.camera.reset(); this.tag = null; this.layers.invalidate(); },
      capture: async () => { if (this.preparing || !this.screenDone || this.layers.pending) throw new Error('World host capture requires completed transitions'); return { schemaVersion: 2n, camera: this.camera.capture(), actions: this.properties.capture(), tag: clonePsbValue(this.tag) }; },
      restore: async value => { const row = psbRecord(value); if (row.schemaVersion !== 2n) throw new Error('Unsupported world host snapshot'); this.camera.restore(row.camera); this.properties.restore(row.actions); this.tag = clonePsbValue(row.tag); this.screenDone = true; this.screenGeneration++; this.screenEvents = []; this.layers.invalidate(); } };
  }
  close(): void { this.alive = false; this.screenGeneration++; this.screenEvents = []; this.waits.clear(); }
}
/** Native renderer captures the old roots only after the logical UI back-page backup. */
export function withWorldUiPages(base: WorldEffects, ui: NativeWindow): WorldEffects {
  return { ...base, begin: async (value, mode) => { ui.prepareWorldUi(); await base.begin(value, mode); } };
}
