import { PsbResourceLiteral } from '../formats/psb-value.ts';
import type { PlayerSnapshot } from './types.ts';
type SavedNode = unknown[];
const maximumBytes = 64 * 1024 * 1024, maximumNodes = 1000000, maximumDepth = 128;
function encodeData(snapshot: unknown, format: string): string {
  const active = new WeakSet<object>(); let nodes = 0;
  function pack(value: unknown, depth: number): SavedNode {
    if (++nodes > maximumNodes || depth > maximumDepth) throw new Error('Save data budget exceeded');
    if (value === undefined) return ['u']; if (value === null) return ['n'];
    if (typeof value === 'boolean') return ['b', value]; if (typeof value === 'string') return ['s', value];
    if (typeof value === 'bigint') return ['i', String(value)];
    if (typeof value === 'number') return ['f', Number.isNaN(value) ? 'nan' : value === Infinity ? '+inf' : value === -Infinity ? '-inf' : Object.is(value, -0) ? '-0' : value];
    if (typeof value !== 'object' || active.has(value)) throw new Error('Unsupported/cyclic saved value');
    if (value instanceof PsbResourceLiteral) return ['r', value.index, value.dataOffset, value.length];
    active.add(value);
    try {
      if (Array.isArray(value)) return ['a', value.map(item => pack(item, depth + 1))];
      const proto = Object.getPrototypeOf(value); if (proto !== null && proto !== Object.prototype) throw new Error('Save data contains a non-data object');
      return ['o', Object.entries(value).map(([key, item]) => [key, pack(item, depth + 1)])];
    } finally { active.delete(value); }
  }
  const result = JSON.stringify({ format, version: 1, tree: pack(snapshot, 0) });
  if (new TextEncoder().encode(result).length > maximumBytes) throw new Error('Encoded save data exceeds budget'); return result;
}
function decodeData(source: string, format: string): unknown {
  if (new TextEncoder().encode(source).length > maximumBytes) throw new Error('Save input exceeds budget');
  const container = JSON.parse(source); if (container?.format !== format || container.version !== 1) throw new Error('Unsupported save format');
  let nodes = 0;
  function unpack(value: unknown, depth: number): unknown {
    if (++nodes > maximumNodes || depth > maximumDepth || !Array.isArray(value)) throw new Error('Invalid/over-budget save node');
    const [tag, data] = value;
    if (tag === 'u' && value.length === 1) return undefined; if (tag === 'n' && value.length === 1) return null;
    if (tag === 'b' && typeof data === 'boolean' && value.length === 2) return data; if (tag === 's' && typeof data === 'string' && value.length === 2) return data;
    if (tag === 'i' && typeof data === 'string' && /^[+-]?[0-9]{1,32}$/u.test(data) && value.length === 2) return BigInt(data);
    if (tag === 'f' && value.length === 2) {
      if (typeof data === 'number' && Number.isFinite(data)) return data;
      if (data === 'nan') return NaN; if (data === '+inf') return Infinity; if (data === '-inf') return -Infinity; if (data === '-0') return -0;
    }
    if (tag === 'r' && value.length === 4 && value.slice(1).every(item => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)) return new PsbResourceLiteral(value[1] as number, value[2] as number, value[3] as number);
    if (tag === 'a' && value.length === 2 && Array.isArray(data)) return data.map(item => unpack(item, depth + 1));
    if (tag === 'o' && value.length === 2 && Array.isArray(data)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const pair of data) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(result, pair[0])) throw new Error('Invalid saved object field');
        result[pair[0]] = unpack(pair[1], depth + 1);
      }
      return result;
    }
    throw new Error('Unknown/malformed saved value');
  }
  return unpack(container.tree, 0);
}
export function encodePersistentData(value: unknown): string { return encodeData(value, 'senren-persistent-data-v1'); }
export function decodePersistentData(value: string): unknown { return decodeData(value, 'senren-persistent-data-v1'); }
export function encodePlayerSnapshot(snapshot: PlayerSnapshot): string { return encodeData(snapshot, 'senren-player-save-v1'); }
export function decodePlayerSnapshot(source: string): PlayerSnapshot {
  const value = decodeData(source, 'senren-player-save-v1') as PlayerSnapshot;
  if (!value || value.schemaVersion !== 2 || !Array.isArray(value.hostWaits) || !value.position || !value.clock || !value.script || !value.mode || !value.wait || !Array.isArray(value.read) || !Array.isArray(value.history)) throw new Error('Incomplete player snapshot');
  return value;
}
