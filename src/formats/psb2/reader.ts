import type { PsbHeader, PsbLimits, PsbNode, PsbProperty, PsbResourceRange } from './types.ts';

// PSB format reference: morkt/GARbro ArcFormats/Emote/ArcPSB.cs (MIT).
// Retained attribution: licenses/GARbro-PSB-MIT.txt. No scripts are executed.
interface PackedTable { count: number; width: number; data: number; end: number }
const DEFAULT_LIMITS: PsbLimits = {
  maxInputBytes: 64 * 1024 * 1024, maxArrayItems: 2000000, maxNames: 100000,
  maxNameBytes: 2048, maxStringBytes: 4 * 1024 * 1024, maxWalkNodes: 2000000,
};

export class PsbFormatError extends Error {
  readonly offset: number | undefined;
  constructor(message: string, offset?: number) {
    super(message + (offset === undefined ? '' : ' at PSB offset ' + offset));
    this.name = 'PsbFormatError';
    this.offset = offset;
  }
}

/** Browser-portable PSB v2/v3 view. A metadata prefix may describe a larger source. */
export class Psb2Reader {
  readonly header: PsbHeader;
  readonly sourceByteLength: number;
  readonly names: readonly string[];
  readonly stringCount: number;
  readonly resourceCount: number;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly limits: PsbLimits;
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true });
  private readonly strings: PackedTable;
  private readonly chunkOffsets: PackedTable;
  private readonly chunkLengths: PackedTable;
  private readonly stringCache = new Map<number, string>();

  constructor(bytes: Uint8Array, limits: Partial<PsbLimits> = {}, sourceByteLength = bytes.byteLength) {
    if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength < bytes.byteLength) {
      throw new PsbFormatError('Invalid complete PSB source length');
    }
    this.sourceByteLength = sourceByteLength;
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new PsbFormatError('Invalid PSB budget');
    }
    if (bytes.byteLength > this.limits.maxInputBytes) throw new PsbFormatError('PSB input budget exceeded');
    this.range(0, 40);
    if (this.u(0, 4) !== 0x00425350) throw new PsbFormatError('Expected PSB signature');
    const version = this.u(4, 2);
    if ((version !== 2 && version !== 3) || this.u(6, 2) !== 0) {
      throw new PsbFormatError('Only unencrypted PSB v2/v3 is supported');
    }
    const headerSize = version === 3 ? 44 : 40;
    this.range(0, headerSize);
    this.header = Object.freeze({
      version, headerSize, checksum: version === 3 ? this.u(40, 4) : undefined,
      flags: 0, names: this.u(12, 4), strings: this.u(16, 4),
      stringsData: this.u(20, 4), chunkOffsets: this.u(24, 4),
      chunkLengths: this.u(28, 4), chunkData: this.u(32, 4), root: this.u(36, 4),
    });
    if (this.header.chunkData < this.header.headerSize || this.header.chunkData > bytes.byteLength) {
      throw new PsbFormatError('PSB resource boundary is outside input');
    }
    for (const at of [this.header.names, this.header.strings, this.header.stringsData,
      this.header.chunkOffsets, this.header.chunkLengths, this.header.root]) {
      if (at < this.header.headerSize || at >= this.header.chunkData) throw new PsbFormatError('PSB metadata offset is outside header region', at);
    }
    if (this.header.stringsData >= this.header.chunkOffsets) {
      throw new PsbFormatError('Unsupported PSB string region ordering');
    }
    this.names = this.readNames();
    this.strings = this.packed(this.header.strings);
    this.chunkOffsets = this.packed(this.header.chunkOffsets);
    this.chunkLengths = this.packed(this.header.chunkLengths);
    if (this.chunkOffsets.count !== this.chunkLengths.count) {
      throw new PsbFormatError('PSB resource offset/length counts differ');
    }
    this.stringCount = this.strings.count;
    this.resourceCount = this.chunkOffsets.count;
    if (this.u(this.header.root, 1) !== 33) throw new PsbFormatError('PSB root is not an object');
  }

  private range(at: number, length: number, end = this.bytes.byteLength): void {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 ||
        !Number.isSafeInteger(at + length) || at + length > end) {
      throw new PsbFormatError('PSB byte range exceeds input', at);
    }
  }

  private u(at: number, width: number): number {
    if (!Number.isInteger(width) || width < 1 || width > 4) throw new PsbFormatError('Unsupported unsigned width', at);
    this.range(at, width);
    let value = 0;
    for (let i = width - 1; i >= 0; i -= 1) value = value * 256 + this.bytes[at + i];
    return value;
  }

  private packed(at: number): PackedTable {
    const countWidth = this.u(at, 1) - 12;
    const count = this.u(at + 1, countWidth);
    if (count > this.limits.maxArrayItems) throw new PsbFormatError('PSB packed-array budget exceeded', at);
    const width = this.u(at + 1 + countWidth, 1) - 12;
    if (width < 1 || width > 4) throw new PsbFormatError('Unsupported packed-array element width', at);
    const data = at + 2 + countWidth;
    this.range(data, count * width, this.header.chunkData);
    return { count, width, data, end: data + count * width };
  }

  private element(table: PackedTable, index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= table.count) {
      throw new PsbFormatError('PSB packed-array index is outside table', table.data);
    }
    return this.u(table.data + index * table.width, table.width);
  }

  private readNames(): readonly string[] {
    const bases = this.packed(this.header.names);
    const parents = this.packed(bases.end);
    const terminals = this.packed(parents.end);
    if (terminals.count > this.limits.maxNames) throw new PsbFormatError('PSB name budget exceeded');
    const names: string[] = [];
    for (let id = 0; id < terminals.count; id += 1) {
      let state = this.element(terminals, id);
      let terminal = true;
      const visited = new Set<number>();
      const reversed: number[] = [];
      while (state !== 0) {
        if (visited.has(state) || visited.size > this.limits.maxNameBytes) {
          throw new PsbFormatError('PSB key parent cycle/length exceeded', state);
        }
        visited.add(state);
        const parent = this.element(parents, state);
        const symbol = state - this.element(bases, parent);
        if (terminal) {
          if (symbol !== 0) throw new PsbFormatError('PSB name terminal is not NUL', state);
          terminal = false;
        } else {
          if (symbol < 1 || symbol > 255) throw new PsbFormatError('Invalid UTF-8 key byte', state);
          reversed.push(symbol);
        }
        state = parent;
      }
      names.push(this.utf8.decode(Uint8Array.from(reversed.reverse())));
    }
    return Object.freeze(names);
  }

  private string(index: number): string {
    const cached = this.stringCache.get(index);
    if (cached !== undefined) return cached;
    const begin = this.header.stringsData + this.element(this.strings, index);
    this.range(begin, 1, this.header.chunkOffsets);
    const limit = Math.min(this.header.chunkOffsets, begin + this.limits.maxStringBytes + 1);
    let end = begin;
    while (end < limit && this.bytes[end] !== 0) end += 1;
    if (end === limit) throw new PsbFormatError('Unterminated/over-budget PSB string', begin);
    const result = this.utf8.decode(this.bytes.subarray(begin, end));
    this.stringCache.set(index, result);
    return result;
  }

  private child(base: number, relative: number): number {
    const offset = base + relative;
    this.range(offset, 1, this.header.chunkData);
    if (offset < this.header.headerSize) throw new PsbFormatError('PSB child overlaps header', offset);
    return offset;
  }

  node(offset: number): PsbNode {
    this.range(offset, 1, this.header.chunkData);
    const code = this.u(offset, 1);
    const base = { offset, code };
    if (code === 1) return { ...base, kind: 'null' };
    if (code === 2 || code === 3) return { ...base, kind: 'boolean', value: code === 2 };
    if (code >= 4 && code <= 12) {
      const storageBytes = code - 4;
      this.range(offset + 1, storageBytes, this.header.chunkData);
      let rawBits = 0n;
      for (let i = storageBytes - 1; i >= 0; i -= 1) rawBits = rawBits * 256n + BigInt(this.bytes[offset + 1 + i]);
      // Keep the existing compact projection for identifiers; native scalars sign-extend every stored width.
      const value = storageBytes < 4 ? rawBits : BigInt.asIntN(storageBytes * 8, rawBits);
      return { ...base, kind: 'integer', storageBytes, rawBits, value, nativeValue: BigInt.asIntN(storageBytes * 8, rawBits) };
    }
    if (code >= 21 && code <= 24) {
      const index = this.u(offset + 1, code - 20);
      return { ...base, kind: 'string', index, value: this.string(index) };
    }
    if (code >= 25 && code <= 28) {
      const index = this.u(offset + 1, code - 24);
      return { ...base, kind: 'resource', ...this.resource(index) };
    }
    if (code === 29) return { ...base, kind: 'real', storageBytes: 0, value: 0 };
    if (code === 30 || code === 31) {
      const storageBytes = code === 30 ? 4 : 8;
      this.range(offset + 1, storageBytes, this.header.chunkData);
      const value = code === 30 ? this.view.getFloat32(offset + 1, true) : this.view.getFloat64(offset + 1, true);
      return { ...base, kind: 'real', storageBytes, value };
    }
    if (code === 32) {
      const offsets = this.packed(offset + 1);
      const items: number[] = [];
      for (let i = 0; i < offsets.count; i += 1) items.push(this.child(offsets.end, this.element(offsets, i)));
      return { ...base, kind: 'array', items };
    }
    if (code === 33) {
      const keys = this.packed(offset + 1);
      const entries: PsbProperty[] = [];
      if (keys.count > 0) {
        const values = this.packed(keys.end);
        if (keys.count !== values.count) throw new PsbFormatError('PSB object key/value counts differ', offset);
        for (let i = 0; i < keys.count; i += 1) {
          const keyId = this.element(keys, i);
          const key = this.names[keyId];
          if (key === undefined) throw new PsbFormatError('Missing PSB property name', offset);
          entries.push({ keyId, key, valueOffset: this.child(values.end, this.element(values, i)) });
        }
      }
      return { ...base, kind: 'object', entries };
    }
    throw new PsbFormatError('Unsupported PSB value code ' + code, offset);
  }

  resource(index: number): PsbResourceRange {
    const dataOffset = this.header.chunkData + this.element(this.chunkOffsets, index);
    const length = this.element(this.chunkLengths, index);
    this.range(dataOffset, length, this.sourceByteLength);
    return { index, dataOffset, length };
  }

  property(objectOffset: number, key: string): number | undefined {
    const object = this.node(objectOffset);
    if (object.kind !== 'object') throw new PsbFormatError('Expected PSB object', objectOffset);
    const matches = object.entries.filter(entry => entry.key === key);
    if (matches.length > 1) throw new PsbFormatError('Ambiguous duplicate PSB property ' + key, objectOffset);
    return matches[0]?.valueOffset;
  }

  walk(visitor: (node: PsbNode) => void, start = this.header.root): number {
    const pending = [start];
    const seen = new Set<number>();
    while (pending.length > 0) {
      const offset = pending.pop()!;
      if (seen.has(offset)) continue;
      if (seen.size >= this.limits.maxWalkNodes) throw new PsbFormatError('PSB walk budget exceeded', offset);
      seen.add(offset);
      const node = this.node(offset);
      visitor(node);
      if (node.kind === 'array') {
        for (let i = node.items.length - 1; i >= 0; i -= 1) pending.push(node.items[i]);
      } else if (node.kind === 'object') {
        for (let i = node.entries.length - 1; i >= 0; i -= 1) pending.push(node.entries[i].valueOffset);
      }
    }
    return seen.size;
  }
}
