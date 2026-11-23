import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ByteReader } from './resources/byte-reader.ts';
import { indexInlineEvb } from './resources/evb-index.ts';
import type { EvbFile } from './resources/evb-index.ts';
import { unwrapMdf } from './resources/mdf.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
import { inventoryScenario } from './resources/scenario-inventory.ts';
import type { ScenarioInventory } from './resources/scenario-inventory.ts';

function args(argv: string[]) {
  let source: string | undefined, output: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i], value = argv[++i];
    if (!['--source', '--output'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('Usage: node tools/index-scenarios.ts --source <game-directory> --output <new-work-directory>');
    }
    if (key === '--source') {
      if (source !== undefined) throw new Error('Repeated --source');
      source = value;
    } else {
      if (output !== undefined) throw new Error('Repeated --output');
      output = value;
    }
  }
  if (!source || !output) throw new Error('Both --source and --output are required');
  return { source, output };
}

async function entryBytes(reader: ByteReader, entry: EvbFile): Promise<Buffer> {
  if (entry.requiresDecompression) throw new Error('Compressed EVB payload is not supported');
  if (entry.storedBytes > 32 * 1024 * 1024) throw new Error('Scene input budget exceeded');
  const bytes = Buffer.alloc(entry.storedBytes);
  for (let done = 0; done < bytes.length;) {
    const length = Math.min(1024 * 1024, bytes.length - done);
    const chunk = await reader.read(entry.payloadOffset + done, length);
    chunk.copy(bytes, done); done += chunk.length;
  }
  return bytes;
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, count] of Object.entries(source)) target[key] = (target[key] ?? 0) + count;
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const sourceRoot = await realpath(options.source);
  const source = path.join(sourceRoot, 'scenario.pck');
  const directory = await indexInlineEvb(source);
  const entries = directory.nodes.filter((node): node is EvbFile =>
    node.kind === 'file' && node.name.toLowerCase().endsWith('.scn'));
  const output = await newOutputDirectory(sourceRoot, options.output);
  const progress = await open(path.join(output, 'progress.jsonl'), 'wx');
  const reader = await ByteReader.open(source);
  const totals = { sceneCount: 0, lineCount: 0, textCount: 0, choiceCount: 0,
    snapshots: 0, commands: 0, otherLines: 0, malformedEntities: 0, psbNodes: 0,
    preEvalCount: 0, postEvalCount: 0, nonFiniteReals: 0, negativeZeroReals: 0 };
  const frequencyKeys = ['psbTypes', 'integerWidths', 'sceneFields', 'lineShapes', 'stateFields',
    'commandTargets', 'commandPairs', 'entityClasses', 'entityStateFields', 'entityParameterFields'] as const;
  const frequencies: Record<string, Record<string, number>> = Object.create(null);
  for (const key of frequencyKeys) frequencies[key] = Object.create(null);
  const files: { index: number; entry: string; offset: number; report: string;
    state: 'indexed' | 'unindexed'; error?: string }[] = [];
  let indexed = 0, failures = 0;
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const report = String(index + 1).padStart(4, '0') + '.json';
      const record: typeof files[number] = { index, entry: entry.name,
        offset: entry.payloadOffset, report, state: 'unindexed' };
      let detail: object;
      try {
        const packed = await entryBytes(reader, entry);
        const magic = packed.toString('hex', 0, 4);
        const body = magic === '6d646600' ? unwrapMdf(packed) : packed;
        const psb = new Psb2Reader(body);
        const inventory: ScenarioInventory = inventoryScenario(psb);
        detail = { schemaVersion: 1, scope: 'static-scene-structure',
          source: { package: reader.source, entry: entry.pathParts, offset: entry.payloadOffset,
            storedBytes: entry.storedBytes, decodedBytes: body.length,
            decodedSha256: createHash('sha256').update(body).digest('hex') },
          inventory };
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += inventory[key];
        for (const key of frequencyKeys) mergeCounts(frequencies[key], inventory[key]);
        record.state = 'indexed'; indexed += 1;
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        detail = { schemaVersion: 1, scope: 'static-scene-structure', ...record };
        failures += 1;
      }
      await writeFile(path.join(output, report), JSON.stringify(detail, null, 2) + String.fromCharCode(10), { flag: 'wx' });
      files.push(record);
      await progress.write(JSON.stringify({ ...record, recordedAt: new Date().toISOString() }) + String.fromCharCode(10));
      await progress.sync();
      console.log('Resource entry ' + (index + 1) + '/' + entries.length + ': ' + record.state);
    }
    await reader.requireUnchanged();
    const summary = { schemaVersion: 1, producer: 'offline-scene-index',
      scope: 'static-scene-structure', createdAt: new Date().toISOString(),
      source: directory.source, directoryMetadataSha256: directory.metadataSha256,
      totalEntries: entries.length, indexedEntries: indexed, unindexedEntries: failures,
      totals, frequencies, files };
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + String.fromCharCode(10), { flag: 'wx' });
    console.log('Scene inventory: ' + indexed + '/' + entries.length + '; unindexed=' + failures);
    console.log('Output: ' + output);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await reader.close();
    await progress.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
