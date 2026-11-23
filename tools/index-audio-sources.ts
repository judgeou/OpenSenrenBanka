import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [output, ...roots] = process.argv.slice(2); if (!output || !roots.length) throw new Error('Expected new metadata output and raw archive roots');
const archives: object[] = [];
for (const root of roots) {
  const report = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), extensions: Record<string, number> = Object.create(null);
  const examples: Record<string, object> = Object.create(null);
  for (const entry of report.entries) { const extension = path.extname(entry.name).toLowerCase(); extensions[extension] = (extensions[extension] ?? 0) + 1;
    examples[extension] ??= { name: entry.name, file: entry.file, bytes: entry.bytes, prefixHex: entry.prefixHex }; }
  archives.push({ root, entries: report.entries.length, extensions, examples });
}
await writeFile(output, JSON.stringify({ archives }, null, 2), { flag: 'wx' });
console.log('Indexed audio source extensions: archives=' + archives.length);
