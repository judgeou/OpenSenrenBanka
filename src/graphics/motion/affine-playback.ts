import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { RasterPlayback } from './raster-playback.ts';

export interface AffinePlaybackState {
  readonly moviePlaying: boolean;
  readonly lastPlaying: boolean;
  /** Logical gap not yet delivered by updateFlip; NOT the source _interval. */
  readonly uncollectedMilliseconds: number;
  readonly atFlipBoundary: boolean;
}
export function affineState(value: PsbValue): AffinePlaybackState {
  const row = psbRecord(value);
  if (typeof row.moviePlaying !== 'boolean' || typeof row.lastPlaying !== 'boolean' || typeof row.atFlipBoundary !== 'boolean' || typeof row.uncollectedMilliseconds !== 'number' || !Number.isFinite(row.uncollectedMilliseconds) || row.uncollectedMilliseconds < 0 || row.uncollectedMilliseconds > Number.MAX_SAFE_INTEGER || row.atFlipBoundary && row.uncollectedMilliseconds !== 0 || row.lastPlaying && !row.moviePlaying) throw new Error('Invalid saved MTN affine completion state');
  return { moviePlaying: row.moviePlaying, lastPlaying: row.lastPlaying, atFlipBoundary: row.atFlipBoundary, uncollectedMilliseconds: row.uncollectedMilliseconds };
}
/** Original 00766 adapter: updateFlip collects interval and detects the Player
 * playing edge; _drawAffine separately consumes interval through progress.
 * No event callback, RAF, target lease or clock is owned by this state machine.
 */
export class AffinePlayback {
  private origin: number;
  private boundary: number | undefined;
  private state: AffinePlaybackState;
  constructor(private readonly root: RasterPlayback, private readonly childPlaying: () => boolean, now: number, state: AffinePlaybackState) {
    this.origin = now; this.state = affineState({ ...state }); this.boundary = state.atFlipBoundary ? now : undefined;
  }
  isFlip(): boolean { return this.root.playing || this.childPlaying() || this.state.lastPlaying; }
  movieWaiting(): boolean { return this.state.moviePlaying; }
  private gap(now: number): number {
    if (!Number.isFinite(now) || now < this.origin || now > Number.MAX_SAFE_INTEGER) throw new Error('Invalid MTN affine logical time');
    const gap = this.state.uncollectedMilliseconds + now - this.origin;
    if (!Number.isFinite(gap) || gap > Number.MAX_SAFE_INTEGER) throw new Error('MTN affine interval exceeds numeric bounds');
    return gap;
  }
  updateFlip(now: number, layerSpeed: number): void {
    const gap = this.gap(now);
    if (this.boundary === now || !this.isFlip()) return;
    if (!Number.isFinite(layerSpeed) || layerSpeed < 0) throw new Error('Unsupported MTN affine layer speed');
    // Layer speed scales updateFlip; the exposed root 0/1 speed scales each
    // native progress delta separately (it is not an early-return pause gate).
    this.root.collect(gap * layerSpeed * 60 / 1000);
    const playing = this.root.playing;
    // onMotionStop: clear adapter _playing, then onMovieStop. The existing host
    // polls this committed state in its queue; no asynchronous script dispatch.
    this.state = { moviePlaying: !playing && this.state.lastPlaying ? false : this.state.moviePlaying,
      lastPlaying: playing, uncollectedMilliseconds: 0, atFlipBoundary: true };
    this.origin = now; this.boundary = now;
  }
  capture(now: number): AffinePlaybackState {
    const gap = this.gap(now);
    return { ...this.state, uncollectedMilliseconds: this.isFlip() ? gap : 0, atFlipBoundary: this.boundary === now };
  }
}
