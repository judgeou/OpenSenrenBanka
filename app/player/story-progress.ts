import type {NativeSession,SystemProgressData} from '../native-session.ts';

/** Batch real read/flag changes with one trailing write; lifecycle flushes
 * share the same order instead of racing an earlier autosave. */
export class StoryProgress {
  private timer?:number;
  private owner?:NativeSession;
  private saved?:string;
  private lastWrite=-Infinity;
  private pending=Promise.resolve();
  constructor(private readonly write:(data:SystemProgressData)=>Promise<void>,private readonly issue:(error:unknown)=>void){}
  attach(session?:NativeSession):void {
    this.cancel();this.owner=session;this.saved=undefined;this.lastWrite=-Infinity;
  }
  private cancel(){if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}}
  changed():void {
    if(!this.owner||this.saved===this.owner.systemRevision?.()||this.timer!==undefined)return;
    const delay=this.lastWrite+1300-performance.now();
    if(delay<=0){void this.flush(this.owner).catch(this.issue);return;}
    this.timer=window.setTimeout(()=>{this.timer=undefined;if(this.owner)void this.flush(this.owner).catch(this.issue);},Math.ceil(delay));
  }
  flush(session:NativeSession,force=false):Promise<void> {
    const revision=session.systemRevision?.();
    if(session===this.owner){this.cancel();if(!force&&this.saved===revision)return this.pending;this.saved=revision;this.lastWrite=performance.now();}
    const data=session.systemProgress();
    const next=this.pending.then(()=>this.write(data));this.pending=next.catch(()=>{});
    return next.catch(error=>{if(this.owner===session&&this.saved===revision)this.saved=undefined;throw error;});
  }
}
