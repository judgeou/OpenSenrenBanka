import { Psb2Reader } from '../formats/psb2/reader.ts';
import { ScenarioDocument } from './document.ts';

export interface PreparedScenario {
  readonly id: string; readonly binaryFile: string; readonly indexFile: string;
  readonly sha256: string; readonly bytes: number; readonly logicalAliases: readonly string[];
}
export interface ScenarioCatalogOptions {
  readonly fetcher?: typeof fetch; readonly maxCachedDocuments?: number; readonly maxCachedBytes?: number;
}
interface CacheEntry { readonly document: ScenarioDocument; readonly bytes: number }

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected manifest object');
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid manifest string: ' + field);
  return value;
}
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid manifest integer: ' + field);
  return value;
}
function assetFilename(value: unknown, field: string): string {
  const file = string(value, field);
  if (!/^[a-zA-Z0-9_.-]+$/u.test(file) || file.includes('..')) throw new Error('Unsafe manifest asset filename');
  return file;
}
function normalizedAlias(value: string): string {
  return value.replaceAll(String.fromCharCode(92), '/').toLowerCase();
}
function parsePrepared(value: unknown): PreparedScenario {
  const row = record(value);
  if (row.state !== 'prepared') throw new Error('Manifest contains an unprepared scenario');
  if (!Array.isArray(row.logicalAliases) || row.logicalAliases.some(alias => typeof alias !== 'string')) {
    throw new Error('Invalid scenario aliases');
  }
  const sha256 = string(row.sha256, 'sha256');
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error('Invalid scenario SHA-256');
  const bytes = positiveInteger(row.bytes, 'bytes');
  if (bytes > 64 * 1024 * 1024) throw new Error('Scenario asset exceeds the input budget');
  return { id: string(row.id, 'id'), binaryFile: assetFilename(row.binaryFile, 'binaryFile'),
    indexFile: assetFilename(row.indexFile, 'indexFile'), sha256, bytes,
    logicalAliases: Object.freeze([...(row.logicalAliases as string[])]) };
}

/** Fetches prepared PSB data; no original executable, Node API, or plugin is used. */
export class ScenarioCatalog {
  readonly entries: readonly PreparedScenario[];
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  private readonly documents = new Map<string, PreparedScenario>();
  private readonly aliases = new Map<string, Set<string>>();
  private readonly cache = new Map<string, CacheEntry>();
  private cachedBytes = 0;
  private readonly maxDocuments: number;
  private readonly maxBytes: number;

  private constructor(base: URL, entries: PreparedScenario[], options: ScenarioCatalogOptions) {
    this.base = base; this.entries = Object.freeze(entries);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.maxDocuments = options.maxCachedDocuments ?? 2;
    this.maxBytes = options.maxCachedBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxDocuments) || this.maxDocuments < 0 ||
        !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0) throw new Error('Invalid scenario cache budget');
    for (const entry of entries) {
      if (this.documents.has(entry.id)) throw new Error('Duplicate scenario id: ' + entry.id);
      this.documents.set(entry.id, entry);
      for (const alias of [entry.id, ...entry.logicalAliases]) {
        const key = normalizedAlias(alias);
        const ids = this.aliases.get(key) ?? new Set<string>();
        ids.add(entry.id); this.aliases.set(key, ids);
      }
    }
  }

  static async open(baseUrl: string | URL, options: ScenarioCatalogOptions = {}, signal?: AbortSignal): Promise<ScenarioCatalog> {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Scenario assets require an HTTP(S) base URL');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    base.search = ''; base.hash = '';
    const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    const response = await fetcher(new URL('manifest.json', base), { signal });
    if (!response.ok) throw new Error('Scenario manifest fetch failed: HTTP ' + response.status);
    const manifest = record(await response.json());
    if (manifest.schemaVersion !== 2 || manifest.format !== 'senren-scenario-assets-v2' || !Array.isArray(manifest.files)) {
      throw new Error('Unsupported scenario manifest format');
    }
    if (manifest.unpreparedEntries !== 0) throw new Error('Scenario preparation is incomplete');
    const entries = manifest.files.map(parsePrepared);
    if (manifest.preparedEntries !== entries.length || manifest.totalEntries !== entries.length) {
      throw new Error('Scenario manifest file counts disagree');
    }
    return new ScenarioCatalog(base, entries, options);
  }

  resolve(storage: string): PreparedScenario {
    const key = normalizedAlias(storage);
    const ids = this.aliases.get(key) ?? (key.startsWith('scn/') ? this.aliases.get(key.slice(4)) : undefined);
    if (!ids || ids.size === 0) throw new Error('Scenario storage not found: ' + storage);
    if (ids.size > 1) throw new Error('Ambiguous scenario storage: ' + storage);
    return this.documents.get([...ids][0])!;
  }

  async load(storage: string, signal?: AbortSignal): Promise<ScenarioDocument> {
    const entry = this.resolve(storage);
    const cached = this.cache.get(entry.id);
    if (cached) { this.cache.delete(entry.id); this.cache.set(entry.id, cached); return cached.document; }
    const response = await this.fetcher(new URL(entry.binaryFile, this.base), { signal });
    if (!response.ok) throw new Error('Scenario fetch failed: ' + entry.id + ', HTTP ' + response.status);
    const body = await response.arrayBuffer();
    if (body.byteLength !== entry.bytes) throw new Error('Scenario byte length mismatch: ' + entry.id);
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for scenario asset integrity');
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', body));
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== entry.sha256) throw new Error('Scenario asset hash mismatch: ' + entry.id);
    if (signal?.aborted) throw new DOMException('Scenario load aborted', 'AbortError');
    const document = new ScenarioDocument(new Psb2Reader(new Uint8Array(body)));
    if (this.maxDocuments > 0 && entry.bytes <= this.maxBytes) {
      const prior = this.cache.get(entry.id);
      if (prior) this.cachedBytes -= prior.bytes;
      this.cache.delete(entry.id);
      this.cache.set(entry.id, { document, bytes: entry.bytes }); this.cachedBytes += entry.bytes;
      while (this.cache.size > this.maxDocuments || this.cachedBytes > this.maxBytes) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cachedBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
    }
    return document;
  }

  clear(): void { this.cache.clear(); this.cachedBytes = 0; }
}
