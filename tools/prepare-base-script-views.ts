import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newOutputDirectory } from './resources/output-directory.ts';

interface ExportRow { index: number; name: string; state: string; file: string | null; bytes: number; prefixHex: string; error: string | null }
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--source', '--game-root', '--output'].includes(key) || !value || options.has(key)) throw new Error('Invalid script-view option');
  options.set(key, value);
}
if (options.size !== 3) throw new Error('Expected --source, --game-root and --output');
const source = await realpath(options.get('--source')!);
const output = await newOutputDirectory(options.get('--game-root')!, options.get('--output')!);
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.format !== 'offline-xp3-resource-export-v1' || !Array.isArray(manifest.entries)) {
  throw new Error('Unsupported raw resource manifest');
}
const scriptExtensions = new Set(['.ks', '.tjs', '.txt', '.asd', '.stand', '.asdtxt', '.dpt', '.sli', '.func', '.stage', '.csv', '.ini', '.stand', '.event']);
const extensionCounts: Record<string, number> = Object.create(null);
const models: object[] = [], views: object[] = [], unavailable: object[] = [];
let converted = 0, bytecode = 0, unknown = 0;
for (const entry of manifest.entries as ExportRow[]) {
  const extension = path.extname(entry.name).toLowerCase();
  extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
  if (['.mtn', '.pimg', '.scn'].includes(extension)) models.push({ name: entry.name, file: entry.file, bytes: entry.bytes, prefixHex: entry.prefixHex });
  if (!scriptExtensions.has(extension)) continue;
  if (entry.state !== 'exported' || !entry.file || !/^[0-9]+[.]bin$/u.test(entry.file)) {
    unavailable.push({ name: entry.name, error: entry.error ?? 'Entry is not exported' }); continue;
  }
  const bytes = await readFile(path.join(source, entry.file));
  let encoding: string | null = null, classification = 'unknown';
  const magic = bytes.subarray(0, 8).toString('ascii');
  if (magic.startsWith('TJS2')) { classification = 'tjs-bytecode'; bytecode += 1; }
  else if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
  else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
  else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) encoding = 'utf-8';
  else if (bytes.every(byte => byte < 128)) encoding = 'utf-8';
  if (encoding !== null) {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const file = String(entry.index).padStart(5, '0') + '.utf8.txt';
    await writeFile(path.join(output, file), text, { flag: 'wx' });
    converted += 1; classification = 'text';
    views.push({ name: entry.name, sourceFile: entry.file, view: file, bytes: entry.bytes, encoding, classification });
  } else {
    if (classification === 'unknown') unknown += 1;
    views.push({ name: entry.name, sourceFile: entry.file, bytes: entry.bytes, classification, prefixHex: entry.prefixHex });
  }
}
const summary = { schemaVersion: 1, source, sourceArchive: manifest.source, sourceCipher: manifest.cipher,
  directoryEntries: manifest.entries.length, convertedScripts: converted, bytecodeScripts: bytecode, unknownEncodingScripts: unknown,
  extensionCounts, unavailable, views, modelHeaders: models };
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log('Converted script views=' + converted + '; bytecode=' + bytecode + '; unknown encoding=' + unknown);
console.log('Output: ' + output);
