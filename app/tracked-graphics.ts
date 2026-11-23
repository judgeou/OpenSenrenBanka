import type { GraphicEntityPort, GraphicFrame, GraphicPresentation } from '../src/world/graphic-entity.ts';
import type { EntityClassDefinition } from '../src/world/class-catalog.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
interface Pending { readonly generation: number; name: string }
/** Promises enqueue identities only. Poll after the corresponding paint; never resolve a story waiter in a callback. */
export class TrackedGraphics implements GraphicEntityPort {
  private serial = 0; private readonly active = new Map<string, Pending>();
  private events: { readonly id: string; readonly generation: number; readonly failed: boolean; readonly error?: unknown }[] = [];
  constructor(private readonly port: GraphicEntityPort, private readonly wake?:()=>void) {}
  get pending(): boolean { return this.active.size !== 0; }
  waiting(name: string): boolean { return [...this.active.values()].some(row => row.name === name); }
  synchronize(): void {
    const events = this.events; this.events = [];
    for (const event of events) { if (this.active.get(event.id)?.generation !== event.generation) continue;
      if (event.failed) throw new Error('Original layer transition failed', { cause: event.error }); this.active.delete(event.id); }
  }
  invalidate(): void { this.active.clear(); this.events = []; }
  preparingWorldTransition(): boolean { return this.port.preparingWorldTransition?.() ?? false; }
  defaults(definition: EntityClassDefinition, frame: GraphicFrame | undefined) { return this.port.defaults(definition, frame); }
  load(redraw: Readonly<Record<string, PsbValue>>, definition: EntityClassDefinition, previous?: GraphicFrame, saved?: PsbValue) { return this.port.load(redraw, definition, previous, saved); }
  publish(value: GraphicPresentation): void { const row = this.active.get(value.id); if (row) row.name = value.name; this.port.publish(value); }
  remove(id: string): void { this.active.delete(id); this.port.remove(id); }
  async after(id: string, parameters: Readonly<Record<string, PsbValue>>): Promise<void> { await this.port.after?.(id, parameters); }
  async transition(id: string, before: GraphicPresentation, after: GraphicPresentation, parameters: Readonly<Record<string, PsbValue>>, hide: PsbValue | undefined, operation?: Readonly<Record<string, PsbValue>>) {
    if (!Number.isSafeInteger(++this.serial)) throw new Error('Layer transition identity exhausted');
    const result = await this.port.transition(id, before, after, parameters, hide, operation), generation = this.serial;
    this.active.set(id, { generation, name: after.name });
    void result.finished.then(() => {this.events.push({ id, generation, failed: false });this.wake?.();}, error => {this.events.push({ id, generation, failed: true, error });this.wake?.();});
    return result;
  }
}
