import { createHash } from 'node:crypto';
import { realpath, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { ByteReader } from './resources/byte-reader.ts';
import { indexInlineEvb } from './resources/evb-index.ts';
import type { EvbFile } from './resources/evb-index.ts';
import { readPlainEvbEntry } from './resources/read-entry.ts';
import { unwrapMdf } from './resources/mdf.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

function argumentsFor(argv: string[]) {
  let source: string | undefined, output: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i], value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing option value');
    if (option === '--source' && source === undefined) source = value;
    else if (option === '--output' && output === undefined) output = value;
    else throw new Error('Unknown/repeated option ' + option);
  }
  if (!source || !output) throw new Error('Expected --source and --output');
  return { source, output };
}
const increment = (map: Record<string, number>, key: string): void => { map[key] = (map[key] ?? 0) + 1; };

async function main(): Promise<void> {
  const options = argumentsFor(process.argv.slice(2));
  const sourceRoot = await realpath(options.source);
  const directory = await indexInlineEvb(path.join(sourceRoot, 'scenario.pck'));
  const entries = directory.nodes.filter((node): node is EvbFile => node.kind === 'file' && node.name.endsWith('.scn'));
  const output = await newOutputDirectory(sourceRoot, options.output);
  const reader = await ByteReader.open(directory.source.path);
  const progress = await open(path.join(output, 'progress.jsonl'), 'wx');
  const files: object[] = [];
  const aliases: Record<string, string[]> = Object.create(null);
  const eventKinds: Record<string, number> = Object.create(null);
  const recordVariants: Record<string, number> = Object.create(null);
  const stateSlotKinds: Record<string, number> = Object.create(null);
  const markerPrefixes: Record<string, number> = Object.create(null);
  const commandPartKeyKinds: Record<string, number> = Object.create(null);
  const textFieldKinds: Record<string, number> = Object.create(null);
  let prepared = 0, failed = 0, sceneCount = 0, eventCount = 0, textCount = 0, diagnosticCount = 0, decodedBytes = 0;
  try {
    for (const [position, entry] of entries.entries()) {
      const id = String(position + 1).padStart(4, '0');
      let row: object;
      try {
        const packed = await readPlainEvbEntry(reader, entry);
        const body = packed.toString('hex', 0, 4) === '6d646600' ? unwrapMdf(packed) : packed;
        const psb = new Psb2Reader(body);
        const document = new ScenarioDocument(psb);
        const digest = createHash('sha256').update(body).digest('hex');
        const binaryFile = id + '.psb';
        const indexFile = id + '.scene.json';
        const logicalAliases = [...new Set([entry.name, entry.name.slice(0, -4), document.index.name]
          .filter((name): name is string => name !== null && name !== ''))];
        const metadata = { schemaVersion: 2, id, body: { file: binaryFile, sha256: digest, bytes: body.length },
          source: { entry: entry.pathParts, offset: entry.payloadOffset, storedBytes: entry.storedBytes },
          logicalAliases, index: document.index };
        const indexJson = JSON.stringify(metadata, null, 2);
        await writeFile(path.join(output, binaryFile), body, { flag: 'wx' });
        await writeFile(path.join(output, indexFile), indexJson, { flag: 'wx' });
        for (const alias of logicalAliases) (aliases[alias] ??= []).push(id);
        for (const scene of document.index.scenes) {
          sceneCount += 1; textCount += scene.texts.length;
          for (const event of scene.events) {
            eventCount += 1; increment(eventKinds, event.kind);
            if (event.kind === 'record') { increment(recordVariants, String(event.variant)); increment(stateSlotKinds, event.stateKind); }
            if (event.kind === 'command') {
              for (const part of event.parts) increment(commandPartKeyKinds, part.key.kind);
            }
            if (event.kind === 'marker') {
              const split = event.value.indexOf('_');
              increment(markerPrefixes, split < 0 ? '(no underscore)' : event.value.slice(0, split));
            }
          }
          for (const text of scene.texts) {
            for (const [slot, name] of ['speaker', 'displayName', 'body', 'voiceData', 'attributes', 'restoreState'].entries()) {
              const ref = text.slots[slot];
              increment(textFieldKinds, name + ':' + (ref === undefined ? 'missing' : psb.node(ref).kind));
            }
          }
        }
        diagnosticCount += document.index.diagnostics.length; decodedBytes += body.length; prepared += 1;
        row = { id, state: 'prepared', entry: entry.name, binaryFile, indexFile, sha256: digest, bytes: body.length,
          logicalAliases, sceneCount: document.index.scenes.length, diagnostics: document.index.diagnostics };
      } catch (error) {
        failed += 1; row = { id, state: 'unprepared', entry: entry.name, error: error instanceof Error ? error.message : String(error) };
      }
      files.push(row);
      await progress.write(JSON.stringify(row) + String.fromCharCode(10));
      await progress.sync();
      console.log('Prepared scene asset ' + (position + 1) + '/' + entries.length);
    }
    await reader.requireUnchanged();
    const manifest = { schemaVersion: 2, format: 'senren-scenario-assets-v2', createdAt: new Date().toISOString(),
      source: directory.source, totalEntries: entries.length, preparedEntries: prepared, unpreparedEntries: failed,
      totals: { sceneCount, eventCount, textCount, diagnosticCount, decodedBytes },
      frequencies: { eventKinds, recordVariants, stateSlotKinds, markerPrefixes, commandPartKeyKinds, textFieldKinds }, aliases, files };
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    console.log('Prepared ' + prepared + '/' + entries.length + ' scenario assets; diagnostics=' + diagnosticCount);
    console.log('Output: ' + output);
    if (failed > 0) process.exitCode = 1;
  } finally { await reader.close(); await progress.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
