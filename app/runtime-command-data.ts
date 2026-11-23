import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { RuntimeCommand, RuntimeLocation } from '../src/scenario/invocation.ts';
function integer(value: PsbValue | undefined): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid saved source location'); return value; }
export function runtimeLocation(value: PsbValue): RuntimeLocation {
  const row = psbRecord(value); if (typeof row.asset !== 'string' || !row.asset || row.asset.length > 4096) throw new Error('Invalid saved scenario identity');
  return { asset: row.asset, scene: integer(row.scene), event: integer(row.event), sourceRef: integer(row.sourceRef) };
}
export function runtimeCommand(value: PsbValue): RuntimeCommand {
  const row = psbRecord(value); if (typeof row.name !== 'string' || !row.name || !Array.isArray(row.order) || row.order.length > 1024) throw new Error('Invalid saved deferred command');
  const parameters = psbRecord(row.parameters), order = row.order.map(key => { if (typeof key !== 'string' || !Object.hasOwn(parameters, key)) throw new Error('Invalid saved command argument order'); return key; });
  if (Object.keys(parameters).some(key => !order.includes(key))) throw new Error('Saved command argument is absent from native order');
  let deferred: RuntimeCommand['deferred'];
  if (row.deferred !== undefined && row.deferred !== null) { const trigger = psbRecord(row.deferred);
    if (trigger.kind === 'label' && typeof trigger.value === 'string' && trigger.value) deferred = { kind: 'label', value: trigger.value };
    else if (trigger.kind === 'integer' && typeof trigger.value === 'bigint') deferred = { kind: 'integer', value: trigger.value };
    else throw new Error('Invalid saved delay trigger'); }
  return { name: row.name, parameters, order, deferred, location: runtimeLocation(row.location) };
}
