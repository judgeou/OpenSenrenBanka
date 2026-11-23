import type { PsbValue } from '../formats/psb-value.ts';
export function nativeNumber(value: PsbValue | undefined, fallback?: number): number {
  if (value === null || value === undefined) { if (fallback !== undefined) return fallback; throw new Error('Missing native numeric parameter'); }
  const number = typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid native numeric parameter'); return number;
}
export function nativeBoolean(value: PsbValue | undefined): boolean { return value !== undefined && value !== null && value !== false && value !== 0n && value !== 0 && value !== ''; }
export function decodeNativeData(text: string): PsbValue {
  if (text.length > 64 * 1024 * 1024) throw new Error('Native definition exceeds data budget');
  return JSON.parse(text, (_key, value) => { if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$integer === 'string' && /^[+-]?[0-9]{1,20}$/u.test(value.$integer)) return BigInt(value.$integer); return value; });
}
