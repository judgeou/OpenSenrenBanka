import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { mtnProgram } from '../src/graphics/mtn-program.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, modelFile, requestedOutput] = process.argv.slice(2); if (!gameRoot || !modelFile || !requestedOutput) throw new Error('Expected game root, motion manifest and new output');
const manifest = JSON.parse(await readFile(modelFile, 'utf8')); if (manifest.format !== 'prepared-mtn-metadata-v1' || manifest.failed !== 0) throw new Error('Incomplete motion metadata');
const output = await newOutputDirectory(gameRoot, requestedOutput), records: object[] = [];
let motions = 0, tracks = 0, frames = 0, failed = 0;
for (const model of manifest.models) {
  try {
    if (!/^[0-9]+[.]psbmeta$/u.test(model.metadataFile)) throw new Error('Unsafe motion metadata filename');
    const reader = new Psb2Reader(await readFile(path.join(path.dirname(modelFile), model.metadataFile)), {}, model.sourceByteLength);
    const objectsRef = reader.property(reader.header.root, 'object'), objects = objectsRef === undefined ? undefined : reader.node(objectsRef);
    if (objects?.kind !== 'object') throw new Error('Missing motion objects'); const programs = [];
    for (const object of objects.entries) {
      const at = reader.property(object.valueOffset, 'motion'), collection = at === undefined ? undefined : reader.node(at);
      if (collection?.kind !== 'object') throw new Error('Missing object motion collection');
      for (const motion of collection.entries) {
        const program = mtnProgram(reader, object.key, motion.key); programs.push(program); motions++; tracks += program.tracks.length;
        for (const track of program.tracks) frames += track.frames.length;
      }
    }
    const file = String(records.length + 1).padStart(4, '0') + '.program.json';
    await writeFile(path.join(output, file), JSON.stringify({ name: model.name, programs }, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value, 2), { flag: 'wx' });
    records.push({ name: model.name, file, state: 'compiled', motions: programs.length });
  } catch (error) { failed++; records.push({ name: model.name, state: 'unprepared', error: error instanceof Error ? error.message : String(error) }); }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, models: records.length, motions, tracks, frames, failed, records }, null, 2), { flag: 'wx' });
console.log('Compiled motion programs: models=' + records.length + '; motions=' + motions + '; tracks=' + tracks + '; frames=' + frames + '; failed=' + failed);
if (failed) process.exitCode = 1;
