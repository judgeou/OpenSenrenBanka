import type { StageTexture } from '../webgl-stage.ts';
/** A sampled local image on the SAME WebGlStage as the world compositor.
 * The sample lease, not the instance identity, owns an immutable output target.
 * Sampling never starts another RAF, changes the host clock or dispatches effects.
 */
export interface MotionSampleLease { readonly texture: StageTexture; release(): void }
/** Default AffineSourceMotion adapter calls progress before draw, including dt=0.
 * The compositor owns this explicit logical boundary; sample/capture stay pure.
 * One source commits at most once at the same session logical time.
 */
export interface MotionFrame {
  /** Absent for legacy event-free sources. Does not itself enable an eventful decoder. */
  readonly actions?: import('./action-events.ts').NativeMotionActionPort;
  isFlip(): boolean;
  updateFlip(now: number, layerSpeed: number): void;
  waiting(kind: 'sync' | 'movie'): boolean;
  /** Pure capability/lifetime/clock check; never progresses or evaluates layers. */
  preflightControl(operation: 'sync' | 'stopMovie'): void;
  control(operation: 'sync' | 'stopMovie'): void;
  progressBeforeDraw(now: number): void;
  sample(now: number, grayscale?: boolean): MotionSampleLease;
}
