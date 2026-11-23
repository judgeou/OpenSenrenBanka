import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ByteReader } from './resources/byte-reader.ts';
import { readPsbMetadata } from './resources/psb-metadata.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, catalogFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !catalogFile || !requestedOutput) throw new Error('Expected game root, model catalog, and new output directory');
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new Error('Invalid model catalog');
const output = await newOutputDirectory(gameRoot, requestedOutput);
const selected = new Map<string, any>();
for (const item of catalog.models) if (path.extname(item.name).toLowerCase() === '.pimg') selected.set(item.name.toLowerCase(), item);
const images: object[] = [], models: object[] = [];
let modelId = 0, imageId = 0;
for (const item of selected.values()) {
  if (item.error || item.state !== 'exported' || !/^[0-9]+[.]bin$/u.test(item.file)) throw new Error('Unavailable PIMG input');
  const file = path.join(await realpath(item.root), item.file);
  const source = await readPsbMetadata(file);
  if (source.envelope !== 'raw') throw new Error('Packed PIMG extraction requires an unwrapped source');
  const root = source.reader.node(source.reader.header.root);
  if (root.kind !== 'object') throw new Error('PIMG root must be a dictionary');
  const id = String(++modelId).padStart(5, '0');
  const directory = path.join(output, id); await mkdir(directory);
  const metadataFile = id + '.psbmeta';
  await writeFile(path.join(output, metadataFile), source.metadata, { flag: 'wx' });
  const resources: object[] = [];
  const binary = await ByteReader.open(file);
  try {
    for (const field of root.entries) {
      if (!['.tlg', '.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(field.key).toLowerCase())) continue;
      if (field.key !== path.basename(field.key) || [...field.key].some(char => '<>:"|?*'.includes(char))) throw new Error('Unsafe PIMG image key');
      const node = source.reader.node(field.valueOffset);
      if (node.kind !== 'resource') throw new Error('PIMG image field is not a resource');
      const destination = await open(path.join(directory, field.key), 'wx');
      const hash = createHash('sha256');
      try {
        for (let copied = 0; copied < node.length;) {
          const bytes = await binary.read(node.dataOffset + copied, Math.min(1024 * 1024, node.length - copied));
          await destination.writeFile(bytes); hash.update(bytes); copied += bytes.length;
        }
      } finally { await destination.close(); }
      const image = String(++imageId).padStart(5, '0');
      images.push({ id: image, name: item.name + '/' + field.key, file: id + '/' + field.key,
        isTlg: path.extname(field.key).toLowerCase() === '.tlg', sha256: hash.digest('hex'), bytes: node.length });
      resources.push({ name: field.key, resourceIndex: node.index, sourceOffset: node.dataOffset,
        sourceBytes: node.length, imageId: image, targetFile: image + (path.extname(field.key).toLowerCase() === '.tlg' ? '.png' : path.extname(field.key).toLowerCase()) });
    }
    await binary.requireUnchanged();
  } finally { await binary.close(); }
  models.push({ id, name: item.name, metadataFile, metadataBytes: source.metadataBytes,
    metadataSha256: createHash('sha256').update(source.metadata).digest('hex'), sourceByteLength: source.completeBytes,
    source: item.source, resources });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'named-image-inputs-v1',
  totalImages: images.length, tlgCount: images.filter((entry: any) => entry.isTlg).length, entries: images }, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'pimg-models.json'), JSON.stringify({ schemaVersion: 1, format: 'prepared-pimg-metadata-v1',
  models }, null, 2), { flag: 'wx' });
console.log('Prepared ' + models.length + ' active PIMG models and ' + images.length + ' embedded images');
