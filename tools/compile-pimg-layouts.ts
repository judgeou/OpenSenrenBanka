import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { pimgLayout } from '../src/graphics/pimg-layout.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, manifestFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !manifestFile || !requestedOutput) throw new Error('Expected game root, PIMG manifest and new output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (manifest.format !== 'prepared-pimg-metadata-v1' || !Array.isArray(manifest.models)) throw new Error('Invalid PIMG model manifest');
const output = await newOutputDirectory(gameRoot, requestedOutput), models: object[] = [];
let layerCount = 0, groups = 0, sharedImages = 0, layoutOnly = 0, failed = 0;
for (const entry of manifest.models) {
  try {
  if (!/^[0-9]+[.]psbmeta$/u.test(entry.metadataFile)) throw new Error('Unsafe metadata filename');
  const bytes = await readFile(path.join(path.dirname(manifestFile), entry.metadataFile));
  const layout = pimgLayout(new Psb2Reader(bytes, {}, entry.sourceByteLength));
  for (const layer of layout.layers) {
    layerCount += 1; if (layer.layerType === 2) groups += 1;
    if (layer.sameImageId !== undefined) sharedImages += 1;
    if (layer.layerType === 0 && layer.imageName === undefined) layoutOnly += 1;
  }
  models.push({ name: entry.name, width: layout.width, height: layout.height, roots: layout.roots,
    layers: layout.layers, children: [...layout.children].map(([id, children]) => ({ id, children })) });
  } catch (error) { models.push({ name: entry.name, error: error instanceof Error ? error.message : String(error) }); failed += 1; }
}
await writeFile(path.join(output, 'layouts.json'), JSON.stringify({ schemaVersion: 1, modelCount: models.length, layerCount,
  groups, sharedImages, layoutOnly, failed, models }, null, 2), { flag: 'wx' });
if (failed > 0) process.exitCode = 1;
console.log('Compiled PIMG layouts=' + models.length + '; layers=' + layerCount + '; groups=' + groups + '; shared=' + sharedImages + '; layout-only=' + layoutOnly);
