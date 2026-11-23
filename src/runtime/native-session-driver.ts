import { ScenePlayer } from './scene-player.ts';
import type { PlayerSnapshot, PumpResult } from './types.ts';
import type { PlaybackMode } from './playback-gate.ts';
import type { NativeGraphics } from '../graphics/native-graphics.ts';
import type { WebAudioEngine } from '../audio/web-audio-engine.ts';
export interface NativeSessionFrame { readonly scene: PumpResult | undefined; readonly painted: boolean; readonly blockedMilliseconds: number }
/** Concrete application coordinator. None of these hooks may enqueue and await this driver. */
export interface NativeSessionLoop {
  beginStart(storage: string, target: string): Promise<void>;
  advanceStart(): Promise<boolean>;
  afterRestore(): Promise<void>;
  /** Consume queued audio/external events, UI time and waits at this logical time. */
  synchronize(): Promise<void>;
  /** Acknowledge UI/transition completion only after actual presentation. */
  afterPaint(painted: boolean): Promise<boolean>;
  canPresent(): boolean;
  /** Optional staged event consumer. Called only on this driver's serialized owner. */
  paint?(now: number, advance: boolean): Promise<boolean>;
  /** False means a hidden page could not accept unpause; keep the presentation hold. */
  pause(stageHeld: boolean, suspendAudio?:boolean): Promise<boolean>;
  assertSaveBoundary(): Promise<void>;
  readonly demand?: { needsPaint(): boolean; committed(): void; withoutPaint(): void };
}
/** A rejected user operation with no world mutation is recoverable (e.g. unstable save boundary). */
export class SessionBoundaryUnavailable extends Error { readonly name = 'SessionBoundaryUnavailable'; }
/** Single production owner of pump/UI/audio/paint/input/save. Frame requests coalesce;
 * failures latch until this instance is closed, never continue a half-restored world. */
export type PauseScope = 'story' | 'all';
export class NativeSessionDriver {
  readonly player: ScenePlayer;
  private pending: Promise<void> = Promise.resolve();
  private accepting = true;
  private started = false;
  private needsPresentation = false;
  private launch: { storage: string; target: string } | undefined;
  private closing: Promise<void> | undefined;
  private stepping: Promise<NativeSessionFrame> | undefined;
  private fault: Error | undefined;
  private wall?: number;
  private continuous = false;
  get starting(): boolean { return !!this.launch; }
  setContinuous(value: boolean): void { this.continuous = value; }
  get projectedTime(): number {
    const clock = this.player.clock.snapshot();
    return clock.time + (clock.paused || this.needsPresentation || !this.loop.canPresent() ? 0 : this.wallGap(performance.now()) * clock.rate);
  }
  private wallGap(at: number): number { return this.wall === undefined ? 0 : Math.min(this.continuous ? 100 : Infinity, Math.max(0,at-this.wall)); }
  private readonly pauseReasons = new Map<string,PauseScope>();
  private audioHeld=false;
  constructor(player: ScenePlayer, private readonly graphics: NativeGraphics, private readonly audio: WebAudioEngine,
    private readonly dispose: () => Promise<void>, private readonly loop: NativeSessionLoop) { this.player = player; }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Native session is closing'));
    const next = this.pending.then(async () => {
      if (this.fault) throw this.fault;
      const at = performance.now(), held = this.needsPresentation || !this.loop.canPresent() || this.player.clock.snapshot().paused;
      if (this.loop.demand) {
        if (!held && (this.started || this.launch)) this.player.clock.advance(this.wallGap(at));
        this.wall = at;
      }
      try { return await operation(); }
      catch (error) { if (error instanceof SessionBoundaryUnavailable) throw error; this.fault = error instanceof Error ? error : new Error(String(error));
        this.player.clock.setPaused(true); try { await this.loop.pause(true); } catch (pauseError) { this.fault = new AggregateError([this.fault, pauseError], this.fault.message + '; own-audio pause failed'); } throw this.fault; }
      finally {
        const done = performance.now();
        if (this.loop.demand && (held || this.needsPresentation || done-at>100)) this.wall = done;
      }
    });
    this.pending = next.then(() => {}, () => {}); return next;
  }
  /** Application operations execute inline here, not from DOM/Audio/RAF callbacks. */
  action<T>(operation: () => Promise<T>): Promise<T> { return this.enqueue(operation); }
  get awaitingPresentation(): boolean { return this.needsPresentation; }
  private async synchronize(): Promise<void> { this.audio.tick(); await this.loop.synchronize(); }
  private async paint(advance: boolean): Promise<boolean> {
    const now=this.player.clock.now;
    const painted=await (this.loop.paint?.(now,advance)??this.graphics.frame(now,advance));
    if(painted) this.loop.demand?.committed();
    return painted;
  }
  /** Held restores/resumes discard wall-time and never pump until a real visible paint is acknowledged. */
  private async presentHeldFrame(): Promise<boolean> {
    if (this.player.clock.snapshot().paused || !this.loop.canPresent()) return false;
    const painted = await this.paint(false);
    this.needsPresentation = !await this.loop.afterPaint(painted);
    if (!this.needsPresentation) this.needsPresentation = !await this.applyHold(false);
    return painted;
  }
  async start(storage: string, target = ''): Promise<void> {
    return this.enqueue(async () => {
      if (this.started || this.launch) throw new Error('Restart requires a fresh owned session');
      await this.loop.beginStart(storage, target); this.launch = { storage, target }; await this.synchronize();
    });
  }
  private pump(eventBudget = 2000): Promise<PumpResult> {
    // A real read-skip can encounter hundreds of original audio/image switches. Yield to the
    // same frame owner so stopped sources, labels, and GPU work retire between ordered batches.
    return this.player.pump(this.player.playback.skip === 'none' ? eventBudget : Math.min(eventBudget, 24));
  }
  step(milliseconds: number, eventBudget = 2000): Promise<NativeSessionFrame> {
    if (this.stepping) return this.stepping;
    const requestedAt = performance.now();
    const pending = this.enqueue(async () => {
      if (this.needsPresentation) { const painted = await this.presentHeldFrame(); return { scene: undefined, painted, blockedMilliseconds: performance.now() - requestedAt }; }
      if (!this.loop.demand) this.player.clock.advance(milliseconds);
      await this.synchronize();
      if (this.launch && !this.player.clock.snapshot().paused && await this.loop.advanceStart()) { const launch = this.launch; this.launch = undefined; await this.player.start(launch.storage, launch.target); this.started = true; await this.synchronize(); }
      const scene = this.started ? await this.pump(eventBudget) : undefined;
      await this.synchronize();
      let painted = false;
      if (!this.loop.demand || this.loop.canPresent() && this.loop.demand.needsPaint()) {
        painted = await this.paint(!this.player.clock.snapshot().paused);
        this.audio.tick(); await this.loop.afterPaint(painted);
      } else if (this.loop.canPresent()) this.loop.demand.withoutPaint();
      return { scene, painted, blockedMilliseconds: performance.now() - requestedAt };
    });
    this.stepping = pending;
    void pending.finally(() => { if (this.stepping === pending) this.stepping = undefined; }).catch(() => {});
    return pending;
  }
  input(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.started) throw new SessionBoundaryUnavailable('原开始流程尚未结束');
      if (this.player.clock.snapshot().paused || this.needsPresentation) return;
      await this.synchronize(); await this.player.input(); await this.pump();
    });
  }
  choose(index: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.started) throw new SessionBoundaryUnavailable('原开始流程尚未结束');
      if (this.player.clock.snapshot().paused || this.needsPresentation) return;
      await this.synchronize(); await this.player.choose(index); await this.pump();
    });
  }
  mode(change: Partial<PlaybackMode>): Promise<void> { return this.enqueue(async () => { this.player.setMode(change); }); }
  private async applyHold(held:boolean,suspendAudio=held){
    const accepted=await this.loop.pause(held,suspendAudio);
    if(accepted&&!suspendAudio&&this.audioHeld)this.audio.tick(); // Re-arm suspended streams, without delivering story events.
    this.audioHeld=suspendAudio||!accepted||!this.loop.canPresent();
    return accepted;
  }
  pause(value:boolean,reason='user',scope:PauseScope='all'):Promise<void>{
    return this.enqueue(async()=>{
      if(!reason||reason.length>128)throw Error('Invalid pause owner');
      if(value)this.pauseReasons.set(reason,scope);else this.pauseReasons.delete(reason);
      const paused=this.pauseReasons.size>0;
      if(!this.needsPresentation)await this.synchronize();
      this.player.clock.setPaused(paused);if(paused)this.needsPresentation=true;
      const held=paused||this.needsPresentation;
      const hard=!this.loop.canPresent()||[...this.pauseReasons.values()].includes('all');
      // On return from a real suspension, wait for presentation except if a visible menu still owns the stage.
      if(!await this.applyHold(held,hard||(!paused&&this.needsPresentation&&this.audioHeld))&&!held)this.needsPresentation=true;
    });
  }
  paintBacklog():Promise<boolean>{return this.enqueue(()=>this.paint(false));}
  private async saveReady(){
    if (!this.started) throw new SessionBoundaryUnavailable('原开始流程尚未结束');
    if (this.needsPresentation) throw new SessionBoundaryUnavailable('等待画面真实提交后再保存');
    await this.synchronize(); await this.loop.assertSaveBoundary();
  }
  save(): Promise<PlayerSnapshot> {return this.enqueue(async()=>{await this.saveReady();return this.player.save();});}
  saveWithThumbnail(capture:()=>Promise<Blob>){
    return this.enqueue(async()=>{
      await this.saveReady();
      let thumbnail:Blob;
      try{thumbnail=await capture();}catch(error){throw new SessionBoundaryUnavailable('不能采集当前存档画面：'+String(error));}
      const snapshot=await this.player.save();return {snapshot,thumbnail};
    });
  }
  restore(snapshot: PlayerSnapshot,beforeText?:string): Promise<void> {
    return this.enqueue(async () => {
      if (this.started || this.launch || this.player.position.asset) throw new SessionBoundaryUnavailable('加载必须使用新会话');
      await this.applyHold(true); await this.player.restore(snapshot,beforeText); this.started = true; await this.loop.afterRestore();
      const paused = this.pauseReasons.size > 0; this.needsPresentation = true;
      this.player.clock.setPaused(paused); if (!paused) { await this.synchronize(); await this.presentHeldFrame(); }
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.accepting = false; this.closing = this.pending.then(() => this.dispose()); return this.closing;
  }
}
