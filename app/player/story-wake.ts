import type {StoryWake} from '../native-session-work.ts';

/** One owned callback, with coalescing while the serialized step/paint receipt
 * is pending. No work is booked for a session without a reason to wake. */
export class StoryWakeQueue {
  private booked?: {id: number; at: number; work: StoryWake};
  private queued?: StoryWake;
  private running = false;
  constructor(private readonly run: (reason: string) => Promise<void>) {}
  request(work: StoryWake): void {
    if(this.running){
      if(!this.queued || work.delay<this.queued.delay) this.queued=work;
      return;
    }
    const at=performance.now()+work.delay;
    if(this.booked){
      if(this.booked.at<=at && (this.booked.work.frame||!work.frame||this.booked.work.delay===0))return;
      this.cancel();
    }
    const start=()=>{
      this.booked=undefined; this.running=true;
      void this.run(work.reason).finally(()=>{
        this.running=false;const next=this.queued;this.queued=undefined;if(next)this.request(next);
      });
    };
    const id=work.frame?requestAnimationFrame(start):window.setTimeout(start,Math.max(0,Math.ceil(work.delay)));
    this.booked={id,at,work};
  }
  cancel(): void {
    this.queued=undefined;
    const booked=this.booked;if(!booked)return;
    this.booked=undefined;
    if(booked.work.frame)cancelAnimationFrame(booked.id);else clearTimeout(booked.id);
  }
}
