/** Bounded speculative bytes. The foreground owns bytes as soon as it takes them. */
export interface PrefetchRequest { readonly url:string; readonly bytes:number; readonly range?:{readonly start:number;readonly size:number} }
export type PrefetchPromotion=(request:PrefetchRequest,bytes:ArrayBuffer)=>void;
export interface PrefetchStats {readonly limit:number;readonly ready:number;readonly reserved:number;readonly hits:number;readonly started:number}
const key=(r:PrefetchRequest)=>r.url+(r.range?'#bytes='+r.range.start+'-'+r.bytes:'');
const end=(r:PrefetchRequest)=>r.range!.start+r.bytes-1;
interface Job {readonly key:string;readonly request:PrefetchRequest;readonly control:AbortController;data?:Uint8Array<ArrayBuffer>}

export class ResourcePrefetch {
  private limit=0;private hits=0;private started=0;private foregroundCount=0;
  private enabled=false;private queued=false;private closed=false;
  private plan:readonly PrefetchRequest[]=[];
  private wanted=new Map<string,PrefetchRequest>();
  private tried=new Set<string>();
  private ready=new Map<string,ArrayBuffer>();
  private active?:Job;
  constructor(bytes:number,readonly promote?:PrefetchPromotion,private readonly changed?:()=>void){this.limit=this.check(bytes);}
  get stats():PrefetchStats {
    let ready=0;for(const b of this.ready.values())ready+=b.byteLength;
    return {limit:this.limit,ready,reserved:this.active&&!this.active.control.signal.aborted?this.active.request.bytes:0,hits:this.hits,started:this.started};
  }
  private check(n:number){if(!Number.isSafeInteger(n)||n<0||n>128_000_000)throw Error('Invalid speculative-resource budget');return n;}
  setLimit(n:number):void {
    n=this.check(n);if(n===this.limit||this.closed)return;
    this.limit=n;this.tried.clear();this.reconcile();
  }
  setPlan(requests:readonly PrefetchRequest[]):void {
    if(this.closed)return;
    this.plan=requests.slice(0,32);this.tried.clear();this.reconcile();
  }
  pause(paused:boolean):void {
    if(this.closed||this.enabled===!paused)return;
    this.enabled=!paused;
    if(paused)this.retire();else this.schedule();
  }
  reset():void {this.setPlan([]);this.pause(true);}
  close():void {this.reset();this.closed=true;}
  private reconcile():void {
    let used=0;const wanted=new Map<string,PrefetchRequest>();
    for(const r of this.plan){
      if(!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>this.limit-used)continue;
      if(r.range&&(!Number.isSafeInteger(r.range.start)||r.range.start<0||!Number.isSafeInteger(r.range.size)||end(r)>=r.range.size))continue;
      const k=key(r);if(wanted.has(k))continue;
      wanted.set(k,r);used+=r.bytes;
    }
    this.wanted=wanted;
    for(const [k,data] of this.ready)if(data.byteLength!==wanted.get(k)?.bytes)this.ready.delete(k);
    if(this.active&&wanted.get(this.active.key)?.bytes!==this.active.request.bytes)this.retire();
    this.schedule();
  }
  take(request:PrefetchRequest):ArrayBuffer|undefined {
    const k=key(request),b=this.ready.get(k);
    this.plan=this.plan.filter(r=>key(r)!==k);this.wanted.delete(k);
    if(this.active?.key===k)this.retire();
    if(!b)return;
    this.ready.delete(k);if(b.byteLength!==request.bytes)return;
    this.hits++;this.schedule();return b;
  }
  async foreground<T>(work:()=>Promise<T>):Promise<T> {
    this.foregroundCount++;this.retire();
    try{return await work();}finally{this.foregroundCount--;this.schedule();}
  }
  private retire():void {
    if(this.active){this.active.data=undefined;this.active.control.abort();}
  }
  private schedule():void {
    if(this.queued||!this.enabled||!this.limit||this.closed||this.active||this.foregroundCount)return;
    this.queued=true;queueMicrotask(()=>{this.queued=false;this.pump();});
  }
  private pump():void {
    if(!this.enabled||!this.limit||this.closed||this.active||this.foregroundCount)return;
    for(const [k,request] of this.wanted){
      if(this.ready.has(k)||this.tried.has(k))continue;
      const {ready,reserved}=this.stats;
      if(ready+reserved+request.bytes>this.limit)continue;
      const job={key:k,request,control:new AbortController()};this.active=job;this.started++;
      this.changed?.();
    void this.fetch(job).catch(()=>{
        // Unavailable speculation is a miss. Actual demanded fetch owns errors.
        if(!job.control.signal.aborted)this.tried.add(k);
      }).finally(()=>{if(this.active===job)this.active=undefined;this.changed?.();this.schedule();});
      break;
    }
  }
  private async fetch(job:Job):Promise<void> {
    const r=job.request,signal=AbortSignal.any([job.control.signal,AbortSignal.timeout(12000)]);
    const response=await fetch(r.url,{cache:'no-store',credentials:'same-origin',redirect:'error',priority:'low',signal,
      headers:{'X-Senren-Prefetch':'1',...(r.range&&{Range:'bytes='+r.range.start+'-'+end(r)})}});
    const contentLength=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');
    const rangeOK=r.range?(response.status===206&&response.headers.get('Content-Range')==='bytes '+r.range.start+'-'+end(r)+'/'+r.range.size)||
        (r.range.start===0&&r.range.size===r.bytes&&response.status===200):response.status===200;
    const body=response.body;
    if(!body||!rangeOK||(contentLength!==null&&contentLength!==String(r.bytes))||(encoding&&encoding!=='identity')){
      await body?.cancel();throw Error('Unexpected speculative resource response');
    }
    signal.throwIfAborted();const read=body.getReader();let used=0,done=false;
    try{
      job.data=new Uint8Array(r.bytes);
      for(;;){
        const chunk=await read.read();signal.throwIfAborted();
        if(chunk.done){done=true;break;}
        if(used+chunk.value.byteLength>r.bytes)throw Error('Speculative resource exceeds reserved bytes');
        job.data!.set(chunk.value,used);used+=chunk.value.byteLength;
      }
      if(used!==r.bytes)throw Error('Incomplete speculative resource');
      if(this.wanted.has(job.key)&&job.data){
        const bytes=job.data.buffer;job.data=undefined;this.active=undefined;
        this.ready.set(job.key,bytes);
      }
    }finally{
      job.data=undefined;
      if(!done)await read.cancel().catch(()=>{});
      read.releaseLock();
    }
  }
}
