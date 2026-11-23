import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { psbValue } from '../src/formats/psb-value.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { resolveStateReference } from '../src/scenario/semantics.ts';
import { sourceWorldState } from '../src/world/plan.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, manifestFile, requestedOutput] = process.argv.slice(2); if (!gameRoot || !manifestFile || !requestedOutput) throw new Error('Expected game root, scenario manifest and new output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), output = await newOutputDirectory(gameRoot, requestedOutput), errors: object[] = [];
let checkpoints = 0, uniqueStates = 0, objects = 0;
for (const asset of manifest.files) {
  if (!/^[0-9]+$/u.test(asset.id) || !/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario asset path');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile)))), refs = new Set<number>(), rows = [];
  for (let scene = 0; scene < document.index.scenes.length; scene++) for (const event of document.index.scenes[scene].events) {
    if (event.kind !== 'record') continue; checkpoints++;
    try {
      const ref = resolveStateReference(document, scene, event.stateSlot); if (ref === undefined || refs.has(ref)) continue; refs.add(ref);
      const state = sourceWorldState(psbValue(document.reader, ref)); uniqueStates++; objects += state.entities.length;
      rows.push({ sourceRef: ref, objectCount: state.entities.length, objects: state.entities.map(entity => ({ name: entity.name, classSpec: entity.classSpec })), environmentFields: Object.keys(state.environment ?? {}) });
    } catch (error) { errors.push({ asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef, error: error instanceof Error ? error.message : String(error) }); }
  }
  await writeFile(path.join(output, asset.id + '.states.json'), JSON.stringify({ id: asset.id, states: rows }, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value), { flag: 'wx' });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, checkpoints, uniqueStates, objects, failed: errors.length, errors }, null, 2), { flag: 'wx' });
console.log('Prepared original world states: checkpoints=' + checkpoints + '; unique states=' + uniqueStates + '; failed=' + errors.length); if (errors.length) process.exitCode = 1;
