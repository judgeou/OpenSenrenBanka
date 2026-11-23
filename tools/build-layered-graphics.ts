import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, requestedOutput, ...descriptorFiles] = process.argv.slice(2);
if (!gameRoot || !requestedOutput || descriptorFiles.length === 0) throw new Error('Expected game root, new output and ordered graphics descriptors');
const output = await newOutputDirectory(gameRoot, requestedOutput);
const overrides: object[] = [];
const regular = new Map<string, any>(), models = new Map<string, any>();
const normalized = (value: string) => value.replaceAll(String.fromCharCode(92), '/').toLowerCase();
async function json(file: string) { return JSON.parse(await readFile(file, 'utf8')); }
async function images(file: string) {
  const report = await json(file);
  if (report.schemaVersion !== 1 || report.format !== 'prepared-web-images-v1' || report.failed !== 0 || !Array.isArray(report.entries)) throw new Error('Incomplete image layer');
  return { report, root: path.dirname(file), byName: new Map(report.entries.map((entry: any) => [normalized(entry.name), entry])) };
}
for (const descriptorFile of descriptorFiles) {
  const layer = await realpath(descriptorFile), descriptor = await json(layer), base = pathToFileURL(layer);
  if (descriptor.schemaVersion !== 1 || descriptor.format !== 'senren-web-graphics-v1') throw new Error('Unknown graphics layer');
  const source = await images(fileURLToPath(new URL(descriptor.regularImages.url, base)));
  const pimg = await images(fileURLToPath(new URL(descriptor.pimgImages.url, base)));
  const modelFile = fileURLToPath(new URL(descriptor.pimgModels.url, base)), modelReport = await json(modelFile);
  if (modelReport.schemaVersion !== 1 || modelReport.format !== 'prepared-pimg-metadata-v1') throw new Error('Unknown PIMG layer');
  for (const entry of source.report.entries) {
    const key = normalized(entry.name), previous = regular.get(key);
    if (previous) overrides.push({ kind: 'image', name: entry.name, previous: previous.layer, selected: layer });
    regular.set(key, { entry, root: source.root, layer });
  }
  for (const model of modelReport.models) {
    const key = normalized(model.name), previous = models.get(key);
    if (previous) overrides.push({ kind: 'pimg', name: model.name, previous: previous.layer, selected: layer });
    models.set(key, { model, root: path.dirname(modelFile), images: pimg, layer });
  }
}
await mkdir(path.join(output, 'images')); await mkdir(path.join(output, 'pimg-images')); await mkdir(path.join(output, 'pimg'));
const regularRows: any[] = [], pimgRows: any[] = [], modelRows: object[] = [];
async function copyImage(entry: any, source: string, destination: string, rows: any[]) {
  if (!['copied', 'converted'].includes(entry.state) || !/^[0-9]+[.](png|jpg|jpeg|bmp)$/u.test(entry.file)) throw new Error('Unprepared/unsafe image layer');
  const id = String(rows.length + 1).padStart(5, '0'), file = id + path.extname(entry.file);
  await copyFile(path.join(source, entry.file), path.join(output, destination, file), constants.COPYFILE_EXCL);
  const row = { ...entry, id, file }; rows.push(row); return row;
}
for (const item of regular.values()) await copyImage(item.entry, item.root, 'images', regularRows);
for (const item of models.values()) {
  const model = item.model, id = String(modelRows.length + 1).padStart(5, '0'), metadataFile = id + '.psbmeta';
  if (!/^[0-9]+[.]psbmeta$/u.test(model.metadataFile)) throw new Error('Unsafe PIMG metadata filename');
  await copyFile(path.join(item.root, model.metadataFile), path.join(output, 'pimg', metadataFile), constants.COPYFILE_EXCL);
  const resources: object[] = [];
  for (const resource of model.resources) {
    const image = item.images.byName.get(normalized(model.name + '/' + resource.name));
    if (!image) throw new Error('PIMG image is missing from its selected layer');
    const copied = await copyImage(image, item.images.root, 'pimg-images', pimgRows);
    resources.push({ ...resource, imageId: copied.id, targetFile: copied.file });
  }
  modelRows.push({ ...model, id, metadataFile, resources, selectedLayer: item.layer });
}
function report(entries: any[]) { return { schemaVersion: 1, format: 'prepared-web-images-v1',
  converted: entries.filter(entry => entry.state === 'converted').length, copied: entries.filter(entry => entry.state === 'copied').length,
  failed: 0, entries }; }
const regularReport = report(regularRows), pimgReport = report(pimgRows);
await writeFile(path.join(output, 'images', 'manifest.json'), JSON.stringify(regularReport, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'pimg-images', 'manifest.json'), JSON.stringify(pimgReport, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'pimg', 'pimg-models.json'), JSON.stringify({ schemaVersion: 1, format: 'prepared-pimg-metadata-v1', models: modelRows }, null, 2), { flag: 'wx' });
const imageBytes = [...regularRows, ...pimgRows].reduce((sum, row) => sum + row.bytes, 0);
const descriptor = { schemaVersion: 1, format: 'senren-web-graphics-v1', language: 'zh-Hans',
  regularImages: { url: 'images/manifest.json', count: regularRows.length },
  pimgImages: { url: 'pimg-images/manifest.json', count: pimgRows.length },
  pimgModels: { url: 'pimg/pimg-models.json', count: modelRows.length },
  totals: { images: regularRows.length + pimgRows.length, converted: regularReport.converted + pimgReport.converted,
    copied: regularReport.copied + pimgReport.copied, imageBytes },
  layerCount: descriptorFiles.length, overrides: overrides.length };
await writeFile(path.join(output, 'graphics.json'), JSON.stringify(descriptor, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'overrides.json'), JSON.stringify(overrides, null, 2), { flag: 'wx' });
console.log('Layered graphics: images=' + descriptor.totals.images + '; PIMG=' + modelRows.length + '; overrides=' + overrides.length);
