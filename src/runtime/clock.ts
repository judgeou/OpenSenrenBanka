export interface ClockSnapshot { readonly time: number; readonly rate: number; readonly paused: boolean }
export class LogicalClock {
  private time = 0; private rate = 1; private paused = false;
  get now(): number { return this.time; }
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Invalid logical time delta');
    if (!this.paused) this.time += milliseconds * this.rate;
    if (!Number.isFinite(this.time)) throw new Error('Logical time overflow');
  }
  setRate(rate: number): void { if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new Error('Invalid logical time rate'); this.rate = rate; }
  setPaused(paused: boolean): void { this.paused = paused; }
  snapshot(): ClockSnapshot { return { time: this.time, rate: this.rate, paused: this.paused }; }
  restore(value: ClockSnapshot): void {
    if (!Number.isFinite(value.time) || value.time < 0 || typeof value.paused !== 'boolean') throw new Error('Invalid saved clock');
    this.setRate(value.rate); this.time = value.time; this.paused = value.paused;
  }
}
