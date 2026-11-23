import { constants } from 'node:fs';
import { copyFile, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newOutputDirectory } from './resources/output-directory.ts';

const [viewsDirectory, gameRoot, requestedOutput] = process.argv.slice(2);
if (!viewsDirectory || !gameRoot || !requestedOutput) throw new Error('Expected views directory, game root, and new output directory');
const views = await realpath(viewsDirectory);
const manifest = JSON.parse(await readFile(path.join(views, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.views) || typeof manifest.source !== 'string') {
  throw new Error('Invalid script view manifest');
}
const output = await newOutputDirectory(gameRoot, requestedOutput);
const files: object[] = [];
for (const entry of manifest.views) {
  if (entry.classification !== 'tjs-bytecode') continue;
  if (typeof entry.sourceFile !== 'string' || !/^[0-9]+[.]bin$/u.test(entry.sourceFile)) throw new Error('Unsafe bytecode filename');
  const file = entry.sourceFile.slice(0, -4) + '.tjs';
  await copyFile(path.join(manifest.source, entry.sourceFile), path.join(output, file), constants.COPYFILE_EXCL);
  files.push({ name: entry.name, sourceFile: entry.sourceFile, file, assembly: file.slice(0, -4) + '.tjsasm' });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, source: manifest.source, files }, null, 2), { flag: 'wx' });
console.log('Prepared ' + files.length + ' bytecode files for static disassembly');
