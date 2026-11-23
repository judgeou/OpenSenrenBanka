import { PsbResourceLiteral } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
/** Only plain owned data crosses world/snapshot contracts. Undefined object fields stay absent. */
export function sessionData(value: unknown): PsbValue {
  const active = new WeakSet<object>(); let count = 0;
  function read(value: unknown, depth: number): PsbValue {
    if (++count > 1000000 || depth > 128) throw new Error('Session data budget exceeded');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') return value;
    if (value instanceof PsbResourceLiteral) return value;
    if (!value || typeof value !== 'object' || active.has(value)) throw new Error('Non-data/cyclic session state');
    active.add(value);
    try {
      if (Array.isArray(value)) return value.map(item => item === undefined ? null : read(item, depth + 1));
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Session snapshot contains a live object');
      const result: Record<string, PsbValue> = Object.create(null);
      for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = read(item, depth + 1);
      return result;
    } finally { active.delete(value); }
  }
  return read(value, 0);
}
