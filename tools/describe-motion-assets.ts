import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsbMetadata } from './resources/psb-metadata.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
import type { PsbNode } from '../src/formats/psb2/types.ts';
import type { Psb2Reader } from '../src/formats/psb2/reader.ts';

const [gameRoot, catalogFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !catalogFile || !requestedOutput) throw new Error('Expected game root, model catalog and new output directory');
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new Error('Invalid resource catalog');
const output = await newOutputDirectory(gameRoot, requestedOutput);
function describe(reader: Psb2Reader, ref: number, depth: number): unknown {
  const node: PsbNode = reader.node(ref);
  const common = { sourceRef: ref, kind: node.kind };
  if (node.kind === 'integer') return { ...common, value: String(node.value), storageBytes: node.storageBytes };
  if (node.kind === 'real') return { ...common, value: String(node.value), storageBytes: node.storageBytes };
  if (node.kind === 'string' || node.kind === 'boolean') return { ...common, value: node.value };
  if (node.kind === 'resource') return { ...common, index: node.index, dataOffset: node.dataOffset, length: node.length };
  if (node.kind === 'array') return { ...common, count: node.items.length,
    ...(depth > 0 ? { examples: node.items.slice(0, 3).map(item => describe(reader, item, depth - 1)) } : {}) };
  if (node.kind === 'object') return { ...common, keys: node.entries.map(entry => entry.key),
    ...(depth > 0 ? { fields: node.entries.map(entry => ({ name: entry.key, value: describe(reader, entry.valueOffset, depth - 1) })) } : {}) };
  return common;
}
const models: object[] = [];
for (const item of catalog.models) {
  if (path.extname(item.name).toLowerCase() !== '.mtn') continue;
  if (item.error || !/^[0-9]+[.]bin$/u.test(item.file)) throw new Error('Unavailable motion model');
  const source = await readPsbMetadata(path.join(item.root, item.file));
  const reader = source.reader;
  const objectsRef = reader.property(reader.header.root, 'object');
  const objects = objectsRef === undefined ? undefined : reader.node(objectsRef);
  const summaries: object[] = [];
  if (objects?.kind === 'object') for (const entry of objects.entries) {
    summaries.push({ name: entry.key, structure: describe(reader, entry.valueOffset, 2) });
  }
  const sourceRef = reader.property(reader.header.root, 'source');
  const platformRef = reader.property(reader.header.root, 'spec');
  const screenRef = reader.property(reader.header.root, 'screenSize');
  models.push({ name: item.name, source: item.source, root: item.root, file: item.file,
    version: reader.header.version, platform: platformRef === undefined ? undefined : describe(reader, platformRef, 0),
    metadataBytes: source.metadataBytes, sourceByteLength: source.completeBytes,
    resourceCount: reader.resourceCount, screen: screenRef === undefined ? undefined : describe(reader, screenRef, 2),
    objects: summaries, textures: sourceRef === undefined ? undefined : describe(reader, sourceRef, 4) });
}
await writeFile(path.join(output, 'models.json'), JSON.stringify({ schemaVersion: 1, modelCount: models.length, models }, null, 2), { flag: 'wx' });
console.log('Described ' + models.length + ' motion models with object and texture structure');
