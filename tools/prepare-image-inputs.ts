import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, requestedOutput, ...sources] = process.argv.slice(2);
if (!gameRoot || !requestedOutput || sources.length === 0) throw new Error('Expected game root, new output, and raw export directories');
const output = await newOutputDirectory(gameRoot, requestedOutput);
const selected = new Map<string, { name: string; root: string; file: string; package: string; sha256: string; bytes: number }>();
function virtualName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Missing image name');
  const parts = name.replaceAll(String.fromCharCode(92), '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || [...part].some(char =>
    char.charCodeAt(0) < 32 || '<>:"|?*'.includes(char)))) throw new Error('Unsafe image path');
  return parts.join('/');
}
for (const directory of sources) {
  const root = await realpath(directory);
  const report = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (!['offline-xp3-resource-export-v1', 'offline-evb-resource-export-v1'].includes(report.format) || !Array.isArray(report.entries)) throw new Error('Unsupported raw export report');
  for (const entry of report.entries) {
    if (!['.tlg', '.png', '.jpg', '.jpeg', '.bmp'].includes(path.extname(entry.name).toLowerCase())) continue;
    if (entry.state !== 'exported' || !/^[0-9]+[.]bin$/u.test(entry.file)) throw new Error('Image entry was not exported');
    const name = virtualName(entry.name);
    selected.set(name.toLowerCase(), { name, root, file: entry.file, package: report.source, sha256: entry.sha256, bytes: entry.bytes });
  }
}
const rows: object[] = [];
let tlgCount = 0, copiedBytes = 0;
for (const [index, entry] of [...selected.values()].entries()) {
  const destination = path.join(output, ...entry.name.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(entry.root, entry.file), destination, constants.COPYFILE_EXCL);
  const isTlg = path.extname(entry.name).toLowerCase() === '.tlg';
  if (isTlg) tlgCount += 1; copiedBytes += entry.bytes;
  rows.push({ id: String(index + 1).padStart(5, '0'), name: entry.name, file: entry.name, isTlg,
    sourcePackage: entry.package, sourceFile: path.join(entry.root, entry.file), sha256: entry.sha256, bytes: entry.bytes });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'named-image-inputs-v1',
  totalImages: rows.length, tlgCount, copiedBytes, entries: rows }, null, 2), { flag: 'wx' });
console.log('Prepared ' + rows.length + ' original-named image inputs; TLG=' + tlgCount);
