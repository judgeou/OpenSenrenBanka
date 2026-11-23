import { clonePsbValue, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import { nativeNumber } from './native-values.ts';
export type ActionDescriptor = Readonly<{ [key: string]: PsbValue }>;
export type ActionPhase = { readonly kind: 'actions'; readonly handlers: readonly ActionDescriptor[] } | { readonly kind: 'wait'; readonly time: number; readonly speed: number };
export type PropertyOperation = { readonly kind: 'clear' } | { readonly kind: 'stop'; readonly finish: boolean } | { readonly kind: 'property'; readonly name: string; readonly value: PsbValue; readonly modifiers: readonly PsbValue[]; readonly phases: readonly ActionPhase[] | undefined };
export function actionPhases(value: readonly PsbValue[]): readonly ActionPhase[] {
  const phases: ActionPhase[] = [];
  function descriptor(value: PsbValue): ActionDescriptor {
    const record = psbRecord(value), handler = record.handler ?? 'MoveAction';
    if (handler !== 'MoveAction' && handler !== 'SinAction' && handler !== 'RandomAction') throw new Error('Unsupported native action handler: ' + String(handler));
    nativeNumber(record.time, 0); return clonePsbValue(record) as ActionDescriptor;
  }
  for (const item of value) {
    if (Array.isArray(item)) { phases.push({ kind: 'actions', handlers: item.map(descriptor) }); continue; }
    const record = psbRecord(item);
    if (record.handler === 'wait') phases.push({ kind: 'wait', time: nativeNumber(record.time, 0), speed: nativeNumber(record.speed, 1) });
    else phases.push({ kind: 'actions', handlers: [descriptor(record)] });
  }
  return phases;
}
export function propertyOperations(value: PsbValue | undefined): readonly PropertyOperation[] {
  if (value === undefined || value === null) return []; if (!Array.isArray(value)) throw new Error('Native property list must be an array');
  return value.map(item => {
    if (item === null) return { kind: 'clear' };
    if (typeof item === 'bigint' || typeof item === 'number') return { kind: 'stop', finish: nativeNumber(item) !== 0 };
    if (!Array.isArray(item) || item.length < 2 || item.length > 4 || typeof item[0] !== 'string' || !item[0] || ['__proto__', 'prototype', 'constructor'].includes(item[0])) throw new Error('Invalid native property tuple');
    return { kind: 'property', name: item[0], value: clonePsbValue(item[1]), modifiers: item.slice(2), phases: Array.isArray(item[1]) ? actionPhases(item[1]) : undefined };
  });
}
export function nativeEase(acceleration: PsbValue | undefined, fraction: number): number {
  const t = Math.max(0, Math.min(1, fraction));
  if (typeof acceleration === 'string') {
    const key = acceleration.toLowerCase(); if (key === 'accos') return (1-Math.cos(Math.PI*t))/2; if (key === 'acdec') return t*t*(3-2*t);
    if (key === 'accel') return t*t; if (key === 'decel') return t*(2-t); if (key === 'const') return t;
  }
  const amount = nativeNumber(acceleration, 0); if (amount === 0) return t; return amount > 0 ? Math.pow(t, amount+1) : 1-Math.pow(1-t, 1-amount);
}
