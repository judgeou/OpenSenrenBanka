import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { sceneFlow } from '../src/scenario/flow.ts';
import { commandEnvelope } from '../src/scenario/semantics.ts';
import { parseExpressionProgram } from '../src/script/expression.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, manifestFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !manifestFile || !requestedOutput) throw new Error('Expected game root, scenario manifest and new output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (manifest.format !== 'senren-scenario-assets-v2') throw new Error('Unknown scenario manifest');
const output = await newOutputDirectory(gameRoot, requestedOutput), expressions = new Map<string, unknown>();
const records: object[] = []; let scenes = 0, commands = 0, failed = 0;
function compile(text: string) { if (text && !expressions.has(text)) expressions.set(text, parseExpressionProgram(text)); }
function stringify(value: unknown) { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $integer: String(item) } : item, 2); }
for (const asset of manifest.files) {
  try {
    if (!/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario filename');
    const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile))));
    const flows: object[] = [], tags: object[] = [];
    for (let index = 0; index < document.index.scenes.length; index++) {
      const flow = sceneFlow(document, index), source = document.index.scenes[index]; scenes++;
      for (const operation of [...flow.before, ...flow.after]) compile(operation.kind === 'program' ? operation.source : operation.path);
      for (const branch of [...flow.next, ...flow.choices]) { compile(branch.condition); compile(branch.expression); }
      flows.push({ index, label: source.label, flow });
      for (const event of source.events) if (event.kind === 'command') {
        const envelope = commandEnvelope(document, event), keys: string[] = [];
        if (envelope.arguments.length % 2 !== 0) throw new Error('Odd command argument count');
        for (let part = 0; part < envelope.arguments.length; part += 2) {
          const key = document.reader.node(envelope.arguments[part]); if (key.kind !== 'string') throw new Error('Non-string command parameter'); keys.push(key.value);
        }
        tags.push({ scene: index, event: event.sourceIndex, sourceRef: event.sourceRef, target: envelope.target, keys, argumentRefs: envelope.arguments, deferred: envelope.deferred }); commands++;
      }
    }
    const file = asset.id + '.control.json'; await writeFile(path.join(output, file), stringify({ id: asset.id, flows, commands: tags }), { flag: 'wx' });
    records.push({ id: asset.id, file, state: 'compiled' });
  } catch (error) { failed++; records.push({ id: asset.id, state: 'unprepared', error: error instanceof Error ? error.message : String(error) }); }
}
await writeFile(path.join(output, 'expressions.json'), stringify([...expressions].map(([source, ast]) => ({ source, ast }))), { flag: 'wx' });
await writeFile(path.join(output, 'manifest.json'), stringify({ schemaVersion: 1, files: records.length, scenes, commands, expressions: expressions.size, failed, records }), { flag: 'wx' });
console.log('Compiled scene controls: files=' + records.length + '; scenes=' + scenes + '; commands=' + commands + '; expressions=' + expressions.size + '; failed=' + failed);
if (failed) process.exitCode = 1;
