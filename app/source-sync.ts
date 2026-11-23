import { sourceWorldState } from '../src/world/plan.ts';
import type { WorldOperation, WorldPlan } from '../src/world/plan.ts';
import type { EntityWorld } from '../src/world/entity-world.ts';
import { GraphicEntity } from '../src/world/graphic-entity.ts';
import { nativeNumber } from '../src/world/native-values.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
/** EnvObjectWorld.syncObject: remove names absent from the next state's table and re-init only existing layers with changed visibility.
 * Missing objects are NOT created here, existing music is NOT replayed, and source env/plugin state is NOT restored. */
export function sourceSyncPlan(value: PsbValue, world: EntityWorld): WorldPlan {
  const state = sourceWorldState(value), expected = new Set(state.entities.map(item => item.name)), before: WorldOperation[] = [], updates: WorldOperation[] = [];
  for (const name of world.names) if (!expected.has(name)) before.push({ kind: 'delete', name });
  for (const item of state.entities) {
    const entity = world.get(item.name); if (!(entity instanceof GraphicEntity) || !item.parameters) continue;
    const mode = nativeNumber(item.parameters.showmode, 0); if (!Number.isSafeInteger(mode)) throw new Error('Invalid source visibility mode');
    if (entity.sourceVisible === ((mode & 1) !== 0)) continue;
    before.push({ kind: 'create', name: item.name, classSpec: item.classSpec }); updates.push({ kind: 'update', name: item.name, parameters: item.parameters });
  }
  return { before, updates, reverse: [], reverseBefore: [], transition: undefined, wait: undefined, messageOff: undefined, raw: {} };
}
