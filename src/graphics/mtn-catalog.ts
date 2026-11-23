import { Psb2Reader } from '../formats/psb2/reader.ts';
import type { PsbNode } from '../formats/psb2/types.ts';
import type { MtnTexture } from './mtn-textures.ts';
import { mtnProgram } from './mtn-program.ts';
import type { MtnProgram } from './mtn-program.ts';
import type { ImageCatalog } from './image-catalog.ts';
import type { ImageLease } from './image-types.ts';

interface PreparedTexture extends MtnTexture { readonly imageId: string; readonly imageFile: string }
interface MtnRecord { readonly name: string; readonly metadataFile: string; readonly metadataBytes: number; readonly metadataSha256: string; readonly sourceByteLength: number; readonly textures: readonly PreparedTexture[] }
function key(value: string): string { return value.replaceAll(String.fromCharCode(92), '/').toLowerCase(); }
function parse(value: any): MtnRecord {
  if (!value || value.state !== 'prepared' || typeof value.name !== 'string' || !value.name ||
      typeof value.metadataFile !== 'string' || !/^[0-9]+[.]psbmeta$/u.test(value.metadataFile) ||
      typeof value.metadataSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.metadataSha256) ||
      !Number.isSafeInteger(value.metadataBytes) || value.metadataBytes < 44 || value.metadataBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(value.sourceByteLength) || value.sourceByteLength < value.metadataBytes || !Array.isArray(value.textures)) throw new Error('Invalid prepared MTN metadata');
  const keys = new Set<string>();
  const textures = value.textures.map((texture: any) => {
    if (!texture || typeof texture.key !== 'string' || !texture.key || keys.has(texture.key) ||
        !Number.isSafeInteger(texture.pixelIndex) || texture.pixelIndex < 0 ||
        !Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height) || texture.width < 1 || texture.height < 1 ||
        !Number.isSafeInteger(texture.fullWidth) || !Number.isSafeInteger(texture.fullHeight) || texture.fullWidth < texture.width || texture.fullHeight < texture.height ||
        typeof texture.imageFile !== 'string' || !/^[0-9]+[.](png|webp)$/u.test(texture.imageFile)) throw new Error('Invalid MTN texture metadata');
    keys.add(texture.key); return Object.freeze({ ...texture }) as PreparedTexture;
  });
  return Object.freeze({ name: value.name, metadataFile: value.metadataFile, metadataBytes: value.metadataBytes,
    metadataSha256: value.metadataSha256, sourceByteLength: value.sourceByteLength, textures: Object.freeze(textures) });
}

/** Lossless source metadata plus prepared textures. Motion evaluation is a separate timeline. */
export class MtnDocument {
  readonly reader: Psb2Reader; readonly name: string; readonly textures: readonly PreparedTexture[];
  private readonly images: ImageCatalog; private readonly programs = new Map<string, MtnProgram>();
  constructor(reader: Psb2Reader, record: MtnRecord, images: ImageCatalog) {
    if (reader.node(reader.header.root).kind !== 'object') throw new Error('MTN root is not a dictionary');
    this.reader = reader; this.name = record.name; this.textures = record.textures; this.images = images;
  }
  field(name: string): PsbNode | undefined {
    const ref = this.reader.property(this.reader.header.root, name); return ref === undefined ? undefined : this.reader.node(ref);
  }
  motionProgram(objectName: string, motionName: string): MtnProgram {
    const key = JSON.stringify([objectName, motionName]), cached = this.programs.get(key); if (cached) return cached;
    const program = mtnProgram(this.reader, objectName, motionName); this.programs.set(key, program); return program;
  }
  acquireTexture(textureKey: string): Promise<ImageLease> {
    if (!this.textures.some(texture => texture.key === textureKey)) throw new Error('Unknown MTN texture: ' + textureKey);
    return this.images.acquire(this.name + '/' + textureKey);
  }
}

export class MtnCatalog {
  readonly entries: readonly MtnRecord[];
  private readonly aliases = new Map<string, Set<MtnRecord>>();
  private readonly loaded = new Map<string, Promise<MtnDocument>>();
  private readonly base: URL; private readonly images: ImageCatalog;
  private constructor(entries: MtnRecord[], base: URL, images: ImageCatalog) {
    this.base = base; this.images = images; this.entries = Object.freeze(entries);
    for (const entry of entries) {
      const full = key(entry.name), basename = full.slice(full.lastIndexOf('/') + 1);
      for (const alias of [full, basename, full.replace(/[.]mtn$/u, ''), basename.replace(/[.]mtn$/u, '')]) {
        const choices = this.aliases.get(alias) ?? new Set<MtnRecord>(); choices.add(entry); this.aliases.set(alias, choices);
      }
    }
  }
  static async open(url: string | URL, images: ImageCatalog, signal?: AbortSignal): Promise<MtnCatalog> {
    const response = await fetch(url, { signal }); if (!response.ok) throw new Error('MTN manifest HTTP ' + response.status);
    const value = await response.json();
    if (value?.schemaVersion !== 1 || value?.format !== 'prepared-mtn-metadata-v1' || value.failed !== 0 || !Array.isArray(value.models)) throw new Error('Incomplete MTN metadata manifest');
    return new MtnCatalog(value.models.map(parse), new URL('.', response.url || String(url)), images);
  }
  load(storage: string): Promise<MtnDocument> {
    const choices = this.aliases.get(key(storage));
    if (!choices || choices.size !== 1) throw new Error(choices ? 'Ambiguous MTN: ' + storage : 'Unknown MTN: ' + storage);
    const entry = choices.values().next().value!, existing = this.loaded.get(entry.name); if (existing) return existing;
    const pending = this.read(entry).catch(error => { if (this.loaded.get(entry.name) === pending) this.loaded.delete(entry.name); throw error; });
    this.loaded.set(entry.name, pending); return pending;
  }
  clear(): void { this.loaded.clear(); }
  private async read(entry: MtnRecord): Promise<MtnDocument> {
    let response: Response;
    try { response = await fetch(new URL(entry.metadataFile, this.base)); }
    catch (error) { throw new Error('MTN metadata could not be fetched: ' + entry.name, { cause: error }); }
    if (!response.ok) throw new Error('MTN metadata HTTP ' + response.status + ': ' + entry.name);
    const bytes = await response.arrayBuffer(); if (bytes.byteLength !== entry.metadataBytes) throw new Error('MTN metadata length mismatch');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.metadataSha256) throw new Error('MTN metadata hash mismatch');
    return new MtnDocument(new Psb2Reader(new Uint8Array(bytes), {}, entry.sourceByteLength), entry, this.images);
  }
}
