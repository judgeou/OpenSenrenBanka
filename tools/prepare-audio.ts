import { constants } from 'node:fs';
import { copyFile, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { oggAudioInfo } from '../src/formats/ogg-audio.ts';
import { parseSli } from '../src/formats/sli.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, requestedOutput, ...layers] = process.argv.slice(2); if (!gameRoot || !requestedOutput || !layers.length) throw new Error('Expected game root, new output and ordered raw audio layers');
const output = await newOutputDirectory(gameRoot, requestedOutput), selected = new Map<string, any>(), loops = new Map<string, any>();
const key = (value: string) => value.replaceAll(String.fromCharCode(92), '/').toLowerCase();
for (const layer of layers) {
  const root = await realpath(layer), report = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (report.format !== 'offline-xp3-resource-export-v1' || report.failed !== 0) throw new Error('Incomplete raw audio layer');
  for (const entry of report.entries) {
    if (report.scope === 'audio-names' && entry.state === 'cataloged') continue;
    const extension = path.extname(entry.name).toLowerCase(); if (!['.ogg', '.opus', '.sli'].includes(extension)) continue;
    if (entry.state !== 'exported' || !/^[0-9]+[.]bin$/u.test(entry.file)) throw new Error('Unavailable audio source');
    (extension === '.sli' ? loops : selected).set(key(entry.name), { entry, root });
  }
}
const entries: any[] = [], sourceWarnings: object[] = []; let failed = 0; const codecs: Record<string, number> = Object.create(null);
for (const item of selected.values()) {
  const entry = item.entry, row: any = { id: String(entries.length + 1).padStart(5, '0'), name: entry.name, state: 'unprepared' }; entries.push(row);
  try {
    const source = path.join(item.root, entry.file), bytes = await readFile(source); if (bytes.length > 256 * 1024 * 1024) throw new Error('Audio source exceeds budget');
    const info = oggAudioInfo(bytes), loop = loops.get(key(entry.name + '.sli')) ?? loops.get(key(entry.name.replace(/[.](ogg|opus)$/iu, '') + '.sli'));
    let loopData = undefined, loopEncoding: string | undefined;
    if (loop) {
      const data = await readFile(path.join(loop.root, loop.entry.file));
      if (data[0] === 79 && data[1] === 103 && data[2] === 103 && data[3] === 83) {
        const sidecarInfo = oggAudioInfo(data), sidecarFile = row.id + '.sidecar.ogg';
        await copyFile(path.join(loop.root, loop.entry.file), path.join(output, sidecarFile), constants.COPYFILE_EXCL);
        row.nonLoopSidecar = { file: sidecarFile, bytes: data.length, sha256: loop.entry.sha256, codec: sidecarInfo.codec };
        sourceWarnings.push({ name: entry.name, kind: 'audio-payload-in-sli', preservedFile: sidecarFile });
      } else {
      loopEncoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
      let sourceText: string;
      try { sourceText = new TextDecoder(loopEncoding, { fatal: true }).decode(data); }
      catch (error) { if (loopEncoding !== 'utf-8') throw error; loopEncoding = 'shift_jis'; sourceText = new TextDecoder(loopEncoding, { fatal: true }).decode(data); }
      loopData = parseSli(sourceText);
      }
    }
    row.file = row.id + '.ogg'; await copyFile(source, path.join(output, row.file), constants.COPYFILE_EXCL);
    Object.assign(row, { ...info, samples: String(info.samples), bytes: entry.bytes, sha256: entry.sha256, loops: loopData, loopEncoding, loopSha256: loop?.entry.sha256, state: 'prepared' });
    codecs[info.codec] = (codecs[info.codec] ?? 0) + 1;
  } catch (error) { row.error = error instanceof Error ? error.message : String(error); failed++; }
  if (entries.length % 2000 === 0) console.log('Audio records: ' + entries.length + '/' + selected.size);
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'prepared-web-audio-v1', entries: entries.length, failed, codecs, sourceWarnings, files: entries }, null, 2), { flag: 'wx' });
console.log('Prepared audio=' + (entries.length - failed) + '; failed=' + failed + '; codecs=' + JSON.stringify(codecs)); if (failed) process.exitCode = 1;
