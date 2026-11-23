import { clonePsbValue, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { PlaybackMode } from '../runtime/playback-gate.ts';
import type { CommandBlock } from '../runtime/types.ts';
import type { WorldOperation, WorldPlan } from './plan.ts';
import { sourceWorldState } from './plan.ts';

export interface WorldEntity {
  readonly classSpec: PsbValue; readonly kind: 'music' | 'sound' | 'layer' | 'dlayer'; name: string;
  initialize(): Promise<void>; dispose(): Promise<void>; rename(name: string): Promise<void>;
  update(parameters: Readonly<{ [key: string]: PsbValue }>, restoring?: boolean): Promise<void>; after(parameters: Readonly<{ [key: string]: PsbValue }>, restoring?: boolean): Promise<void>;
  capture(): Promise<PsbValue>; restore(value: PsbValue): Promise<void>;
}
export type EntityFactory = (name: string, classSpec: PsbValue) => Promise<WorldEntity>;
export interface WorldEffects {
  beginBatch?():Promise<void>; endBatch?():Promise<void>;
  reset(keepMusic: boolean): Promise<void>; camera(parameters: Readonly<{ [key: string]: PsbValue }>, after: boolean): Promise<void>;
  tag(value: PsbValue): Promise<void>; messageOff(value: PsbValue): Promise<void>;
  begin(transition: PsbValue, mode: Readonly<PlaybackMode>): Promise<void>;
  finish(transition: PsbValue, mode: Readonly<PlaybackMode>): Promise<void>;
  wait(value: PsbValue, mode: Readonly<PlaybackMode>): Promise<CommandBlock | undefined>;
  prepareSourceRestore(keptNames: readonly string[]): Promise<void>;
  capture(): Promise<PsbValue>; restore(value: PsbValue): Promise<void>;
}
function classKey(value: PsbValue): string {
  if (typeof value === 'string') return 's:' + value; if (typeof value === 'bigint') return 'i:' + value;
  throw new Error('World class key requires a string/integer definition');
}
function sameClass(a: PsbValue, b: PsbValue): boolean { return typeof a === typeof b && a === b; }
export class EntityRegistry {
  private readonly definitions = new Map<string, EntityFactory>();
  private dynamic: EntityFactory | undefined;
  register(classSpec: string | bigint, factory: EntityFactory): void { const key = classKey(classSpec); if (this.definitions.has(key)) throw new Error('Duplicate world class'); this.definitions.set(key, factory); }
  registerDynamic(factory: EntityFactory): void { if (this.dynamic) throw new Error('Duplicate dynamic world factory'); this.dynamic = factory; }
  async create(name: string, classSpec: PsbValue): Promise<WorldEntity> {
    const factory = classSpec !== null && typeof classSpec === 'object' ? this.dynamic : this.definitions.get(classKey(classSpec));
    if (!factory) throw new Error('Unimplemented world class for ' + name); return factory(name, clonePsbValue(classSpec));
  }
}
export class EntityWorld {
  private readonly entities = new Map<string, WorldEntity>(); private readonly registry: EntityRegistry; private readonly effects: WorldEffects; private busy = false;
  constructor(registry: EntityRegistry, effects: WorldEffects) { this.registry = registry; this.effects = effects; }
  get names(): readonly string[] { return [...this.entities.keys()]; }
  get(name: string): WorldEntity | undefined { return this.entities.get(name); }
  private async remove(name: string): Promise<void> { const entity = this.entities.get(name); if (entity) { await entity.dispose(); this.entities.delete(name); } }
  private async reset(keepMusic: boolean): Promise<void> {
    for (const [name, entity] of this.entities) if (!(keepMusic && entity.kind === 'music')) await this.remove(name); await this.effects.reset(keepMusic);
  }
  private async create(name: string, classSpec: PsbValue): Promise<void> {
    let entity = this.entities.get(name);
    if (!entity || !sameClass(entity.classSpec, classSpec)) { await this.remove(name); entity = await this.registry.create(name, classSpec); this.entities.set(name, entity); }
    await entity.initialize();
  }
  private async rename(from: string, to: string): Promise<void> {
    if (from === to) return; await this.remove(to); const entity = this.entities.get(from);
    if (entity) { await entity.rename(to); entity.name = to; this.entities.delete(from); this.entities.set(to, entity); }
  }
  private async operations(operations: readonly WorldOperation[]): Promise<void> {
    for (const operation of operations) {
      if (operation.kind === 'reset') await this.reset(operation.keepMusic !== null && operation.keepMusic !== false && operation.keepMusic !== 0n && operation.keepMusic !== 0 && operation.keepMusic !== '');
      else if (operation.kind === 'create') await this.create(operation.name, operation.classSpec);
      else if (operation.kind === 'delete') await this.remove(operation.name);
      else if (operation.kind === 'rename') await this.rename(operation.from, operation.to);
      else if (operation.kind === 'swap') {
        const a = this.entities.get(operation.from), b = this.entities.get(operation.to);
        if (!a) await this.rename(operation.to, operation.from); else if (!b) await this.rename(operation.from, operation.to);
        else { await a.rename(operation.to); await b.rename(operation.from); a.name = operation.to; b.name = operation.from; this.entities.set(operation.to, a); this.entities.set(operation.from, b); }
      } else if (operation.kind === 'tag') await this.effects.tag(operation.tag);
      else if (operation.name === 'env') await this.effects.camera(operation.parameters, false);
      else { const entity = this.entities.get(operation.name); if (entity) await entity.update(operation.parameters); }
    }
    for (const operation of operations) if (operation.kind === 'update') {
      if (operation.name === 'env') await this.effects.camera(operation.parameters, true);
      else { const entity = this.entities.get(operation.name); if (entity) await entity.after(operation.parameters); }
    }
  }
  async apply(plan: WorldPlan, mode: Readonly<PlaybackMode>, reverse = false): Promise<CommandBlock | undefined> {
    if (this.busy) throw new Error('World update is already in progress'); this.busy = true; let batch = false;
    try {
      await this.effects.beginBatch?.(); batch = true;
      if (plan.messageOff !== undefined) await this.effects.messageOff(plan.messageOff);
      await this.operations(reverse ? plan.reverseBefore : plan.before);
      if (plan.transition !== undefined && plan.transition !== null) await this.effects.begin(plan.transition, mode);
      await this.operations(reverse ? plan.reverse : plan.updates);
      if (plan.transition !== undefined && plan.transition !== null) await this.effects.finish(plan.transition, mode);
      return plan.wait === undefined || plan.wait === null ? undefined : await this.effects.wait(plan.wait, mode);
    } finally { try { if (batch) await this.effects.endBatch?.(); } finally { this.busy = false; } }
  }
  async capture(): Promise<PsbValue> {
    if (this.busy) throw new Error('World capture requires a stable update boundary'); this.busy = true; let batch = false;
    try { await this.effects.beginBatch?.(); batch = true; const entities: PsbValue[] = []; for (const entity of this.entities.values()) entities.push({ name: entity.name, classSpec: clonePsbValue(entity.classSpec), state: await entity.capture() });
    return { schemaVersion: 1n, entities, effects: await this.effects.capture() }; } finally { try { if (batch) await this.effects.endBatch?.(); } finally { this.busy = false; } }
  }
  async restoreSource(snapshot: PsbValue): Promise<void> {
    if (this.busy) throw new Error('Source restore requires a stable world boundary'); this.busy = true; let batch = false;
    try {
      await this.effects.beginBatch?.(); batch = true;
      const source = sourceWorldState(snapshot), rows = source.entities;
      const kept: string[] = [];
      for (const [name, entity] of this.entities) { const row = rows.find(row => row.name === name); if (!row || !sameClass(entity.classSpec, row.classSpec)) await this.remove(name); else kept.push(name); }
      await this.effects.prepareSourceRestore(kept);
      for (const row of rows) { await this.create(row.name, row.classSpec); if (row.parameters) await this.entities.get(row.name)!.update(row.parameters, true); }
      for (const row of rows) if (row.parameters) await this.entities.get(row.name)!.after(row.parameters, true);
      if (source.environment !== undefined) { const environment = source.environment; await this.effects.camera(environment, false); await this.effects.camera(environment, true); }
    } finally { try { if (batch) await this.effects.endBatch?.(); } finally { this.busy = false; } }
  }
  async restore(snapshot: PsbValue): Promise<void> {
    if (this.busy) throw new Error('World restore requires a stable update boundary'); this.busy = true; let batch = false;
    try { await this.effects.beginBatch?.(); batch = true; const value = psbRecord(snapshot); if (value.schemaVersion !== 1n || !Array.isArray(value.entities)) throw new Error('Unsupported world snapshot');
    await this.reset(false);
    for (const item of value.entities) { const entry = psbRecord(item); if (typeof entry.name !== 'string') throw new Error('Invalid saved world object name'); await this.create(entry.name, entry.classSpec); }
    for (const item of value.entities) { const entry = psbRecord(item); await this.entities.get(entry.name as string)!.restore(clonePsbValue(entry.state)); }
    await this.effects.restore(clonePsbValue(value.effects)); } finally { try { if (batch) await this.effects.endBatch?.(); } finally { this.busy = false; } }
  }
}
