import type { Psb2Reader } from './psb2/reader.ts';

export class PsbResourceLiteral {
  readonly index: number; readonly dataOffset: number; readonly length: number;
  constructor(index: number, dataOffset: number, length: number) { this.index = index; this.dataOffset = dataOffset; this.length = length; }
}
export type PsbValue = null | boolean | number | bigint | string | PsbValue[] | { [name: string]: PsbValue } | PsbResourceLiteral;
export function psbRecord(value: PsbValue): { [name: string]: PsbValue } {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof PsbResourceLiteral) throw new Error('Expected PSB dictionary value');
  return value;
}
export function psbArray(value: PsbValue): PsbValue[] { if (!Array.isArray(value)) throw new Error('Expected PSB array value'); return value; }

/** Materialize bounded data, not scripts. Integer values remain bigint. */
export function psbValue(reader: Psb2Reader, ref: number, options: { maxNodes?: number; maxDepth?: number; integerMode?: 'native' | 'legacy-compact' } = {}): PsbValue {
  const cache = new Map<number, PsbValue>(), active = new Set<number>();
  let nodes = 0; const maximum = options.maxNodes ?? 1000000, depthLimit = options.maxDepth ?? 128;
  function read(at: number, depth: number): PsbValue {
    if (cache.has(at)) return cache.get(at)!;
    if (active.has(at) || depth > depthLimit || ++nodes > maximum) throw new Error('Cyclic/over-budget PSB value graph');
    active.add(at); const node = reader.node(at); let value: PsbValue;
    if (node.kind === 'null') value = null;
    else if (node.kind === 'integer') value = options.integerMode === 'legacy-compact' ? node.value : node.nativeValue;
    else if (node.kind === 'boolean' || node.kind === 'real' || node.kind === 'string') value = node.value;
    else if (node.kind === 'resource') value = new PsbResourceLiteral(node.index, node.dataOffset, node.length);
    else if (node.kind === 'array') value = node.items.map(child => read(child, depth + 1));
    else if (node.kind === 'object') {
      const object: { [name: string]: PsbValue } = Object.create(null);
      for (const item of node.entries) object[item.key] = read(item.valueOffset, depth + 1); value = object;
    } else throw new Error('Unsupported PSB materialized kind');
    active.delete(at); cache.set(at, value); return value;
  }
  return read(ref, 0);
}
export function clonePsbValue(value: PsbValue): PsbValue {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof PsbResourceLiteral) return new PsbResourceLiteral(value.index, value.dataOffset, value.length);
  if (Array.isArray(value)) return value.map(clonePsbValue);
  const result: { [name: string]: PsbValue } = Object.create(null);
  for (const [name, item] of Object.entries(value)) result[name] = clonePsbValue(item); return result;
}
