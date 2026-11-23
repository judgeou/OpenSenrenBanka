import { createHash } from 'node:crypto';
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
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

function describe(reader: Psb2Reader, offset: number, depth = 0): unknown {
  const node = reader.node(offset);
  const base = { offset, code: node.code, kind: node.kind };
  if (node.kind === 'integer') return { ...base, value: node.value.toString(), width: node.storageBytes };
  if (node.kind === 'string') return { ...base, length: node.value.length, value: node.value.slice(0, 600) };
  if (node.kind === 'boolean' || node.kind === 'real') return { ...base, value: node.value };
  if (node.kind === 'array') return { ...base, length: node.items.length,
    ...(depth < 4 ? { items: node.items.slice(0, depth === 0 ? 16 : 6).map(at => describe(reader, at, depth + 1)) } : {}) };
  if (node.kind === 'object') return { ...base, keys: node.entries.map(property => property.key),
    ...(depth < 4 ? { fields: Object.fromEntries(node.entries.slice(0, 12)
      .map(property => [property.key, describe(reader, property.valueOffset, depth + 1)])) } : {}) };
  return base;
}

async function main(): Promise<void> {
  const options = argumentsFor(process.argv.slice(2));
  const sourceRoot = await realpath(options.source);
  const output = await newOutputDirectory(sourceRoot, options.output);
  const scripts = await indexInlineEvb(path.join(sourceRoot, 'Script.pck'));
  const scriptReader = await ByteReader.open(scripts.source.path);
  const views: object[] = [];
  try {
    const entries = scripts.nodes.filter((node): node is EvbFile =>
      node.kind === 'file' && ['.ks', '.tjs'].includes(path.extname(node.name).toLowerCase()));
    for (const [index, entry] of entries.entries()) {
      const bytes = await readPlainEvbEntry(scriptReader, entry);
      if (bytes[0] !== 255 || bytes[1] !== 254) throw new Error('Expected UTF-16LE script asset: ' + entry.name);
      const decoded = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      const file = 'source-' + String(index + 1).padStart(2, '0') + '.txt';
      await writeFile(path.join(output, file), decoded, { flag: 'wx' });
      views.push({ entry: entry.name, sourceOffset: entry.payloadOffset, sourceBytes: entry.storedBytes,
        encoding: 'UTF-16LE', view: file, decodedSha256: createHash('sha256').update(decoded).digest('hex') });
    }
    await scriptReader.requireUnchanged();
  } finally { await scriptReader.close(); }

  const directory = await indexInlineEvb(path.join(sourceRoot, 'scenario.pck'));
  const sceneEntry = directory.nodes.find((node): node is EvbFile => node.kind === 'file' && node.name.endsWith('.scn'));
  if (!sceneEntry) throw new Error('No scene entry found');
  const sceneReader = await ByteReader.open(directory.source.path);
  const examples: Record<string, unknown[]> = Object.create(null);
  const entities: Record<string, unknown> = Object.create(null);
  let sceneMetadata: object;
  try {
    const body = unwrapMdf(await readPlainEvbEntry(sceneReader, sceneEntry));
    const reader = new Psb2Reader(body);
    const sceneListOffset = reader.property(reader.header.root, 'scenes');
    if (sceneListOffset === undefined) throw new Error('No scene list');
    const sceneList = reader.node(sceneListOffset);
    if (sceneList.kind !== 'array') throw new Error('Invalid scene list');
    for (const sceneOffset of sceneList.items) {
      const lineOffset = reader.property(sceneOffset, 'lines');
      const lines = lineOffset === undefined ? undefined : reader.node(lineOffset);
      if (lines?.kind !== 'array') continue;
      for (const lineOffset of lines.items) {
        const node = reader.node(lineOffset);
        const first = node.kind === 'array' && node.items[0] !== undefined ? reader.node(node.items[0]) : undefined;
        const shape = node.kind === 'array' ? (first?.kind ?? 'empty') + ':' + node.items.length : node.kind;
        if ((examples[shape]?.length ?? 0) < 2) (examples[shape] ??= []).push(describe(reader, lineOffset));
        if (node.kind !== 'array') continue;
        for (const possibleState of node.items) {
          const state = reader.node(possibleState);
          if (state.kind !== 'object') continue;
          const dataOffset = reader.property(possibleState, 'data');
          if (dataOffset === undefined) continue;
          const data = reader.node(dataOffset);
          if (data.kind !== 'array') continue;
          for (const entityOffset of data.items) {
            const entity = reader.node(entityOffset);
            if (entity.kind !== 'array' || entity.items.length < 3) continue;
            const name = reader.node(entity.items[1]);
            if (name.kind !== 'string' || entities[name.value] !== undefined) continue;
            entities[name.value] = describe(reader, entityOffset);
          }
        }
      }
    }
    sceneMetadata = { entry: sceneEntry.name, sourceOffset: sceneEntry.payloadOffset, examples, entities };
    await sceneReader.requireUnchanged();
  } finally { await sceneReader.close(); }
  await writeFile(path.join(output, 'script-manifest.json'), JSON.stringify({ views }, null, 2), { flag: 'wx' });
  await writeFile(path.join(output, 'scene-record-examples.json'), JSON.stringify(sceneMetadata, null, 2), { flag: 'wx' });
  console.log('Prepared ' + views.length + ' script views and scene record descriptions at ' + output);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
