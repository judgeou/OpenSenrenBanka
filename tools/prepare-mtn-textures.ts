import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mtnTextures } from '../src/graphics/mtn-textures.ts';
import { decodeWinTexture } from '../src/graphics/win-texture.ts';
import { readPsbMetadata } from './resources/psb-metadata.ts';
import { ByteReader } from './resources/byte-reader.ts';
import { rgbaPng } from './resources/png-rgba.ts';
import { newOutputDirectory } from './resources/output-directory.ts';

const [gameRoot, catalogFile, requestedOutput] = process.argv.slice(2);
if (!gameRoot || !catalogFile || !requestedOutput) throw new Error('Expected game root, model catalog and new output directory');
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new Error('Invalid model catalog');
const selected = new Map<string, any>();
for (const item of catalog.models) if (path.extname(item.name).toLowerCase() === '.mtn') selected.set(item.name.toLowerCase(), item);
const output = await newOutputDirectory(gameRoot, requestedOutput), entries: any[] = [], models: any[] = [];
const formats: Record<string, number> = Object.create(null);
let converted = 0, failed = 0;
for (const item of selected.values()) {
  const model: any = { name: item.name, source: item.source, textures: [], state: 'unprepared' }; models.push(model);
  try {
    if (item.error || !/^[0-9]+[.]bin$/u.test(item.file)) throw new Error('Unavailable MTN input');
    const sourceFile = path.join(item.root, item.file), source = await readPsbMetadata(sourceFile), reader = source.reader;
    if (source.envelope !== 'raw') throw new Error('MTN texture extraction requires an unwrapped source');
    const specRef = reader.property(reader.header.root, 'spec'), spec = specRef === undefined ? undefined : reader.node(specRef);
    if (spec?.kind !== 'string' || !['win', 'krkr'].includes(spec.value)) throw new Error('Unsupported MTN platform: ' + (spec?.kind === 'string' ? spec.value : 'missing'));
    const id = String(models.length).padStart(5, '0'), metadataFile = id + '.psbmeta';
    await writeFile(path.join(output, metadataFile), source.metadata, { flag: 'wx' });
    Object.assign(model, { metadataFile, metadataBytes: source.metadataBytes, sourceByteLength: source.completeBytes,
      metadataSha256: createHash('sha256').update(source.metadata).digest('hex'), platform: spec.value });
    const textures = mtnTextures(reader), binary = await ByteReader.open(sourceFile);
    try {
      for (const texture of textures) {
        formats[texture.format] = (formats[texture.format] ?? 0) + 1;
        const row: any = { id: String(entries.length + 1).padStart(5, '0'), name: item.name + '/' + texture.key, state: 'unprepared' };
        entries.push(row);
        try {
          const range = reader.resource(texture.pixelIndex);
          if (range.length > 256 * 1024 * 1024) throw new Error('MTN texture input budget exceeded');
          const packed = Buffer.alloc(range.length);
          for (let copied = 0; copied < packed.length;) {
            const bytes = await binary.read(range.dataOffset + copied, Math.min(1024 * 1024, packed.length - copied));
            packed.set(bytes, copied); copied += bytes.length;
          }
          let palette: Buffer | undefined;
          if (texture.paletteIndex !== undefined) {
            const colors = reader.resource(texture.paletteIndex);
            if (colors.length !== 1024) throw new Error('Unsupported MTN palette byte length');
            palette = await binary.read(colors.dataOffset, colors.length);
          }
          const png = rgbaPng(texture.width, texture.height, decodeWinTexture(texture, packed, palette));
          row.file = row.id + '.png'; await writeFile(path.join(output, row.file), png, { flag: 'wx' });
          Object.assign(row, { state: 'converted', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
            sourceSha256: createHash('sha256').update(packed).digest('hex'), width: texture.width, height: texture.height,
            offsetX: texture.originX, offsetY: texture.originY, sourceOffsetX: texture.originX, sourceOffsetY: texture.originY,
            pixelFormat: 'Rgba32', sourceTags: [] });
          model.textures.push({ ...texture, imageId: row.id, imageFile: row.file }); converted += 1;
        } catch (error) { row.error = error instanceof Error ? error.message : String(error); failed += 1; }
      }
      await binary.requireUnchanged();
    } finally { await binary.close(); }
    model.state = model.textures.length === textures.length ? 'prepared' : 'incomplete';
  } catch (error) { model.error = error instanceof Error ? error.message : String(error); failed += 1; }
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, format: 'prepared-web-images-v1',
  source: catalogFile, converted, copied: 0, failed, entries }, null, 2), { flag: 'wx' });
await writeFile(path.join(output, 'motion-models.json'), JSON.stringify({ schemaVersion: 1, format: 'prepared-mtn-metadata-v1',
  modelCount: models.length, formats, converted, failed, models }, null, 2), { flag: 'wx' });
console.log('Prepared MTN models=' + models.length + '; textures=' + converted + '; failed=' + failed);
console.log('Texture formats: ' + JSON.stringify(formats));
if (failed > 0) process.exitCode = 1;
