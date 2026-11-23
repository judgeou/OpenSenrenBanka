import type { PsbValue } from '../formats/psb-value.ts';
import { clonePsbValue } from '../formats/psb-value.ts';
import { nativeNumber, nativeBoolean } from './native-values.ts';
import { nativeEase, propertyOperations } from './property-actions.ts';
import type { ActionDescriptor, ActionPhase } from './property-actions.ts';
export interface PropertyTarget { readonly id: string; read(name: string): PsbValue | undefined; write(name: string, value: PsbValue, modifiers?: readonly PsbValue[]): void }
interface HandlerState { descriptor: ActionDescriptor; initial: number; start: number; end: number; randomAt: number; randomValue: number; randomSeed: number }
interface Sequence { phases: readonly ActionPhase[]; index: number; origin: number | undefined; baseline: number | undefined; handlers: HandlerState[] }
export interface PropertyDriverSnapshot { readonly target: string; readonly property: string; readonly state: PsbValue }
/** Tick once per logical render frame; phase completion advances one native instruction at a time. */
export class NativeProperties {
  private readonly tracks = new Map<string, Map<string, Sequence>>(); private readonly targets = new Map<string, PropertyTarget>();
  private readonly evaluate: (source: string) => PsbValue; private readonly lookup: (name: string) => PropertyTarget | undefined;
  private readonly variables: (name: string) => PsbValue; private links = new Map<string, Map<string, string>>(); private savedTargets = new Map<string, string>();
  constructor(evaluate: (source: string) => PsbValue, lookup: (name: string) => PropertyTarget | undefined, variables: (name: string) => PsbValue) { this.evaluate = evaluate; this.lookup = lookup; this.variables = variables; }
  attach(target: PropertyTarget): void { if (this.targets.has(target.id) && this.targets.get(target.id) !== target) throw new Error('Duplicate property target'); this.targets.set(target.id, target); }
  bindSavedTarget(saved: string, target: PropertyTarget): void { if (!saved) throw new Error('Missing saved target identity'); this.attach(target); this.savedTargets.set(saved, target.id); }
  detach(target: PropertyTarget): void { this.tracks.delete(target.id); this.links.delete(target.id); this.targets.delete(target.id); }
  private relative(value: PsbValue | undefined, base: number): number {
    if (typeof value === 'string' && value.includes('@')) return nativeNumber(this.evaluate(value.replaceAll('@', '(' + String(base) + ')'))); return nativeNumber(value, 0);
  }
  before(target: PropertyTarget, value: PsbValue | undefined): void {
    this.attach(target); const cleared = new Set<string>();
    for (const operation of propertyOperations(value)) {
      if (operation.kind === 'clear') { this.stop(target, true); this.links.delete(target.id); continue; }
      if (operation.kind === 'stop') { this.stop(target, operation.finish); continue; }
      const { name, modifiers } = operation; if (operation.value === null) continue;
      if (!cleared.has(name)) { this.stop(target, true, name); this.links.get(target.id)?.delete(name); cleared.add(name); }
      if (operation.phases) {
        const tracks = this.tracks.get(target.id) ?? new Map<string, Sequence>(); this.tracks.set(target.id, tracks);
        const existing = tracks.get(name);
        if (existing) { const current = existing.phases[existing.index], first = operation.phases[0];
          if (current?.kind === 'actions' && first?.kind === 'actions') {
            const relative = first.handlers.filter(handler => handler.handler !== 'MoveAction'), absolute = first.handlers.filter(handler => handler.handler === 'MoveAction').slice(-1);
            const kept = absolute.length ? current.handlers.filter(handler => handler.handler !== 'MoveAction') : current.handlers;
            existing.phases = [...existing.phases.slice(0, existing.index), { kind: 'actions', handlers: [...kept, ...absolute, ...relative] }, ...operation.phases.slice(1)]; existing.handlers = []; existing.baseline = undefined;
          } else existing.phases = [...existing.phases, ...operation.phases];
        } else tracks.set(name, { phases: operation.phases, index: 0, origin: undefined, baseline: undefined, handlers: [] });
      } else if (typeof operation.value === 'string') { if (operation.value.startsWith('#')) target.write(name, operation.value.slice(1), modifiers); }
      else target.write(name, operation.value, modifiers);
    }
  }
  after(target: PropertyTarget, value: PsbValue | undefined): void {
    for (const operation of propertyOperations(value)) {
      if (operation.kind !== 'property' || typeof operation.value !== 'string' || !operation.value || operation.value.startsWith('#')) continue;
      if (operation.value.startsWith('$')) { const links = this.links.get(target.id) ?? new Map<string,string>(); links.set(operation.name, operation.value.slice(1)); this.links.set(target.id, links); continue; }
      const source = this.lookup(operation.value); if (!source) continue; const copy = source.read(operation.name);
      if (copy !== undefined) target.write(operation.name, clonePsbValue(copy), operation.modifiers);
      const sourceTrack = this.tracks.get(source.id)?.get(operation.name); if (sourceTrack) { const tracks = this.tracks.get(target.id) ?? new Map<string,Sequence>(); tracks.set(operation.name, structuredClone(sourceTrack)); this.tracks.set(target.id, tracks); }
    }
  }
  private noWait(sequence: Sequence): boolean { return sequence.phases.some(phase => phase.kind === 'actions' && phase.handlers.some(handler => nativeBoolean(handler.nowait))); }
  hasWork(match: (target: PropertyTarget) => boolean): boolean {
    for (const map of [this.tracks, this.links]) for (const [id, entries] of map) {
      const target = this.targets.get(id); if (entries.size && target && match(target)) return true;
    }
    return false;
  }
  workingWait(target: PropertyTarget): boolean { return [...(this.tracks.get(target.id)?.values() ?? [])].some(sequence => !this.noWait(sequence)); }
  /** Original stopAllActions(false): finish waitable sequences, leave nowait background actions intact. */
  finishWaitable(target: PropertyTarget | undefined, now: number): void {
    for (const [id, tracks] of this.tracks) { if (target && target.id !== id) continue; const owner = this.targets.get(id); if (!owner) throw new Error('Waitable property target disappeared');
      for (const [name, sequence] of tracks) if (!this.noWait(sequence)) { let budget = 100000; while (!this.step(owner, name, sequence, now, true)) if (--budget < 0) throw new Error('Property completion budget exhausted'); tracks.delete(name); }
    }
  }
  workingId(id:string,property?:string):boolean{return property?this.tracks.get(id)?.has(property)??false:(this.tracks.get(id)?.size??0)>0;}
  working(target: PropertyTarget, property?: string): boolean { return property ? this.tracks.get(target.id)?.has(property) ?? false : (this.tracks.get(target.id)?.size ?? 0) > 0; }
  stop(target: PropertyTarget, finish: boolean, property?: string): void {
    const tracks = this.tracks.get(target.id); if (!tracks) return;
    for (const [name, sequence] of tracks) if (!property || name === property) { if (finish) this.step(target, name, sequence, sequence.origin ?? 0, true); tracks.delete(name); }
  }
  /** The finite motion SE receipt must remain valid through the next property
   * tick. Inspect ownership/maps only; never step, evaluate, read or write target. */
  preflightMotionSoundTarget(target: PropertyTarget): void {
    if (this.targets.get(target.id) !== target) throw new Error('Motion sound target is not the exact attached property target');
    if ((this.tracks.get(target.id)?.size ?? 0) !== 0 || (this.links.get(target.id)?.size ?? 0) !== 0) throw new Error('Motion sound target has active property tracks or copy-value links');
  }
  /** Pure guard for the narrow hide-kill profile. Original kill finishes ALL
   * actions; this finite path must reject rather than silently detach others. */
  hideHasOtherWork(target: PropertyTarget): boolean {
    return [...(this.tracks.get(target.id)?.keys()??[])].some(name=>name!=='visvalue')||(this.links.get(target.id)?.size??0)>0;
  }
  preflightHideRetirement(target: PropertyTarget): void {
    this.preflightFinishProperty(target, 'visvalue');
    const tracks = this.tracks.get(target.id);
    if (tracks && [...tracks.keys()].some(name => name !== 'visvalue')) throw new Error('Hide retirement with non-visibility actions/callbacks is not implemented');
    if ((this.links.get(target.id)?.size ?? 0) !== 0) throw new Error('Hide retirement with copy-value links is not implemented');
  }
  /** Finite original delAction(visvalue), separate from the legacy stop API.
   * No expression evaluation, random initialization or target writes in preflight.
   * The caller owns the matching layer-after callback, AFTER successful deletion. */
  preflightFinishProperty(target: PropertyTarget, property: 'visvalue'): void {
    if (property !== 'visvalue' || this.targets.get(target.id) !== target) throw new Error('Unknown visibility finish target');
    if (this.links.get(target.id)?.has(property)) throw new Error('Linked visibility finish requires an unimplemented copy-value protocol');
    const sequence = this.tracks.get(target.id)?.get(property); if (!sequence) return;
    if (Object.keys(sequence).some(key => !['phases','index','origin','baseline','handlers'].includes(key))) throw new Error('Unknown visibility finish sequence field/callback');
    if (!Number.isSafeInteger(sequence.index) || sequence.index < 0 || sequence.index > sequence.phases.length) throw new Error('Invalid visibility finish cursor');
    const literal = (value: PsbValue | undefined, fallback = 0): number => {
      if (typeof value === 'string' && !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/iu.test(value.trim())) throw new Error('Visibility finish rejects expressions and nonliteral numbers');
      return nativeNumber(value, fallback);
    };
    const allowed = new Set(['handler','value','start','setstart','time','accel','delay','starttime','speed','nofast','nowait']);
    for (const phase of sequence.phases.slice(sequence.index)) {
      if (phase.kind === 'wait') {
        if (Object.keys(phase).some(key => !['kind','time','speed'].includes(key))) throw new Error('Unknown visibility wait field/callback');
        literal(phase.time); literal(phase.speed, 1); continue;
      }
      if (phase.kind !== 'actions' || !Array.isArray(phase.handlers) || Object.keys(phase).some(key => !['kind','handlers'].includes(key))) throw new Error('Unknown visibility finish phase');
      for (const data of phase.handlers) {
        if (data.handler !== undefined && data.handler !== 'MoveAction') throw new Error('Visibility finish requires literal MoveAction phases');
        for (const key of Object.keys(data)) {
          if (!allowed.has(key)) throw new Error('Unimplemented visibility finish field/callback: ' + key);
          if (key === 'handler') continue;
          const value = data[key];
          if (key === 'accel' && typeof value === 'string' && ['accos','acdec','accel','decel','const'].includes(value.toLowerCase())) continue;
          literal(value);
        }
      }
    }
    // Cached in-flight handlers must still correspond to this exact phase. Do not
    // accept a restored descriptor containing a hidden callback/expression.
    if (sequence.baseline !== undefined) {
      literal(sequence.baseline); const phase = sequence.phases[sequence.index];
      if (!phase || phase.kind !== 'actions' || sequence.handlers.length !== phase.handlers.length) throw new Error('Visibility finish cached phase mismatch');
      for (let i = 0; i < sequence.handlers.length; i++) {
        const cached = sequence.handlers[i], source = phase.handlers[i];
        if (Object.keys(cached.descriptor).length !== Object.keys(source).length || Object.keys(source).some(key => cached.descriptor[key] !== source[key])) throw new Error('Visibility finish cached descriptor mismatch');
        literal(cached.initial); literal(cached.start); literal(cached.end);
        if (cached.end !== literal(source.value)) throw new Error('Visibility finish cached endpoint mismatch');
      }
    }
  }
  finishProperty(target: PropertyTarget, property: 'visvalue'): boolean {
    this.preflightFinishProperty(target, property);
    const tracks = this.tracks.get(target.id), sequence = tracks?.get(property); if (!sequence) return false;
    // Accepted absolute literal moves need neither step(), expression execution,
    // easing nor random seeding. Finish EVERY remaining phase in native order.
    while (sequence.index < sequence.phases.length) {
      const phase = sequence.phases[sequence.index];
      if (phase.kind === 'actions' && phase.handlers.length) {
        const absolute = phase.handlers[phase.handlers.length - 1];
        target.write(property, nativeNumber(absolute.value, 0));
      }
      sequence.index++; sequence.origin = undefined; sequence.baseline = undefined; sequence.handlers = [];
    }
    tracks!.delete(property); return true;
  }
  tick(now: number, finish = false): void {
    if (!Number.isFinite(now) || now < 0) throw new Error('Invalid property clock');
    for (const [id, tracks] of this.tracks) { const target = this.targets.get(id); if (!target) throw new Error('Property target disappeared');
      for (const [name, sequence] of tracks) if (this.step(target, name, sequence, now, finish)) tracks.delete(name);
    }
    for (const [id, links] of this.links) { const target = this.targets.get(id); if (!target) continue; for (const [name, source] of links) target.write(name, this.variables(source)); }
  }
  private step(target: PropertyTarget, name: string, sequence: Sequence, now: number, finish: boolean): boolean {
    const phase = sequence.phases[sequence.index]; if (!phase) return true; if (sequence.origin === undefined) sequence.origin = now;
    const elapsed = Math.max(0, now-sequence.origin);
    if (phase.kind === 'wait') { if (finish || elapsed*phase.speed >= phase.time) { sequence.index++; sequence.origin = undefined; } return sequence.index >= sequence.phases.length; }
    if (sequence.baseline === undefined) {
      const initial = nativeNumber(target.read(name), 0); sequence.baseline = initial;
      sequence.handlers = phase.handlers.map(descriptor => ({ descriptor, initial, start: descriptor.start === undefined || descriptor.start === null ? initial : this.relative(descriptor.start, initial),
        end: this.relative(descriptor.value, initial), randomAt: 0, randomValue: 0, randomSeed: Math.floor(Math.random()*4294967296) >>> 0 }));
    }
    let value = sequence.baseline, done = true;
    const ordered = [...sequence.handlers.filter(handler => (handler.descriptor.handler ?? 'MoveAction') === 'MoveAction').slice(-1), ...sequence.handlers.filter(handler => handler.descriptor.handler !== undefined && handler.descriptor.handler !== 'MoveAction')];
    for (const state of ordered) {
      const data = state.descriptor, local = (elapsed-nativeNumber(data.delay, 0)+nativeNumber(data.starttime, 0))*nativeNumber(data.speed, 1), duration = nativeNumber(data.time, 0);
      const complete = finish || local > duration; if (local < 0 && !finish) { done = false; continue; }
      const kind = data.handler ?? 'MoveAction';
      if (kind === 'MoveAction') { value = complete || duration === 0 ? state.end : state.start+(state.end-state.start)*nativeEase(data.accel, local/duration); if (!complete && duration !== 0) done = false; }
      else if (!complete) {
        done = false; const amount = this.relative(data.value ?? data.vibration, state.initial)*nativeNumber(data.mag, 1), offset = this.relative(data.offset, state.initial);
        if (kind === 'SinAction') { const cycle = nativeNumber(data.cycle, 0); const angle = cycle ? 2*Math.PI*local/cycle : 2*Math.PI*local*nativeNumber(data.angvel, 0)/360000; value += amount*Math.sin(angle)+offset; }
        else if (kind === 'RandomAction') { if (local >= state.randomAt) { let seed = state.randomSeed || 1; seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; state.randomSeed = seed >>> 0; state.randomValue = state.randomSeed/4294967296*amount*2-amount+offset; state.randomAt += nativeNumber(data.waittime, 0); } value += state.randomValue; }
      }
    }
    target.write(name, value); if (done) { sequence.index++; sequence.origin = undefined; sequence.baseline = undefined; sequence.handlers = []; }
    return sequence.index >= sequence.phases.length;
  }
  restore(value: PsbValue): void {
    const root = clonePsbValue(value) as { [key: string]: PsbValue }; if (!root || !Array.isArray(root.tracks) || !Array.isArray(root.links)) throw new Error('Invalid native property snapshot');
    const tracks = new Map<string, Map<string, Sequence>>(), links = new Map<string, Map<string, string>>();
    for (const item of root.tracks) {
      const target = item as { [key: string]: PsbValue }; if (typeof target.target === 'string') target.target = this.savedTargets.get(target.target) ?? target.target; if (typeof target.target !== 'string' || !this.targets.has(target.target) || !Array.isArray(target.properties)) throw new Error('Unknown saved property target');
      const entries = new Map<string, Sequence>();
      for (const value of target.properties) { const row = value as { [key: string]: PsbValue }, state = row.state as unknown as Sequence;
        if (typeof row.name !== 'string' || !state || !Array.isArray(state.phases) || !Number.isSafeInteger(state.index) || state.index < 0 || state.index > state.phases.length || !Array.isArray(state.handlers)) throw new Error('Invalid saved property program');
        entries.set(row.name, structuredClone(state));
      } tracks.set(target.target, entries);
    }
    for (const item of root.links) { const target = item as { [key: string]: PsbValue }; if (typeof target.target === 'string') target.target = this.savedTargets.get(target.target) ?? target.target; if (typeof target.target !== 'string' || !this.targets.has(target.target) || !Array.isArray(target.fields)) throw new Error('Invalid saved property links');
      const fields = new Map<string,string>(); for (const value of target.fields) { const field = value as { [key: string]: PsbValue }; if (typeof field.name !== 'string' || typeof field.source !== 'string') throw new Error('Invalid variable property link'); fields.set(field.name, field.source); } links.set(target.target, fields);
    }
    this.tracks.clear(); for (const [target, values] of tracks) this.tracks.set(target, values); this.links = links; this.savedTargets.clear();
  }
  capture(): PsbValue {
    return { tracks: [...this.tracks].map(([target, tracks]) => ({ target, properties: [...tracks].map(([name,state]) => ({ name, state: structuredClone(state) as unknown as PsbValue })) })), links: [...this.links].map(([target, links]) => ({ target, fields: [...links].map(([name, source]) => ({ name, source })) })) };
  }
}
