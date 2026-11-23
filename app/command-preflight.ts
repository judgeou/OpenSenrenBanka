import { CommandRouter } from '../src/runtime/command-router.ts';
import type { RuntimeCommand } from '../src/scenario/invocation.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import type { EntityWorld, WorldEntity } from '../src/world/entity-world.ts';
import { worldPlan } from '../src/world/plan.ts';
import type { WorldPlan } from '../src/world/plan.ts';
import { propertyOperations } from '../src/world/property-actions.ts';
import { nativeBoolean, nativeNumber } from '../src/world/native-values.ts';
import { nativeTransition } from '../src/graphics/native-transition-state.ts';
import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { EntityClasses } from '../src/world/class-catalog.ts';
import type { NativeWindow } from './ui/native-window.ts';
import type { NativeServices } from './native-services.ts';
import type { WorldHost } from './world-host.ts';
function fields(row: Readonly<Record<string, PsbValue>>, allowed: readonly string[], owner: string): void {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) throw new Error('Unsupported ' + owner + ' field: ' + key);
}
function actions(value: PsbValue | undefined): void {
  for (const operation of propertyOperations(value)) if (operation.kind === 'property') {
    // Original updatePropertyBefore branches to addAction for an array BEFORE reading tuple columns 3/4.
    if (operation.modifiers.length && !operation.phases) throw new Error('Native scalar/copy property modifier is not bound');
    for (const phase of operation.phases ?? []) if (phase.kind === 'actions') for (const handler of phase.handlers) {
      const common = ['handler', 'time', 'delay', 'starttime', 'speed', 'nofast', 'nowait'];
      if (handler.handler === 'SinAction') {
        // Original VibrateAction → TrigonoAction → SinAction. This covers the compiled finite cycles in SCN.
        fields(handler, [...common, 'cycle', 'angvel', 'vibration'], 'sinusoidal property action');
        const cycle = nativeNumber(handler.cycle), duration = nativeNumber(handler.time);
        nativeNumber(handler.vibration);
        if (cycle <= 0 || duration <= 0 || handler.angvel !== undefined && handler.angvel !== null) throw new Error('Unsupported original SinAction phase profile');
      } else if (handler.handler==='RandomAction') {
        fields(handler,[...common,'vibration','waittime'],'random property action');
        if(nativeNumber(handler.time)<=0||nativeNumber(handler.vibration)<0||nativeNumber(handler.waittime,0)<0) throw new Error('Invalid original RandomAction phase');
      } else if (handler.handler === undefined || handler.handler === 'MoveAction') {
        fields(handler, [...common, 'value', 'start', 'setstart', 'accel'], 'move property action');
      } else throw new Error('Unsupported original property action: ' + String(handler.handler));
      nativeBoolean(handler.nowait); nativeBoolean(handler.nofast);
    }
  }
}
/** Pure contract checks before EntityWorld applies any structural operation. No expressions, decoding or GPU work. */
export function preflightWorld(plan: WorldPlan, world: EntityWorld, classes: EntityClasses, host: WorldHost): void {
  fields(plan.raw, ['pretrans', 'update', 'revpretrans', 'revupdate', 'trans', 'wait', 'msgoff', 'msgchange', 'nodelaydone'], 'world root');
  if (plan.messageOff !== undefined) nativeBoolean(plan.messageOff);
  if (plan.transition !== undefined && plan.transition !== null) nativeTransition(plan.transition, 'crossfade');
  const kinds = new Map<string, WorldEntity['kind']>(); for (const name of world.names) { const entity = world.get(name); if (entity) kinds.set(name, entity.kind); }
  const classKind = (value: PsbValue): WorldEntity['kind'] => { if (typeof value !== 'string') throw new Error('Dynamic/integer native class is not enabled'); return classes.get(value).kind; };
  for (const op of [...plan.before, ...plan.updates]) {
    if (op.kind === 'reset') { const keep = nativeBoolean(op.keepMusic); for (const [name, kind] of kinds) if (!(keep && kind === 'music')) kinds.delete(name); }
    else if (op.kind === 'create') kinds.set(op.name, classKind(op.classSpec));
    else if (op.kind === 'delete') kinds.delete(op.name);
    else if (op.kind === 'rename') { const kind = kinds.get(op.from); kinds.delete(op.from); if (kind) kinds.set(op.to, kind); }
    else if (op.kind === 'swap') { const from = kinds.get(op.from), to = kinds.get(op.to); kinds.delete(op.from); kinds.delete(op.to); if (from) kinds.set(op.to, from); if (to) kinds.set(op.from, to); }
    else if (op.kind === 'update') {
      const p = op.parameters; actions(p.action); actions(p.hideact);
      if (op.name === 'env') { fields(p, ['name', 'action'], 'camera'); continue; }
      if (p.class !== undefined && !kinds.has(op.name)) kinds.set(op.name, classKind(p.class));
      const kind = kinds.get(op.name);
      if (kind === 'music' || kind === 'sound') {
        fields(p, ['name', 'class', 'action', 'replay', 'update', 'stop', 'trans'], 'audio entity');
        if (p.trans !== undefined && p.trans !== null) { const trans = psbRecord(p.trans); fields(trans, ['time', 'method'], 'audio transition'); if (trans.method !== undefined && trans.method !== null && trans.method !== '') throw new Error('Nonempty native audio transition method is not bound'); if (nativeNumber(trans.time, 0) < 0) throw new Error('Negative audio fade'); }
        if (p.replay !== undefined && p.replay !== null) fields(psbRecord(p.replay), ['filename', 'volume', 'loop', 'start', 'time', 'state'], 'audio replay');
        if (p.update !== undefined && p.update !== null) { const update = psbRecord(p.update); fields(update, ['state'], 'audio update'); const state = nativeNumber(update.state, 0); if (state !== 1 && state !== 2 && !(state === 0 && Array.isArray(p.action))) throw new Error('Unknown original audio update state'); }
      } else {
        fields(p, ['name', 'class', 'action', 'trans', 'link', 'redraw', 'showmode', 'type', 'hideact'], 'graphic entity');
        if (p.trans !== undefined && p.trans !== null) nativeTransition(p.trans, 'property');
      }
    }
  }
  if (plan.wait !== undefined && plan.wait !== null) host.parseWait(plan.wait, kinds);
}
import {originalTalkDelay} from './original-talk-delay.ts';
export class SessionCommandRouter extends CommandRouter {
  // initDelay queues tags; startDelay(1) establishes a single clock at the line's voice boundary.
  private readonly talkThresholds=new Set<number>();
  private talkOrigin?:number;
  get nextTalk(): number { return this.talkOrigin === undefined ? Infinity : this.talkOrigin + Math.min(...this.talkThresholds); }
  get talkPending():boolean{return this.talkThresholds.size!==0;}
  beginTalk():void{if(this.talkPending)this.talkOrigin=this.host.now();}
  finishTalk():void{this.talkThresholds.clear();this.talkOrigin=undefined;}
  takeTalkDelay(skip:boolean):bigint|undefined{
    if(this.talkOrigin===undefined||!this.talkPending)return;
    const elapsed=Math.max(0,Math.floor(this.host.now()-this.talkOrigin));
    let ready:number|undefined;
    for(const threshold of this.talkThresholds)if(skip||threshold<=elapsed){
      this.talkThresholds.delete(threshold);ready=Math.max(ready??0,threshold);
    }
    return ready===undefined?undefined:BigInt(ready);
  }
  private records: { name: string; location: RuntimeCommand['location']; phase: 'queued' | 'executed'; time: number }[] = [];
  get audit() { return this.records.map(row => ({ ...row, location: { ...row.location } })); }
  constructor(private readonly world: EntityWorld, private readonly classes: EntityClasses, private readonly host: WorldHost, private readonly ui: NativeWindow, private readonly services: NativeServices) { super(); }
  preflight(command: RuntimeCommand): void {
    originalTalkDelay(command);
    if (command.deferred && command.name === 'playvoice') throw new Error('Reentrant delayed voice service is not enabled');
    if (command.name === 'envupdate') preflightWorld(worldPlan(command.parameters), this.world, this.classes, this.host);
    else this.services.preflight(command);
  }
  override async dispatch(command: RuntimeCommand, mode: Readonly<PlaybackMode>) {
    try { this.preflight(command);
      const delay=originalTalkDelay(command);
        const result = command.name === 'envupdate' && !command.deferred ? await this.ui.withWorldCommand(command.parameters, () => super.dispatch(command, mode)) : await super.dispatch(command, mode);
      if(delay!==undefined)this.talkThresholds.add(delay);
      this.records.push({ name: command.name, location: { ...command.location }, phase: command.deferred ? 'queued' : 'executed', time: this.host.now() }); if (this.records.length > 2000) this.records.shift(); return result;
    } catch (error) { throw new Error('Native ' + command.name + ' failed at ' + command.location.asset + ':' + command.location.scene + ':' + command.location.event + ' (source ' + command.location.sourceRef + '): ' + (error instanceof Error ? error.message : String(error)), { cause: error }); }
  }
}
