import type { PlaybackMode, PlaybackWait } from './playback-gate.ts';

/** Original beginskip holds the prior user choice; it does not turn on read-skip. */
export class ScriptSkipWindow {
  private previous: PlaybackMode['skip'] | undefined;
  get open(): boolean { return this.previous!==undefined; }
  begin(mode: PlaybackMode): void {
    if (this.open) throw new Error('Nested original beginskip');
    this.previous=mode.skip;
    if (mode.skip!=='none') mode.skip='all';
  }
  end(mode: PlaybackMode): void {
    if (this.previous===undefined) throw new Error('Original endskip has no beginskip');
    mode.skip=this.previous; this.previous=undefined;
  }
  input(mode: PlaybackMode, wait: PlaybackWait, interrupted: boolean): void {
    if (this.open && (interrupted || wait.kind==='time' && wait.skippable || wait.kind==='external' && wait.interruptible)) mode.skip='all';
  }
}
