import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsbMetadata } from './resources/psb-metadata.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, requestedOutput, ...directories] = process.argv.slice(2);
if (!gameRoot || !requestedOutput || directories.length === 0) throw new Error('Expected game root, new output directory, and raw export directories');
const output = await newOutputDirectory(gameRoot, requestedOutput);
const packages: object[] = [], models: object[] = [];
const totals = { packages: 0, entries: 0, exported: 0, unexported: 0, bytes: 0, modelRecords: 0, modelMetadataErrors: 0 };
for (const directory of directories) {
  const root = await realpath(directory);
  const report = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (report.schemaVersion !== 1 || !['offline-xp3-resource-export-v1', 'offline-evb-resource-export-v1'].includes(report.format) || !Array.isArray(report.entries)) {
    throw new Error('Unknown raw asset report');
  }
  const extensions: Record<string, number> = Object.create(null);
  let bytes = 0;
  for (const entry of report.entries) {
    const extension = path.extname(entry.name).toLowerCase();
    extensions[extension] = (extensions[extension] ?? 0) + 1;
    if (entry.state === 'exported') bytes += entry.bytes;
    if (!['.mtn', '.pimg', '.scn'].includes(extension)) continue;
    totals.modelRecords += 1;
    const row: Record<string, unknown> = { source: report.source, name: entry.name,
      root, file: entry.file, bytes: entry.bytes, prefixHex: entry.prefixHex, state: entry.state };
    try {
      if (entry.state !== 'exported' || typeof entry.file !== 'string' || !/^[0-9]+[.]bin$/u.test(entry.file)) {
        throw new Error('Model resource is not exported');
      }
      const source = await readPsbMetadata(path.join(root, entry.file));
      const reader = source.reader;
      row.decodedBytes = source.completeBytes; row.metadataBytes = source.metadataBytes;
      row.envelope = source.envelope; row.magic = '50534200';
      row.version = reader.header.version; row.flags = reader.header.flags;
      const node = reader.node(reader.header.root);
      row.rootKeys = node.kind === 'object' ? node.entries.map(field => field.key) : [];
      row.rootFields = node.kind === 'object' ? node.entries.map(field => {
        const value = reader.node(field.valueOffset);
        return { name: field.key, sourceRef: field.valueOffset, kind: value.kind,
          ...(value.kind === 'array' ? { count: value.items.length } : {}),
          ...(value.kind === 'object' ? { keys: value.entries.map(item => item.key) } : {}) };
      }) : [];
      row.resourceCount = reader.resourceCount; row.stringCount = reader.stringCount;
      row.resources = Array.from({ length: reader.resourceCount }, (_, index) => reader.resource(index));
    } catch (error) { row.error = error instanceof Error ? error.message : String(error); totals.modelMetadataErrors += 1; }
    models.push(row);
  }
  totals.packages += 1; totals.entries += report.entries.length; totals.exported += report.exported;
  totals.unexported += report.failed; totals.bytes += bytes;
  packages.push({ source: report.source, root, sourceBytes: report.sourceBytes, cipher: report.cipher,
    entries: report.entries.length, exported: report.exported, unexported: report.failed, bytes, extensions });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, totals, packages }, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'model-metadata.json'), JSON.stringify({ schemaVersion: 1, models }, null, 2), { flag: 'wx' });
console.log('Indexed ' + totals.entries + ' raw assets; model records=' + totals.modelRecords + '; metadata errors=' + totals.modelMetadataErrors);
