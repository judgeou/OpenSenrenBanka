import { psbRecord } from '../../src/formats/psb-value.ts';

import { nativeTextProgram } from './native-text-program.ts';
import type { NativeTextConversion } from './message-types.ts';
import type { PsbValue } from '../../src/formats/psb-value.ts';


const profile = 'kag-converter-pending-size-default39-v1';
function pending(value: PsbValue | undefined): number | null {
  if (value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 256) return value;
  throw new Error('Invalid saved converter pending font');
}
function sequence(value: PsbValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid saved text conversion sequence');
  return value;
}
/** One world converter, NOT a message-page property. Preparation never mutates it.
 * Whole convert finishes before tag playback; pendingAfter is saved even while characters type. */
export class NativeTextConverter {
          serial = 0;
          font: number | null = null;
  prepare(body: string): NativeTextConversion {
    if (!Number.isSafeInteger(this.serial + 1)) throw new Error('Text conversion sequence exhausted');
    return Object.freeze({ sequence: this.serial + 1, program: nativeTextProgram(body, this.font) });
  }
  commit(conversion: NativeTextConversion): void {
    if (conversion.sequence !== this.serial + 1 || conversion.program.pendingBefore !== this.font) throw new Error('Stale native text conversion');
    this.serial = conversion.sequence; this.font = conversion.program.pendingAfter;
  }
  validate(conversion: NativeTextConversion | undefined): void {
    if (conversion && (conversion.sequence < 1 || conversion.sequence > this.serial || conversion.sequence === this.serial && conversion.program.pendingAfter !== this.font)) throw new Error('Saved message conversion differs from its world converter');
  }
  reset(): void { this.serial = 0; this.font = null; }
  capture()           { return { schemaVersion: 1n, profile, sequence: this.serial, pendingSize: this.font }; }
  restore(value          )       {
    const row = psbRecord(value), serial = sequence(row.sequence), font = pending(row.pendingSize);
    if (row.schemaVersion !== 1n || row.profile !== profile || serial === 0 && font !== null) throw new Error('Unsupported native text converter state');
    this.serial = serial; this.font = font;
  }
}
export function captureTextConversion(conversion: NativeTextConversion): PsbValue {
  return { sequence: conversion.sequence, pendingBefore: conversion.program.pendingBefore, pendingAfter: conversion.program.pendingAfter };
}
/** Reconstruct immutable tags, not converter.commit or message playback. */
export function restoreTextConversion(value: PsbValue, body: string): NativeTextConversion {
  const row = psbRecord(value), serial = sequence(row.sequence), before = pending(row.pendingBefore), after = pending(row.pendingAfter);
  if (serial < 1) throw new Error('Saved message lacks a real conversion');
  const program = nativeTextProgram(body, before);
  if (program.pendingAfter !== after) throw new Error('Saved converter tail differs from its source');
  return Object.freeze({ sequence: serial, program });
}
