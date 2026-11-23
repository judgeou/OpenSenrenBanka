import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DataSymbol, parseTjsData } from '../src/formats/tjs-data.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, requestedOutput, ...files] = process.argv.slice(2);
if (!gameRoot || !requestedOutput || !files.length) throw new Error('Expected game root, new output and data files');
const output = await newOutputDirectory(gameRoot, requestedOutput), records: object[] = []; let failed = 0;
for (const file of files) {
  try {
    const data = parseTjsData(await readFile(file, 'utf8')), name = path.basename(file) + '.json';
    await writeFile(path.join(output, name), JSON.stringify(data, (_key, value) => value instanceof DataSymbol ? { $symbol: value.name } : typeof value === 'bigint' ? { $integer: String(value) } : value === undefined ? { $void: true } : value, 2), { flag: 'wx' });
    records.push({ source: file, file: name, state: 'compiled' });
  } catch (error) { failed++; records.push({ source: file, state: 'unprepared', error: error instanceof Error ? error.message : String(error) }); }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, count: files.length, failed, records }, null, 2), { flag: 'wx' });
console.log('Compiled data definitions=' + (files.length - failed) + '; failed=' + failed); if (failed) process.exitCode = 1;
