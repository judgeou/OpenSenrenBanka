import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { invocation } from '../src/scenario/invocation.ts';
import { worldPlan } from '../src/world/plan.ts';
import { propertyOperations } from '../src/world/property-actions.ts';
const [manifestFile, output] = process.argv.slice(2); if (!manifestFile || !output) throw new Error('Expected scenario manifest and new property program output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), errors: object[] = [], handlers: Record<string,number> = Object.create(null); let lists = 0, operations = 0, phases = 0;
for (const asset of manifest.files) {
  if (!/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario path');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile))));
  for (let scene = 0; scene < document.index.scenes.length; scene++) for (const event of document.index.scenes[scene].events) {
    if (event.kind !== 'command') continue; const command = invocation(document, event, { asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef }); if (command.name !== 'envupdate') continue;
    const plan = worldPlan(command.parameters);
    for (const operation of [...plan.before, ...plan.updates, ...plan.reverseBefore, ...plan.reverse]) if (operation.kind === 'update') for (const field of ['action', 'hideact']) {
      if (operation.parameters[field] === undefined) continue; lists++;
      try { for (const item of propertyOperations(operation.parameters[field])) { operations++; if (item.kind === 'property') for (const phase of item.phases ?? []) { phases++; if (phase.kind === 'actions') for (const action of phase.handlers) { const name = String(action.handler ?? 'MoveAction'); handlers[name] = (handlers[name] ?? 0)+1; } } } }
      catch (error) { errors.push({ asset: asset.id, scene, event: event.sourceIndex, name: operation.name, field, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, lists, operations, phases, handlers, failed: errors.length, errors }, null, 2), { flag: 'wx' });
console.log('Prepared property programs: lists=' + lists + '; operations=' + operations + '; phases=' + phases + '; failed=' + errors.length); if (errors.length) process.exitCode = 1;
