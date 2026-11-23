import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, requestedOutput, regularFile, pimgImageFile, pimgModelFile] = process.argv.slice(2);
if (!gameRoot || !requestedOutput || !regularFile || !pimgImageFile || !pimgModelFile) throw new Error('Expected game root, new output, regular images, PIMG images, and PIMG metadata');
const output = await newOutputDirectory(gameRoot, requestedOutput);
async function imageManifest(file: string) {
  const resolved = await realpath(file), value = JSON.parse(await readFile(resolved, 'utf8'));
  if (value.schemaVersion !== 1 || value.format !== 'prepared-web-images-v1' || value.failed !== 0 || !Array.isArray(value.entries)) throw new Error('Incomplete prepared image dataset');
  let bytes = 0;
  for (const entry of value.entries) {
    if (!['converted', 'copied'].includes(entry.state) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new Error('Invalid prepared image record');
    bytes += entry.bytes;
  }
  return { resolved, value, bytes };
}
const regular = await imageManifest(regularFile), pimgImages = await imageManifest(pimgImageFile);
const modelPath = await realpath(pimgModelFile), modelData = JSON.parse(await readFile(modelPath, 'utf8'));
if (modelData.schemaVersion !== 1 || modelData.format !== 'prepared-pimg-metadata-v1' || !Array.isArray(modelData.models)) throw new Error('Invalid PIMG metadata dataset');
const available = new Set(pimgImages.value.entries.map((entry: any) => entry.name));
for (const model of modelData.models) for (const resource of model.resources) {
  if (!available.has(model.name + '/' + resource.name)) throw new Error('Prepared PIMG image is missing');
}
function url(file: string): string { return path.relative(output, file).split(path.sep).map(encodeURIComponent).join('/'); }
const descriptor = { schemaVersion: 1, format: 'senren-web-graphics-v1',
  regularImages: { url: url(regular.resolved), count: regular.value.entries.length, bytes: regular.bytes },
  pimgImages: { url: url(pimgImages.resolved), count: pimgImages.value.entries.length, bytes: pimgImages.bytes },
  pimgModels: { url: url(modelPath), count: modelData.models.length },
  totals: { images: regular.value.entries.length + pimgImages.value.entries.length,
    converted: regular.value.converted + pimgImages.value.converted, copied: regular.value.copied + pimgImages.value.copied,
    imageBytes: regular.bytes + pimgImages.bytes } };
await writeFile(path.join(output, 'graphics.json'), JSON.stringify(descriptor, null, 2), { flag: 'wx' });
console.log('Prepared graphics index: images=' + descriptor.totals.images + '; PIMG models=' + descriptor.pimgModels.count);
