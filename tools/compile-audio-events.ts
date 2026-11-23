import { readFile, writeFile } from 'node:fs/promises';
import { audioTimeline } from '../src/audio/audio-timeline.ts';
const [manifestFile, output] = process.argv.slice(2); if (!manifestFile || !output) throw new Error('Expected audio metadata and new event output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), records = [], errors = [], names: Record<string, number> = Object.create(null), conditions: Record<string, number> = Object.create(null);
let labels = 0, links = 0, smooth = 0, loopFiles = 0, bytes = 0;
for (const file of manifest.files) {
  try { const timeline = audioTimeline({ ...file, loops: file.loops ?? [] });
    if (timeline.labels.length || timeline.links.length) { loopFiles++; records.push({ id: file.id, timeline }); }
    labels += timeline.labels.length; links += timeline.links.length; bytes += file.bytes;
    for (const label of timeline.labels) names[label.name] = (names[label.name] ?? 0) + 1;
    for (const link of timeline.links) { conditions[link.condition] = (conditions[link.condition] ?? 0) + 1; if (link.smooth) smooth++; }
  } catch (error) { errors.push({ id: file.id, name: file.name, error: error instanceof Error ? error.message : String(error) }); }
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, files: manifest.files.length, bytes, loopFiles, labels, links, smooth, names, conditions, failed: errors.length, errors, records }, null, 2), { flag: 'wx' });
console.log('Prepared audio event timelines: files=' + manifest.files.length + '; labels=' + labels + '; links=' + links + '; failed=' + errors.length); if (errors.length) process.exitCode = 1;
