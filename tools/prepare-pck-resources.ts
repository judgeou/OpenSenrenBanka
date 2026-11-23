import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ByteReader } from './resources/byte-reader.ts';
import { indexInlineEvb } from './resources/evb-index.ts';
import { readPlainEvbEntry } from './resources/read-entry.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, archive, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !archive || !requestedOutput || path.basename(archive) !== archive || !archive.toLowerCase().endsWith('.pck')) {
  throw new Error('Expected game root, PCK basename and new output directory');
}
const source = path.resolve(gameRoot, archive);
const index = await indexInlineEvb(source);
const output = await newOutputDirectory(gameRoot, requestedOutput);
const reader = await ByteReader.open(source);
const entries: object[] = [];
let exported = 0, failed = 0;
try {
  for (const entry of index.nodes) {
    if (entry.kind !== 'file') continue;
    const row: Record<string, unknown> = { index: entries.length, archivePath: entry.pathParts,
      offset: entry.payloadOffset, storedBytes: entry.storedBytes, expectedBytes: entry.originalBytes, state: 'unexported' };
    entries.push(row);
    try {
      const project = entry.pathParts.findIndex(part => part.toLowerCase() === 'project');
      if (entry.unsafeName || project < 0 || project === entry.pathParts.length - 1) throw new Error('Unsafe/unrecognized mounted resource path');
      row.name = entry.pathParts.slice(project + 1).join('/');
      const bytes = await readPlainEvbEntry(reader, entry, 256 * 1024 * 1024);
      row.file = String(entries.length - 1).padStart(5, '0') + '.bin';
      await writeFile(path.join(output, row.file as string), bytes, { flag: 'wx' });
      row.bytes = bytes.length; row.sha256 = createHash('sha256').update(bytes).digest('hex');
      row.prefixHex = bytes.toString('hex', 0, Math.min(16, bytes.length));
      row.state = 'exported'; exported += 1;
    } catch (error) { row.error = error instanceof Error ? error.message : String(error); failed += 1; }
  }
  await reader.requireUnchanged();
} finally { await reader.close(); }
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'offline-evb-resource-export-v1',
  source, sourceBytes: index.source.bytes, cipher: 'none', scope: 'all', metadataSha256: index.metadataSha256,
  exported, failed, entries }, null, 2), { flag: 'wx' });
console.log('Exported EVB entries=' + exported + '; failed=' + failed);
if (failed > 0) process.exitCode = 1;
