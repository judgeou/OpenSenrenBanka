import { Psb2Reader } from '../formats/psb2/reader.ts';
import type { PsbNode } from '../formats/psb2/types.ts';
import type { ImageCatalog } from './image-catalog.ts';
import type { ImageLease } from './image-types.ts';

interface PimgResource { readonly name: string; readonly resourceIndex: number; readonly sourceOffset: number; readonly sourceBytes: number; readonly imageId: string; readonly targetFile: string }
interface PimgEntry { readonly id: string; readonly name: string; readonly metadataFile: string; readonly metadataBytes: number; readonly metadataSha256: string; readonly sourceByteLength: number; readonly resources: readonly PimgResource[] }
function normalized(name: string): string { return name.replaceAll(String.fromCharCode(92), '/').toLowerCase(); }
function parseEntry(value: unknown): PimgEntry {
  if (!value || typeof value !== 'object') throw new Error('Invalid PIMG record');
  const row = value as Record<string, any>;
  if (typeof row.id !== 'string' || !/^[0-9]+$/u.test(row.id) || typeof row.name !== 'string' || !row.name ||
      typeof row.metadataFile !== 'string' || !/^[0-9]+[.]psbmeta$/u.test(row.metadataFile) ||
      typeof row.metadataSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.metadataSha256) ||
      !Number.isSafeInteger(row.metadataBytes) || row.metadataBytes < 40 || row.metadataBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(row.sourceByteLength) || row.sourceByteLength < row.metadataBytes || !Array.isArray(row.resources)) {
    throw new Error('Invalid prepared PIMG metadata');
  }
  const seen = new Set<string>();
  const resources = row.resources.map((item: unknown): PimgResource => {
    if (!item || typeof item !== 'object') throw new Error('Invalid PIMG resource');
    const resource = item as Record<string, any>;
    if (typeof resource.name !== 'string' || !resource.name || seen.has(resource.name) ||
        !Number.isSafeInteger(resource.resourceIndex) || resource.resourceIndex < 0 ||
        !Number.isSafeInteger(resource.sourceOffset) || resource.sourceOffset < row.metadataBytes ||
        !Number.isSafeInteger(resource.sourceBytes) || resource.sourceBytes < 0 ||
        !Number.isSafeInteger(resource.sourceOffset + resource.sourceBytes) ||
        resource.sourceOffset + resource.sourceBytes > row.sourceByteLength ||
        typeof resource.imageId !== 'string' || !/^[0-9]+$/u.test(resource.imageId) ||
        typeof resource.targetFile !== 'string' || !/^[0-9]+[.](png|jpg|jpeg|bmp|webp)$/u.test(resource.targetFile)) throw new Error('Invalid PIMG resource range');
    seen.add(resource.name); return Object.freeze({ ...resource }) as PimgResource;
  });
  return Object.freeze({ id: row.id, name: row.name, metadataFile: row.metadataFile, metadataBytes: row.metadataBytes,
    metadataSha256: row.metadataSha256, sourceByteLength: row.sourceByteLength, resources: Object.freeze(resources) });
}

/** Original binary metadata plus separately prepared image layers; no compositing here. */
export class PimgDocument {
  readonly reader: Psb2Reader;
  readonly name: string;
  readonly resources: readonly PimgResource[];
  private readonly images: ImageCatalog;
  constructor(reader: Psb2Reader, entry: PimgEntry, images: ImageCatalog) {
    const root = reader.node(reader.header.root);
    if (root.kind !== 'object') throw new Error('PIMG root is not a dictionary');
    for (const item of entry.resources) {
      const actual = reader.resource(item.resourceIndex);
      const ref = reader.property(root.offset, item.name);
      const value = ref === undefined ? undefined : reader.node(ref);
      if (actual.dataOffset !== item.sourceOffset || actual.length !== item.sourceBytes ||
          value?.kind !== 'resource' || value.index !== item.resourceIndex) throw new Error('PIMG resource identity mismatch');
    }
    this.reader = reader; this.name = entry.name; this.resources = entry.resources; this.images = images;
  }
  field(name: string): PsbNode | undefined {
    const ref = this.reader.property(this.reader.header.root, name);
    return ref === undefined ? undefined : this.reader.node(ref);
  }
  acquireImage(name: string): Promise<ImageLease> {
    if (!this.resources.some(resource => resource.name === name)) throw new Error('Unknown PIMG image: ' + name);
    return this.images.acquire(this.name + '/' + name);
  }
}

export class PimgCatalog {
  readonly entries: readonly PimgEntry[];
  private readonly base: URL;
  private readonly images: ImageCatalog;
  private readonly aliases = new Map<string, Set<PimgEntry>>();
  private readonly loaded = new Map<string, Promise<PimgDocument>>();
  private constructor(entries: PimgEntry[], base: URL, images: ImageCatalog) {
    this.entries = Object.freeze(entries); this.base = base; this.images = images;
    for (const entry of entries) {
      const name = normalized(entry.name), basename = name.slice(name.lastIndexOf('/') + 1);
      for (const alias of [name, basename, name.replace(/[.]pimg$/u, ''), basename.replace(/[.]pimg$/u, '')]) {
        const choices = this.aliases.get(alias) ?? new Set<PimgEntry>(); choices.add(entry); this.aliases.set(alias, choices);
      }
    }
  }
  static async open(manifestUrl: string | URL, images: ImageCatalog, signal?: AbortSignal): Promise<PimgCatalog> {
    const response = await fetch(manifestUrl, { signal });
    if (!response.ok) throw new Error('PIMG manifest HTTP ' + response.status);
    const value = await response.json();
    if (value?.schemaVersion !== 1 || value?.format !== 'prepared-pimg-metadata-v1' || !Array.isArray(value.models)) throw new Error('Unsupported PIMG manifest');
    return new PimgCatalog(value.models.map(parseEntry), new URL('.', response.url || String(manifestUrl)), images);
  }
  load(storage: string): Promise<PimgDocument> {
    const matches = this.aliases.get(normalized(storage));
    if (!matches || matches.size !== 1) throw new Error(matches ? 'Ambiguous PIMG: ' + storage : 'Unknown PIMG: ' + storage);
    const entry = matches.values().next().value!;
    const existing = this.loaded.get(entry.id); if (existing) return existing;
    const pending = this.read(entry).catch(error => {
      if (this.loaded.get(entry.id) === pending) this.loaded.delete(entry.id);
      throw error;
    });
    this.loaded.set(entry.id, pending); return pending;
  }
  clear(): void { this.loaded.clear(); }
  private async read(entry: PimgEntry): Promise<PimgDocument> {
    const response = await fetch(new URL(entry.metadataFile, this.base));
    if (!response.ok) throw new Error('PIMG metadata HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.metadataBytes) throw new Error('PIMG metadata length mismatch');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.metadataSha256) throw new Error('PIMG metadata hash mismatch');
    return new PimgDocument(new Psb2Reader(new Uint8Array(bytes), {}, entry.sourceByteLength), entry, this.images);
  }
}
