import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, graphicsFile, motionDirectory, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !graphicsFile || !motionDirectory || !requestedOutput) throw new Error('Expected game root, graphics descriptor, motion directory, and new output');
const graphicsPath = await realpath(graphicsFile), motion = await realpath(motionDirectory);
const graphics = JSON.parse(await readFile(graphicsPath, 'utf8'));
const images = JSON.parse(await readFile(path.join(motion, 'manifest.json'), 'utf8'));
const models = JSON.parse(await readFile(path.join(motion, 'motion-models.json'), 'utf8'));
if (graphics.format !== 'senren-web-graphics-v1' || images.format !== 'prepared-web-images-v1' || images.failed !== 0 ||
    models.format !== 'prepared-mtn-metadata-v1' || models.failed !== 0 || models.models.some((model: any) => model.state !== 'prepared')) throw new Error('Incomplete graphics input');
const output = await newOutputDirectory(gameRoot, requestedOutput);
function relative(file: string) { return path.relative(output, file).split(path.sep).map(encodeURIComponent).join('/'); }
for (const field of ['regularImages', 'pimgImages', 'pimgModels']) graphics[field] = { ...graphics[field],
  url: relative(fileURLToPath(new URL(graphics[field].url, pathToFileURL(graphicsPath)))) };
const motionBytes = images.entries.reduce((sum: number, image: any) => sum + image.bytes, 0);
graphics.mtnImages = { url: relative(path.join(motion, 'manifest.json')), count: images.entries.length, bytes: motionBytes };
graphics.mtnModels = { url: relative(path.join(motion, 'motion-models.json')), count: models.models.length };
graphics.totals = { ...graphics.totals, images: graphics.totals.images + images.entries.length,
  converted: graphics.totals.converted + images.converted, imageBytes: graphics.totals.imageBytes + motionBytes };
await writeFile(path.join(output, 'graphics.json'), JSON.stringify(graphics, null, 2), { flag: 'wx' });
console.log('Graphics index: images=' + graphics.totals.images + '; motion models=' + models.models.length);
