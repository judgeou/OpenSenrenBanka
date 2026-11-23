import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { psbValue } from '../src/formats/psb-value.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, scenarioFile, motionFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !scenarioFile || !motionFile || !requestedOutput) throw new Error('Expected game root, scenario manifest, motion manifest and new output');
const scenarios = JSON.parse(await readFile(scenarioFile, 'utf8')), motions = JSON.parse(await readFile(motionFile, 'utf8'));
if (scenarios.format !== 'senren-scenario-assets-v2' || motions.format !== 'prepared-mtn-metadata-v1') throw new Error('Unknown input metadata');
const output = await newOutputDirectory(gameRoot, requestedOutput);
function stringify(value: unknown): string { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ?
  (item >= BigInt(Number.MIN_SAFE_INTEGER) && item <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(item) : { $integer: String(item) }) : item, 2); }
const sceneFiles: object[] = [], motionFiles: object[] = [], commandTargets: Record<string, number> = Object.create(null);
for (const asset of scenarios.files) {
  if (!/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario filename');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(scenarioFile), asset.binaryFile))));
  const records: object[] = [];
  for (const scene of document.index.scenes) {
    const fields: Record<string, unknown> = Object.create(null);
    for (const name of ['label', 'nexts', 'selects', 'selectInfo', 'preevals', 'postevals']) {
      const ref = document.reader.property(scene.sourceRef, name); if (ref !== undefined) fields[name] = psbValue(document.reader, ref);
    }
    for (const event of scene.events) if (event.kind === 'command') commandTargets[event.target] = (commandTargets[event.target] ?? 0) + 1;
    records.push({ sourceRef: scene.sourceRef, fields });
  }
  const file = asset.id + '.flow.json'; await writeFile(path.join(output, file), stringify({ id: asset.id, name: document.index.name, scenes: records }), { flag: 'wx' });
  sceneFiles.push({ id: asset.id, file, sceneCount: records.length });
}
for (const model of motions.models) {
  if (!/^[0-9]+[.]psbmeta$/u.test(model.metadataFile)) throw new Error('Unsafe motion metadata filename');
  const reader = new Psb2Reader(await readFile(path.join(path.dirname(motionFile), model.metadataFile)), {}, model.sourceByteLength);
  const ref = reader.property(reader.header.root, 'object'); if (ref === undefined) throw new Error('Missing motion objects');
  const file = String(motionFiles.length + 1).padStart(4, '0') + '.motion.json';
  const data = psbValue(reader, ref);
  await writeFile(path.join(output, file), stringify({ name: model.name, sourceRef: ref, objects: data }), { flag: 'wx' });
  motionFiles.push({ name: model.name, file });
}
await writeFile(path.join(output, 'manifest.json'), stringify({ schemaVersion: 1, scenarioCount: sceneFiles.length, motionCount: motionFiles.length,
  commandTargets, sceneFiles, motionFiles }), { flag: 'wx' });
console.log('Prepared execution metadata: scenario files=' + sceneFiles.length + '; motion models=' + motionFiles.length);
