import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [manifestFile] = process.argv.slice(2); if (!manifestFile) throw new Error('Expected control manifest');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), root = path.dirname(manifestFile);
const targets: Record<string, { count: number; keys: Record<string, number> }> = Object.create(null), labels: Record<string, number> = Object.create(null);
let numeric = 0, named = 0;
for (const asset of manifest.records) {
  if (asset.state !== 'compiled') throw new Error('Incomplete control corpus');
  const data = JSON.parse(await readFile(path.join(root, asset.file), 'utf8'));
  for (const command of data.commands) {
    const target = targets[command.target] ??= { count: 0, keys: Object.create(null) }; target.count++;
    for (const key of command.keys) target.keys[key] = (target.keys[key] ?? 0) + 1;
    if (command.deferred?.kind === 'integer') numeric++;
    if (command.deferred?.kind === 'label') { named++; labels[command.deferred.value] = (labels[command.deferred.value] ?? 0) + 1; }
  }
}
await writeFile(path.join(root, 'command-schema.json'), JSON.stringify({ numericDeferred: numeric, namedDeferred: named, labels, targets }, null, 2), { flag: 'wx' });
console.log('Prepared command schema: targets=' + Object.keys(targets).length + '; deferred numeric=' + numeric + '; named=' + named);
