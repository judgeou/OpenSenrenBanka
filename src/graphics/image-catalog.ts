import type { ImageCatalogOptions, ImageLease, PreparedImage } from './image-types.ts';
import type {PrefetchRequest,ResourcePrefetch} from '../runtime/resource-prefetch.ts';

interface ImageSlot { metadata: PreparedImage; holds: number; stamp: number; bytes: number; bitmap?: ImageBitmap; pending?: Promise<ImageBitmap> }
function key(value: string): string { return value.replaceAll(String.fromCharCode(92), '/').replace(/^[.][/]/u, '').toLowerCase(); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected image record');
  return value as Record<string, unknown>;
}
function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid image ' + name);
  return value;
}
function record(value: unknown): PreparedImage {
  const row = object(value);
  if (typeof row.id !== 'string' || !/^[0-9]+$/u.test(row.id) || typeof row.name !== 'string' || !row.name ||
      typeof row.file !== 'string' || !/^[0-9]+[.](png|jpg|jpeg|bmp|webp)$/u.test(row.file) ||
      typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256) ||
      (row.state !== 'converted' && row.state !== 'copied')) throw new Error('Invalid prepared image identity');
  const aliases = row.aliases === undefined ? [] : row.aliases;
  if (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string' || !alias || alias.includes('\u0000'))) throw new Error('Invalid image alias list');
  const sourceTags = row.sourceTags === undefined ? [] : row.sourceTags;
  if (!Array.isArray(sourceTags)) throw new Error('Invalid image source tags');
  const tags = sourceTags.map(value => {
    const tag = object(value);
    if (typeof tag.keyHex !== 'string' || typeof tag.valueHex !== 'string' ||
        !/^(?:[0-9a-f]{2})*$/u.test(tag.keyHex) || !/^(?:[0-9a-f]{2})*$/u.test(tag.valueHex) ||
        typeof tag.key !== 'string' || typeof tag.value !== 'string') throw new Error('Invalid image tag record');
    return Object.freeze({ keyHex: tag.keyHex, valueHex: tag.valueHex, key: tag.key, value: tag.value });
  });
  return Object.freeze({ id: row.id, name: row.name, file: row.file, sha256: row.sha256, sourceTags: Object.freeze(tags), aliases: Object.freeze(aliases as string[]),
    bytes: integer(row.bytes, 'bytes', 1, 256 * 1024 * 1024),
    width: integer(row.width, 'width', 1, 32768), height: integer(row.height, 'height', 1, 32768),
    offsetX: integer(row.offsetX, 'offsetX', -10000000, 10000000), offsetY: integer(row.offsetY, 'offsetY', -10000000, 10000000),
    sourceOffsetX: integer(row.sourceOffsetX, 'sourceOffsetX', -10000000, 10000000),
    sourceOffsetY: integer(row.sourceOffsetY, 'sourceOffsetY', -10000000, 10000000),
    pixelFormat: typeof row.pixelFormat === 'string' ? row.pixelFormat : '' });
}

/** Fetch/hash/decode prepared images. Leases keep active scene textures pinned. */
export class ImageCatalog {
  readonly entries: readonly PreparedImage[];
  private readonly base: URL;
  private readonly prefetch?:ResourcePrefetch;
  private readonly aliases = new Map<string, Set<PreparedImage>>();
  private readonly slots = new Map<string, ImageSlot>();
  private readonly budget: number;
  private decodedBytes = 0;
  private stamp = 0;
  private closed = false;

  private constructor(entries: PreparedImage[], base: URL, options: ImageCatalogOptions) {
    this.entries = Object.freeze(entries); this.base = base;
    this.prefetch=options.prefetch;
    this.budget = options.decodedPixelBudget ?? 128 * 1024 * 1024;
    if (!Number.isSafeInteger(this.budget) || this.budget < 1) throw new Error('Invalid decoded-image budget');
    const ids = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error('Duplicate prepared-image id'); ids.add(entry.id);
      for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      const full = key(name), basename = full.slice(full.lastIndexOf('/') + 1);
      for (const alias of [full, basename, full.replace(/[.][^/.]+$/u, ''), basename.replace(/[.][^/.]+$/u, '')]) {
        const values = this.aliases.get(alias) ?? new Set<PreparedImage>(); values.add(entry); this.aliases.set(alias, values);
      }
      }
    }
  }

  static async open(manifestUrl: URL | string, options: ImageCatalogOptions = {}, signal?: AbortSignal): Promise<ImageCatalog> {
    const response = await fetch(manifestUrl, { signal });
    if (!response.ok) throw new Error('Image manifest HTTP ' + response.status);
    const raw = object(await response.json());
    if (raw.schemaVersion !== 1 || raw.format !== 'prepared-web-images-v1' || raw.failed !== 0 || !Array.isArray(raw.entries)) {
      throw new Error('Unsupported/incomplete prepared image manifest');
    }
    const manifestBase = new URL('.', response.url || String(manifestUrl));
    if (raw.assetBaseUrl !== undefined && typeof raw.assetBaseUrl !== 'string') throw new Error('Invalid image asset base');
    const base = raw.assetBaseUrl === undefined ? manifestBase : new URL(raw.assetBaseUrl as string, manifestBase);
    if (base.origin !== manifestBase.origin) throw new Error('Image assets must share an origin');
    return new ImageCatalog(raw.entries.map(record), base, options);
  }

  resolve(storage: string): PreparedImage {
    const matches = this.aliases.get(key(storage));
    if (!matches || matches.size === 0) throw new Error('Unknown image: ' + storage);
    if (matches.size !== 1) throw new Error('Ambiguous image: ' + storage);
    return matches.values().next().value!;
  }

  private request(metadata:PreparedImage):PrefetchRequest{return {url:new URL(metadata.file,this.base).href,bytes:metadata.bytes};}
  warmRequest(storage:string):PrefetchRequest|undefined {
    const metadata=this.resolve(storage);return this.slots.has(metadata.id)?undefined:this.request(metadata);
  }
  async acquire(storage: string): Promise<ImageLease> { return this.acquireMetadata(this.resolve(storage)); }
  async acquireById(id: string): Promise<ImageLease> { const metadata = this.entries.find(entry => entry.id === id); if (!metadata) throw new Error('Unknown prepared image identity: ' + id); return this.acquireMetadata(metadata); }
  private async acquireMetadata(metadata: PreparedImage): Promise<ImageLease> {
    if (this.closed) throw new Error('Image catalog is closed');
    let slot = this.slots.get(metadata.id);
    if (!slot) {
      slot = { metadata, holds: 0, stamp: ++this.stamp, bytes: 0 };
      this.slots.set(metadata.id, slot);
      const created = slot;
      // Reclaim idle decoded pixels before asking the browser for the new native bitmap.
      this.trim(false,metadata.width*metadata.height*4);
      created.pending = this.decode(metadata).then(bitmap => {
        created.bitmap = bitmap; created.bytes = bitmap.width * bitmap.height * 4;
        this.decodedBytes += created.bytes; this.trim(); return bitmap;
      }, error => { if (this.slots.get(metadata.id) === created) this.slots.delete(metadata.id); throw error; });
    }
    slot.holds += 1; slot.stamp = ++this.stamp;
    const acquired = slot;
    try {
      const bitmap = await acquired.pending!;
      let released = false;
      return { bitmap, metadata, release: () => {
        if (released) return; released = true; acquired.holds -= 1; acquired.stamp = ++this.stamp; this.trim();
      } };
    } catch (error) { acquired.holds -= 1; throw error; }
  }

  clearUnused(): void { this.trim(true); }
  close(): void { this.closed = true; this.trim(true); }

  private trim(force = false, anticipatedBytes=0): void {
    const candidates = [...this.slots.values()].filter(slot => slot.holds === 0 && slot.bitmap).sort((a, b) => a.stamp - b.stamp);
    for (const slot of candidates) {
      if (!force && !this.closed && this.decodedBytes + anticipatedBytes <= this.budget) break;
      slot.bitmap!.close(); this.decodedBytes -= slot.bytes; this.slots.delete(slot.metadata.id);
    }
  }

  private async decode(metadata: PreparedImage): Promise<ImageBitmap> {
    const request=this.request(metadata),read=async()=>{
      const response=await fetch(request.url);
      if(!response.ok)throw Error('Image HTTP '+response.status+': '+metadata.name);
      return response.arrayBuffer();
    };
    const cached=this.prefetch?.take(request);
    const bytes=cached??await (this.prefetch?this.prefetch.foreground(read):read());
    if (bytes.byteLength !== metadata.bytes) throw new Error('Image byte-length mismatch: ' + metadata.name);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== metadata.sha256) throw new Error('Image content hash mismatch: ' + metadata.name);
    if(cached)this.prefetch?.promote?.(request,cached);
    const extension = metadata.file.slice(metadata.file.lastIndexOf('.') + 1);
    const type = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/' + extension;
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(cause=>{throw Error('Prepared image decode failed: '+metadata.name+' '+metadata.width+'×'+metadata.height,{cause});});
    if (bitmap.width !== metadata.width || bitmap.height !== metadata.height) {
      bitmap.close(); throw new Error('Image dimensions mismatch: ' + metadata.name);
    }
    return bitmap;
  }
}
