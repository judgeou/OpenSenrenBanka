export interface MotionClockState { readonly frame: number; readonly loops: number; readonly paused: boolean; readonly finished: boolean }
export class MotionClock {
  private frame = 0; private loops = 0; private paused = false; private finished = false;
  private readonly last: number; private readonly fps: number; private readonly loop: { readonly start: number; readonly end: number } | undefined;
  constructor(lastFrame: number, framesPerSecond: number, loop?: { readonly start: number; readonly end: number }) {
    if (!Number.isFinite(lastFrame) || lastFrame < 0 || !Number.isFinite(framesPerSecond) || framesPerSecond <= 0 || framesPerSecond > 1000) throw new Error('Invalid motion clock profile');
    if (loop && (!Number.isFinite(loop.start) || !Number.isFinite(loop.end) || loop.start < 0 || loop.end <= loop.start || loop.end > lastFrame)) throw new Error('Invalid motion loop range');
    this.last = lastFrame; this.fps = framesPerSecond; this.loop = loop && { ...loop };
  }
  get state(): MotionClockState { return { frame: this.frame, loops: this.loops, paused: this.paused, finished: this.finished }; }
  setPaused(paused: boolean): void { this.paused = paused; }
  seek(frame: number): void { if (!Number.isFinite(frame) || frame < 0 || frame > this.last) throw new Error('Motion seek is outside duration'); this.frame = frame; this.finished = !this.loop && frame >= this.last; }
  advance(milliseconds: number, rate = 1): MotionClockState {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(rate) || rate < 0 || rate > 1000) throw new Error('Invalid motion time delta');
    if (this.paused || this.finished) return this.state;
    let frame = this.frame + milliseconds * rate * this.fps / 1000;
    if (!Number.isFinite(frame)) throw new Error('Motion time overflow');
    if (this.loop && frame >= this.loop.end) {
      const span = this.loop.end - this.loop.start, loops = Math.floor((frame - this.loop.start) / span);
      this.loops += loops; frame = this.loop.start + (frame - this.loop.start) % span;
    } else if (!this.loop && frame >= this.last) { frame = this.last; this.finished = true; }
    this.frame = frame; return this.state;
  }
  restore(state: MotionClockState): void {
    if (!Number.isSafeInteger(state.loops) || state.loops < 0 || typeof state.paused !== 'boolean') throw new Error('Invalid saved motion clock');
    this.seek(state.frame); this.loops = state.loops; this.paused = state.paused;
    if (state.finished !== this.finished) throw new Error('Saved motion completion is inconsistent');
  }
}
