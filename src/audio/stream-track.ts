import type {AudioAsset} from './audio-catalog.ts';
import type {AudioStreamCatalog,DecodedAudioRange} from './stream-catalog.ts';
import {findAudioRange} from './stream-catalog.ts';

interface Span {node:AudioBufferSourceNode;begin:number;end:number;from:number;frames:number}
const lookahead=2.6,lead=0.009,slots=12;
/** A channel clock advances only through scheduled PCM, never through a network gap. */
export class StreamTrack {
  private sourceTotal=0;private played=0;private next=0;private speed=1;
  private active=false;private terminal=false;private loop?:{start:number;end:number};
  private failure:unknown;private task?:Promise<void>;private job?:AbortController;
  private readonly spans:Span[]=[];
  private lastEnd=0;private awakened=false;private timer?:ReturnType<typeof setTimeout>;
  constructor(private readonly context:AudioContext,private readonly catalog:AudioStreamCatalog,
    private readonly item:AudioAsset,private readonly gain:AudioNode,duration:number,loop?:{start:number;end:number},private readonly changed?:(failed:boolean)=>void){
    const time=(s:number)=>Math.round(s*item.sampleRate);
    this.loop=loop&&{start:time(loop.start),end:time(loop.end)};
    if(this.loop&&this.loop.end<=this.loop.start)throw Error('Loop shorter than one source frame');
    this.sourceTotal=time(duration);
  }
  get ready(){return this.awakened||this.terminal&&!this.spans.length;}
  get finished(){return this.active&&this.terminal&&!this.spans.length;}
  /** Unwrapped native seconds; for stalled channels it remains at the last playable frame. */
  sample():number {
    const now=this.context.currentTime;
    if(this.spans[0]&&this.spans[0].begin<=now)this.awakened=true;
    while(this.spans.length&&this.spans[0].end<=now){
      const s=this.spans.shift()!;this.played=s.from+s.frames;s.node.disconnect();
    }
    const current=this.spans[0];
    if(!current||now<current.begin)return this.played/this.item.sampleRate;
    return (current.from+Math.min(current.frames,(now-current.begin)*this.speed*this.item.sampleRate))/this.item.sampleRate;
  }
  scheduledAt(position:number):number {
    for (const s of this.spans) {
      const frames=position*this.item.sampleRate-s.from;
      if (frames>=-0.00001&&frames<=s.frames+0.00001) return s.begin+Math.max(0,frames)/(this.speed*this.item.sampleRate);
    }
    return Infinity;
  }
  get nextStart():number{return this.spans[0]?.begin??Infinity;}
  open(offset:number,speed:number,first?:DecodedAudioRange,opening?:AbortController):void {
    this.stop();this.failure=undefined;this.speed=speed;this.played=this.next=Math.round(offset*this.item.sampleRate);
    this.terminal=false;this.awakened=false;this.active=true;this.job=opening??new AbortController();
    if(first)this.push(first);
    this.pump();
  }
  private sourceFrame():number {
    const l=this.loop;return l&&this.next>=l.end?l.start+(this.next-l.end)%(l.end-l.start):this.next;
  }
  private push(block:DecodedAudioRange):void {
    const frame=this.sourceFrame(),sr=this.item.sampleRate,l=this.loop;
    const end=Math.min(block.last,l?.end??this.sourceTotal);
    if(frame<block.first||frame>=end)throw Error('Decoded audio range does not own the playback cursor');
    const node=this.context.createBufferSource(),now=this.context.currentTime,when=Math.max(this.lastEnd,now+lead),from=this.next;
    node.buffer=block.buffer;node.playbackRate.value=this.speed;node.connect(this.gain);
    const offset=(block.offset+frame-block.first)/sr;
    if(l&&l.start>=block.first&&l.end<=block.last){
      node.loop=true;node.loopStart=(block.offset+l.start-block.first)/sr;node.loopEnd=(block.offset+l.end-block.first)/sr;
      try{node.start(when,offset);}catch(error){node.disconnect();throw error;}
      this.spans.push({node,begin:when,end:Infinity,from,frames:Infinity});this.lastEnd=Infinity;this.job?.abort();return;
    }
    const frames=end-frame,until=when+frames/(sr*this.speed);
    try{node.start(when,offset,frames/sr);}catch(error){node.disconnect();throw error;}
    this.spans.push({node,begin:when,end:until,from,frames});this.lastEnd=until;this.next+=frames;
    this.terminal=!l&&this.next===this.sourceTotal;
  }
  pump():void {
    this.sample();if(this.failure!==undefined)throw this.failure;
    if(!this.active||this.terminal||this.task||this.lastEnd===Infinity)return;
    const until=this.lastEnd-this.context.currentTime-lookahead;
    if(until>0||this.spans.length>=slots){
      if(this.context.state==='running'||!this.changed){
        const slotAt=this.spans.length>=slots?this.spans[0].end-this.context.currentTime:0;
        const delay=this.changed?Math.max(4,Math.ceil(1000*Math.max(until,slotAt))):Math.max(24,Math.min(400,until*1000));
        this.timer??=setTimeout(()=>{this.timer=undefined;try{this.pump();}catch(error){this.failure=error;this.changed?.(true);}},delay);
      }
      return;
    }
    if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}
    if(this.sourceFrame()>=this.sourceTotal){this.terminal=true;return;}
    const job=this.job!,frame=this.sourceFrame(),index=findAudioRange(this.catalog.points(this.item),frame);
    const task=this.catalog.load(this.item,index,job.signal,!this.spans.length).then(block=>{
      if(this.job===job&&!job.signal.aborted){this.sample();this.push(block);}
    }).catch(error=>{if(this.job===job&&!job.signal.aborted)this.failure=error;});
    this.task=task;
    void task.then(()=>{
      if(this.task!==task)return;this.task=undefined;
      if(this.failure===undefined)try{this.pump();}catch(error){this.failure=error;}
      this.changed?.(this.failure!==undefined);
    });
  }
  stop():void {
    this.active=false;if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}this.job?.abort();this.job=undefined;this.task=undefined;this.lastEnd=0;
    for(const s of this.spans.splice(0)){s.node.stop();s.node.disconnect();}
  }
}
