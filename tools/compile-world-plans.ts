import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { invocation } from '../src/scenario/invocation.ts';
import { worldPlan } from '../src/world/plan.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, manifestFile, requestedOutput] = process.argv.slice(2); if (!gameRoot || !manifestFile || !requestedOutput) throw new Error('Expected game root, scenario manifest and new output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const output = await newOutputDirectory(gameRoot, requestedOutput), records: object[] = [];
const operationKinds: Record<string, number> = Object.create(null), classes: Record<string, number> = Object.create(null), fields: Record<string, number> = Object.create(null);
let plans = 0, failed = 0;
for (const asset of manifest.files) {
  if (!/^[0-9]+$/u.test(asset.id) || !/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario asset path');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile))));
  for (let scene = 0; scene < document.index.scenes.length; scene++) for (const event of document.index.scenes[scene].events) {
    if (event.kind !== 'command') continue;
    try {
      const command = invocation(document, event, { asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef });
      if (command.name !== 'envupdate') continue;
      const plan = worldPlan(command.parameters); plans++;
      for (const operation of [...plan.before, ...plan.updates, ...plan.reverse, ...plan.reverseBefore]) {
        operationKinds[operation.kind] = (operationKinds[operation.kind] ?? 0) + 1;
        if (operation.kind === 'create') { const key = typeof operation.classSpec === 'object' ? '[dynamic]' : String(operation.classSpec); classes[key] = (classes[key] ?? 0) + 1; }
        if (operation.kind === 'update') for (const name of Object.keys(operation.parameters)) fields[name] = (fields[name] ?? 0) + 1;
      }
    } catch (error) { failed++; records.push({ asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef, error: error instanceof Error ? error.message : String(error) }); }
  }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, plans, failed, operationKinds, classes, fields, errors: records }, null, 2), { flag: 'wx' });
console.log('Compiled world plans=' + plans + '; failed=' + failed); if (failed) process.exitCode = 1;
