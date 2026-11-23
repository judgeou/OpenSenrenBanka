import type { ScriptValue } from './types.ts';
export function truth(value: ScriptValue): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'bigint') return value !== 0n; return Boolean(value);
}
export function text(value: ScriptValue): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') throw new Error('Script object-to-string conversion requires a host binding'); return String(value);
}
export function numeric(value: ScriptValue): number | bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value !== 'string') throw new Error('Script value is not numeric');
  const string = value.trim(); if (!string) return 0n;
  if (/^[+-]?(?:[0-9]+|0[xX][0-9a-fA-F]+)$/u.test(string)) return BigInt(string);
  const number = Number(string); if (Number.isNaN(number)) throw new Error('Invalid script numeric string'); return number;
}
function integer(value: ScriptValue): bigint { const number = numeric(value); if (typeof number === 'bigint') return number; if (!Number.isFinite(number)) throw new Error('Non-finite script integer'); return BigInt(Math.trunc(number)); }
export function unary(op: string, value: ScriptValue): ScriptValue {
  if (op === '!') return !truth(value);
  if (op === '+') return numeric(value);
  if (op === '-') { const number = numeric(value); return typeof number === 'bigint' ? BigInt.asIntN(64, -number) : -number; }
  if (op === '~') return BigInt.asIntN(64, ~integer(value)); throw new Error('Unsupported script unary operator: ' + op);
}
export function binary(op: string, left: ScriptValue, right: ScriptValue): ScriptValue {
  if (op === '+' && (typeof left === 'string' || typeof right === 'string')) return text(left) + text(right);
  if (op === '===' || op === '!==') { const result = typeof left === typeof right && left === right; return op === '===' ? result : !result; }
  if (op === '==' || op === '!=') {
    let result: boolean;
    if (typeof left === typeof right) result = left === right;
    else if (left == null && right == null) result = true;
    else if (typeof left === 'object' || typeof right === 'object') result = false;
    else { const a = numeric(left), b = numeric(right); result = typeof a === typeof b ? a === b : Number(a) === Number(b); }
    return op === '==' ? result : !result;
  }
  if (['&', '|', '^', '<<', '>>', '>>>', String.fromCharCode(92)].includes(op)) {
    const a = integer(left), b = integer(right), shift = b & 63n;
    if (op === '&') return BigInt.asIntN(64, a & b); if (op === '|') return BigInt.asIntN(64, a | b);
    if (op === '^') return BigInt.asIntN(64, a ^ b); if (op === '<<') return BigInt.asIntN(64, a << shift);
    if (op === '>>') return BigInt.asIntN(64, a >> shift); if (op === '>>>') return BigInt.asUintN(64, a) >> shift;
    if (b === 0n) throw new Error('Script integer division by zero'); return BigInt.asIntN(64, a / b);
  }
  const a = typeof left === 'string' && typeof right === 'string' ? left : numeric(left);
  const b = typeof left === 'string' && typeof right === 'string' ? right : numeric(right);
  if (op === '<') return a < b; if (op === '<=') return a <= b; if (op === '>') return a > b; if (op === '>=') return a >= b;
  const x = numeric(left), y = numeric(right);
  if (typeof x === 'bigint' && typeof y === 'bigint' && op !== '/') {
    if (op === '+') return BigInt.asIntN(64, x + y); if (op === '-') return BigInt.asIntN(64, x - y);
    if (op === '*') return BigInt.asIntN(64, x * y); if (op === '%') { if (y === 0n) throw new Error('Script remainder by zero'); return x % y; }
  }
  const xNumber = Number(x), yNumber = Number(y);
  if (op === '+') return xNumber + yNumber; if (op === '-') return xNumber - yNumber; if (op === '*') return xNumber * yNumber;
  if (op === '/') return xNumber / yNumber; if (op === '%') return xNumber % yNumber;
  throw new Error('Unsupported script binary operator: ' + op);
}
