import type { PsbValue } from '../../formats/psb-value.ts';
import { assignCounter, counterNumber, validateCounter, progressCounter } from './native-counter.ts';
import type { NativeCounterProfile, NativeCounterState } from './native-counter.ts';

export type RasterPlaybackProfile = NativeCounterProfile;
export interface RasterPlaybackState extends NativeCounterState {
  readonly speed: boolean; // Only original numeric 0/1 profile is currently exposed.
  readonly pendingFrames: number; // Explicit source _interval collected by flip.
  readonly atBoundary: boolean;
  readonly evaluated: boolean;
}
export function rasterInitialSpeed(value: PsbValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (value === false || value === 0 || value === 0n || typeof value === 'string' && value.trim() === '0') return false;
  if (value === true || value === 1 || value === 1n || typeof value === 'string' && value.trim() === '1') return true;
  throw new Error('Unsupported MTN speed: only native numeric 0/1 is implemented');
}
/** Explicit root progress -> outer updateLayers. Native counters and two gates
 * are shared with child Players; no old elapsed/timeline/tick projection.
 * sample/capture cannot clear a gate or synthesize a progress interval.
 */
export class RasterPlayback {
  private origin: number;
  private state: RasterPlaybackState;
  private boundary: number | undefined;
  constructor(readonly profile: RasterPlaybackProfile, now: number, state: RasterPlaybackState) {
    counterNumber(now, 'logical origin'); validateCounter(profile, state);
    counterNumber(state.pendingFrames, 'pending interval');
    if (typeof state.speed !== 'boolean' || typeof state.atBoundary !== 'boolean' || typeof state.evaluated !== 'boolean' || state.atBoundary && (state.pendingFrames !== 0 || !state.evaluated || state.layerGate || state.progressGate) || !state.evaluated && (!state.layerGate || !state.progressGate || !state.playing || state.counterFrames !== 0 || state.atBoundary)) throw new Error('Invalid MTN root evaluation boundary');
    this.origin = now; this.state = { ...state }; this.boundary = state.atBoundary ? now : undefined;
  }
  private time(now: number): void {
    counterNumber(now, 'logical time');
    if (now < this.origin) throw new Error('MTN logical time moved before instance boundary');
  }
  collect(frames: number): void {
    counterNumber(frames, 'collected interval');
    const pendingFrames = counterNumber(this.state.pendingFrames + frames, 'pending interval');
    // A newly delivered positive interval needs a draw even if a zero-interval
    // draw already happened at this now. Never let timestamp dedup swallow it.
    if (frames > 0) this.boundary = undefined;
    this.state = { ...this.state, pendingFrames, atBoundary: frames > 0 ? false : this.state.atBoundary };
  }
  get playing(): boolean { return this.state.playing; }
  advance(now: number, evaluate: (frame: number, counter: number, scaledDelta: number) => void): boolean {
    this.time(now); if (this.boundary === now) return false;
    const next = progressCounter(this.profile, this.state, this.state.pendingFrames, this.state.speed);
    // updateLayers still runs when scaledDelta=0 or root playing=false. Children
    // receive this invocation's scaled delta, NEVER a retained previous delta.
    evaluate(next.evalFrame, next.counterFrames, next.scaledDeltaFrames);
    this.state = { ...next, layerGate: false, speed: this.state.speed, pendingFrames: 0, atBoundary: true, evaluated: true };
    this.origin = now; this.boundary = now; return true;
  }
  /** Pure validation only: no counter prediction, layer evaluation or gates. */
  preflightControl(operation: 'sync' | 'stopMovie', now: number): void {
    this.time(now);
    if (operation !== 'sync' && operation !== 'stopMovie') throw new Error('Unknown native MTN control');
    validateCounter(this.profile, this.state);
    if (typeof this.state.speed !== 'boolean') throw new Error('Unsupported native MTN control speed');
    // Conservative arithmetic headroom, not a speculative progress invocation.
    if (this.profile.lastTime > Number.MAX_SAFE_INTEGER - 1 || this.state.counterFrames > Number.MAX_SAFE_INTEGER - 1) throw new Error('MTN control counter exceeds finite range');
  }
  /** Explicit original adapter control, not a draw and not a clock tick.
   * skipToSync -> progress(1 millisecond) -> stop (stopMovie only). Tags are
   * already rejected by the decoder, so native skip's candidate is lastTime.
   */
  control(operation: 'sync' | 'stopMovie', now: number, evaluate: (frame: number, counter: number, scaledDelta: number) => void): void {
    this.time(now);
    if (operation !== 'sync' && operation !== 'stopMovie') throw new Error('Unknown native MTN control');
    if (operation === 'sync' && !this.state.playing) return;
    const before = this.state.playing && this.profile.loopTime < 0
      ? assignCounter(this.profile, this.state, this.profile.lastTime) : this.state;
    // Do NOT call advance(now): its draw dedup and _interval consumption are
    // intentionally unrelated to this mandatory, repeatable command step.
    const next = progressCounter(this.profile, before, 60 / 1000, this.state.speed);
    evaluate(next.evalFrame, next.counterFrames, next.scaledDeltaFrames);
    this.state = { ...next, layerGate: false, playing: operation === 'stopMovie' ? false : next.playing,
      speed: this.state.speed, pendingFrames: this.state.pendingFrames,
      atBoundary: this.boundary === now, evaluated: true };
    // Keep the prior DRAW boundary, whether it existed or not. The next actual
    // draw must still consume any queued source interval, without replaying the
    // control step on capture/restore. Adapter moviePlaying is not touched here.
    this.origin = now;
  }
  capture(now: number): RasterPlaybackState { this.time(now); return { ...this.state, atBoundary: this.boundary === now }; }
  frame(now: number): number { this.time(now); return this.state.evalFrame; }
}
