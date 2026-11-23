import {AudioEntity} from '../src/world/audio-entity.ts';
import type {NativeWindow} from './ui/native-window.ts';
import type {WorldHost} from './world-host.ts';
import type {EntityWorld} from '../src/world/entity-world.ts';
import type {NativeServices} from './native-services.ts';
import type {NativeVoices} from './native-voices.ts';
import type {SessionCommandRouter} from './command-preflight.ts';
import type {ApplicationBridge} from './scene-bridge.ts';
import type {ScenePlayer} from '../src/runtime/scene-player.ts';
import type {NativeSessionDriver} from '../src/runtime/native-session-driver.ts';

export type StoryWake = { readonly reason: string; readonly delay: number; readonly frame?: boolean };
export interface DemandObserver { wake(reason: string): void; painted?(reason: string): void; prefetchChanged?(): void }

/** Stamps represent submitted game pixels. A later UI/input/size change cannot certify a new frame. */
export class StoryPresentation {
  private committedStamp?: string;
  private resizeSerial = 0;
  private plannedResize = 0;
  private reason = 'initial-or-restore';
  constructor(private readonly revisions: () => readonly number[],
      private readonly animation: () => string | undefined, private readonly observer: DemandObserver,
      private readonly uncovering: () => boolean, private readonly covered: () => boolean) {}
  invalidate(): void { this.resizeSerial++; }
  private stamp(resize: number): string { return [resize, ...this.revisions()].join('/'); }
  request(): boolean {
    this.plannedResize = this.resizeSerial;
    const moving = this.animation();
    if (moving) { this.reason = moving; return true; }
    if (this.uncovering()) { this.reason = 'movie-handoff'; return true; }
    // While opaque video owns the surface, known static world dirt can wait. Never
    // suppress sampling a transition, raster or an MTN timeline (even below video).
    if (this.covered() || this.committedStamp === this.stamp(this.resizeSerial)) return false;
    this.reason = 'dirty-scene'; return true;
  }
  committed(): void {
    this.committedStamp = this.stamp(this.plannedResize);
    this.observer.painted?.(this.reason);
    this.reason = 'initial-or-restore';
  }
}

/** Audio callbacks only request a wake. This coordinator consumes their events
 * in the same serialized queue as authored waits and user input. */
export function ownSynchronization({player,ui,router,bridge,host,world,voices,services,wake}: {
  player:ScenePlayer;ui:NativeWindow;router:SessionCommandRouter;bridge:ApplicationBridge;host:WorldHost;
  world:EntityWorld;voices:NativeVoices;services:NativeServices;wake?:DemandObserver['wake'];
}) {
  return async () => {
    if(player.clock.snapshot().paused){ui.retireInputs();return;}
    const talk=router.takeTalkDelay(player.playback.skip!=='none');if(talk!==undefined)await bridge.numericSignal(talk);
    host.synchronize();for(const name of world.names){const entity=world.get(name);if(entity instanceof AudioEntity)entity.tick();}
    if(player.waiting.kind==='dialogue'||player.waiting.kind==='choice')services.onMessageOrChoice();
    await voices.tick();await ui.synchronize();if(host.waits.poll(token=>player.notify(token)))wake?.('wait-released');
    ui.tick(player.playback,voices.normalPlaying);if(host.transitionActive||player.hostWaits.length)ui.retireInputs();
  };
}

/** Only an explicitly active animation/unknown world wait asks for display cadence.
 * Pure events point to their first real deadline, or wake from their owner callback. */
export function planStoryWake(driver: NativeSessionDriver, player: ScenePlayer, timing: {
  visual: string | undefined; fallback: string | undefined; ui: number; wait: number; talk: number; audio: number;
}): StoryWake | undefined {
  const chooseFrame = (reason: string): StoryWake => ({reason,delay:0,frame:true});
  const frame = driver.awaitingPresentation ? 'held-frame' : driver.starting ? 'startup' : timing.visual ?? timing.fallback;
  driver.setContinuous(!!frame);
  if (frame) return chooseFrame(frame);
  let next: StoryWake|undefined;
  const clock=player.clock.snapshot(), at=driver.projectedTime;
  function consider(reason: string, delay: number) {
    if (Number.isFinite(delay) && (!next || delay < next.delay)) next={reason,delay:Math.max(0,delay)};
  }
  const logical=(reason:string,time:number)=>consider(reason,(time-at)/clock.rate);
  logical('ui-deadline',timing.ui); logical('original-wait',timing.wait); logical('talk-delay',timing.talk);
  consider('audio-deadline',timing.audio);
  const w=player.waiting, skip=player.playback.skip;
  if (player.hostWaits.length || player.position.ended) return next;
  if(w.kind==='none'||w.kind==='external'&&(!w.tokens.length||w.interruptible&&skip!=='none')) return chooseFrame('story-ready');
  if(w.kind==='time'){
    if(w.skippable&&skip!=='none')return chooseFrame('skip-time');
    logical('scene-time',w.until);
  } else if(w.kind==='dialogue'){
    if(skip!=='none'&&(!w.reveal||!w.tokens.includes(w.reveal)))return chooseFrame('skip-dialogue');
    if(player.playback.auto&&!w.tokens.length)logical('auto-line',w.autoAt??clock.time);
  }
  return next;
}

export function cleanupFor(context: AudioContext) {
  const closers: (() => void | Promise<void>)[] = [];
  const dispose = async () => { const errors: unknown[] = []; for (const close of closers.splice(0).reverse()) try { await close(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, '原会话资源释放失败'); };
  closers.push(async () => { if (context.state !== 'closed') await context.close(); });
  return {closers,dispose};
}
