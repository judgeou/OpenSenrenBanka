import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseTjsData, DataSymbol } from '../src/formats/tjs-data.ts';
import { delimitedRows } from '../src/formats/delimited.ts';
const [output, ...roots] = process.argv.slice(2); const aliasAt = roots.indexOf('--aliases'), aliasesFile = aliasAt < 0 ? undefined : roots[aliasAt+1]; if (aliasAt >= 0) roots.splice(aliasAt,2);
if (!output || !roots.length || aliasAt >= 0 && !aliasesFile) throw new Error('Expected new image definition output, ordered source roots and optional aliases');
const selected = new Map<string, any>();
for (const root of roots) { const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  for (const entry of manifest.entries) if (/[.](stand|event)$/iu.test(entry.name) || /_info[.]txt$/iu.test(entry.name) || /(?:imageevalmap|imagediffmap)[.]csv$/iu.test(entry.name) || /(?:^|[/])base[.]stage$/iu.test(entry.name)) {
    if (!/^[0-9]+[.]bin$/u.test(entry.file)) throw new Error('Unsafe source file'); const name = entry.name.replaceAll('\\','/').split('/').at(-1); selected.set(name.toLowerCase(), { ...entry, sourceRoot: root, basename: name });
  }
}
const aliases: object[] = [];
if (aliasesFile) { const data = JSON.parse(await readFile(aliasesFile,'utf8')); if (data.schemaVersion !== 1 || !Array.isArray(data.aliases)) throw new Error('Invalid explicit resource aliases');
  for (const alias of data.aliases) {
    if (typeof alias.from !== 'string' || typeof alias.to !== 'string' || /[/\\]/u.test(alias.to) || selected.has(alias.to.toLowerCase())) throw new Error('Invalid or duplicate resource alias');
    const source = selected.get(alias.from.toLowerCase()); if (!source || source.sha256 !== alias.sourceSha256) throw new Error('Explicit alias source hash mismatch');
    selected.set(alias.to.toLowerCase(),{...source,basename:alias.to,aliasOf:alias.from}); aliases.push(alias);
  }
}
const definitions: object[] = [], tables: object[] = [], errors: object[] = [], kinds: Record<string,number> = Object.create(null);
for (const entry of selected.values()) {
  try { const bytes = await readFile(path.join(entry.sourceRoot, entry.file));
    const source = bytes[0] === 255 && bytes[1] === 254 ? new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const row = { name: entry.basename, sourceName: entry.name, sourceRoot: entry.sourceRoot, sourceFile: entry.file, aliasOf: entry.aliasOf, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
    if (/[.](stand|event|stage)$/iu.test(entry.basename)) definitions.push({ ...row, value: parseTjsData(source) });
    else { const rows = delimitedRows(source, /[.]txt$/iu.test(entry.basename) ? '\t' : ',').filter(row => row.cells.some(cell => cell !== '') && !row.cells[0].startsWith('#'));
      if (/_info[.]txt$/iu.test(entry.basename)) for (const row of rows) kinds[row.cells[0].toLowerCase()] = (kinds[row.cells[0].toLowerCase()] ?? 0)+1;
      tables.push({ ...row, rows });
    }
  } catch (error) { errors.push({ name: entry.name, error: error instanceof Error ? error.message : String(error) }); }
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, format: 'senren-image-definitions-v1', definitions, tables, kinds, aliases, failed: errors.length, errors }, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value instanceof DataSymbol ? { $symbol: value.name } : value, 2), { flag: 'wx' });
console.log('Prepared image definitions=' + definitions.length + '; tables=' + tables.length + '; failed=' + errors.length + '; table kinds=' + JSON.stringify(kinds)); if (errors.length) process.exitCode = 1;
