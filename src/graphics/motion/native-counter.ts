import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';

export interface NativeCounterProfile { readonly lastTime: number; readonly loopTime: number }
/** Original native Player fields; no independent timeline or tick statistic. */
export interface NativeCounterState {
  readonly counterFrames: number; // +0x78, tickCount getter reads this
  readonly evalFrame: number; // +0x80, clamped layer evaluation time
  readonly layerGate: boolean; // +0x98, cleared after outer updateLayers
  readonly progressGate: boolean; // +0x9A, handled inside progress
  readonly playing: boolean; // +0xC7, not recursive allplaying
  readonly scaledDeltaFrames: number; // +0x1B8, overwritten on EVERY progress
}
export function counterNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Invalid native MTN ' + label);
  return value;
}
export function counterProfile(profile: NativeCounterProfile): void {
  counterNumber(profile.lastTime, 'lastTime');
  if (!Number.isSafeInteger(profile.loopTime) || profile.loopTime < -1 || profile.loopTime >= 0 && profile.loopTime >= profile.lastTime) throw new Error('Unsupported native MTN loop profile');
}
export function readCounter(value: PsbValue): NativeCounterState {
  const row = psbRecord(value);
  if (typeof row.layerGate !== 'boolean' || typeof row.progressGate !== 'boolean' || typeof row.playing !== 'boolean') throw new Error('Saved MTN native counter gates are absent');
  return { counterFrames: counterNumber(row.counterFrames, 'counter'), evalFrame: counterNumber(row.evalFrame, 'evaluation'),
    layerGate: row.layerGate, progressGate: row.progressGate, playing: row.playing, scaledDeltaFrames: counterNumber(row.scaledDeltaFrames, 'scaled delta') };
}
export function validateCounter(profile: NativeCounterProfile, state: NativeCounterState): void {
  counterProfile(profile); readCounter({ ...state });
  if (state.evalFrame !== Math.min(state.counterFrames, profile.lastTime)) throw new Error('Saved MTN counter/evaluation mismatch');
}
export function freshCounter(): NativeCounterState {
  return { counterFrames: 0, evalFrame: 0, layerGate: true, progressGate: true, playing: true, scaledDeltaFrames: 0 };
}
/** Child offset setter 0x10039210: writes both time fields and sets BOTH gates.
 * This is also the native counter assignment shape, NOT a timeline.currentTime.
 */
export function assignCounter(profile: NativeCounterProfile, state: NativeCounterState, frames: number): NativeCounterState {
  if (!Number.isFinite(frames) || Math.abs(frames) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid MTN assigned counter');
  const counterFrames = Math.max(0, frames);
  return { ...state, counterFrames, evalFrame: Math.min(counterFrames, profile.lastTime), layerGate: true, progressGate: true };
}
/** Native 0x10028A10 finite branch: no tags, parameters, controllers, negative dt
 * or special modes. 0x9A runs rebuild scans; accepted stateless leaf evaluation
 * has the same final slots and no scan events. 0x98 independently suppresses
 * counter addition. Caller MUST run outer layer update, then clear layerGate.
 */
export function progressCounter(profile: NativeCounterProfile, state: NativeCounterState, delta: number, speed: boolean): NativeCounterState {
  counterNumber(delta, 'progress interval');
  const scaledDeltaFrames = speed ? delta : 0;
  // Native multiplication/write precedes playing/gate branches, including dt=0.
  if (!state.progressGate && !state.playing) return { ...state, scaledDeltaFrames };
  let counterFrames = state.counterFrames, evalFrame = state.evalFrame, playing = state.playing;
  if (!state.layerGate) {
    counterFrames += scaledDeltaFrames; counterNumber(counterFrames, 'advanced counter');
    evalFrame = Math.min(counterFrames, profile.lastTime);
  }
  if (scaledDeltaFrames > 0) {
    if (counterFrames >= profile.lastTime) {
      evalFrame = profile.lastTime;
      if (profile.loopTime < 0) playing = false;
      else {
        const span = profile.lastTime - profile.loopTime;
        counterFrames = profile.loopTime + (counterFrames - profile.lastTime) % span;
        evalFrame = counterFrames;
      }
    }
  } else if (profile.loopTime >= 0 && counterFrames < profile.loopTime) {
    // Native zero-delta takes 0x10028D73 reverse-boundary path. It is NOT a
    // blanket pause return: repeatedly counter-last(loop)+lastTime until >=loop.
    const span = profile.lastTime - profile.loopTime;
    counterFrames += Math.ceil((profile.loopTime - counterFrames) / span) * span;
    counterNumber(counterFrames, 'reverse-boundary counter'); evalFrame = counterFrames;
  }
  return { counterFrames, evalFrame, playing, layerGate: state.layerGate, progressGate: false, scaledDeltaFrames };
}
