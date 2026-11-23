import {decodePlayerSnapshot,encodePlayerSnapshot} from './save-codec.ts';
import type {HistoryEntry,PlayerPosition,PlayerSnapshot} from './types.ts';
import type {ScriptValue} from '../script/types.ts';

const maxRows=160,maxTargets=32,maxBytes=12*1024*1024,maxTarget=768*1024,maxTextRows=4000;
export interface SceneHistoryRow {
  readonly id:number;readonly entry:HistoryEntry;readonly title:string;readonly ready:boolean;
}
interface Mark {readonly id:number;readonly entry:HistoryEntry;readonly title:string;seal?:string;bytes:number}
interface Candidate {key:string;title:string;seal?:string;bytes:number}
export interface ReplayPlan {
  readonly identity:string;readonly entry:HistoryEntry;readonly snapshot:PlayerSnapshot;readonly journal:LiveSceneHistory;
}
/** No slot I/O. The journal stores only already-executed representatives and bounded,
 * world-only replay seals. A missing/evicted seal deliberately remains read-only. */
export class LiveSceneHistory {
  private records:Mark[]=[];
  private pending?:Candidate;
  private next=0;
  private bytes=0;
  private lastText?:{asset:string;scene:number;text:number};
  constructor(readonly identity:string){}
  get count(){return this.records.length;}
  needsText(asset:string,scene:number,label:string|null,text:number){
    const prior=this.lastText;
    this.lastText={asset,scene,text};
    const same=prior&&prior.asset===asset&&prior.scene===scene&&prior.text+1===text;
    return this.next===0||!same&&!!label&&/^chapter|:/u.test(label.replace(/^\*/u,''));
  }
  async offer(key:string,title:string,make:()=>Promise<PlayerSnapshot>){
    this.pending={key,title,bytes:0};
    try{
      const seal=encodePlayerSnapshot(await make()),bytes=new TextEncoder().encode(seal).byteLength;
      if(bytes<=maxTarget)this.pending={key,title,seal,bytes};
    }catch{/* An unsupported boundary stays browsable without being advertised as recoverable. */}
  }
  append(entry:HistoryEntry,title:string){
    const id=this.next++,marker=this.pending;this.pending=undefined;
    if(entry.kind==='choice')this.lastText=undefined;
    if(marker?.key===entry.key){
      this.records.push({id,entry,title:marker.title||title,seal:marker.seal,bytes:marker.bytes});this.bytes+=marker.bytes;
    }
    this.trim();
  }
  private trim(){
    while(this.records.length>maxRows||(this.records[0]?.id??Infinity)<this.next-maxTextRows)this.bytes-=this.records.shift()!.bytes;
    let targets=this.records.filter(x=>x.seal).length;
    for(const mark of this.records){
      if(targets<=maxTargets&&this.bytes<=maxBytes)break;
      if(!mark.seal)continue;this.bytes-=mark.bytes;targets--;mark.bytes=0;mark.seal=undefined;
    }
  }
  seedHistory(history:readonly HistoryEntry[]){
    if(this.next||this.records.length)return;
    this.next=history.length;
    // Legacy slots have text; retained choice summaries are readable, never fabricated as targets.
    this.records=history.flatMap((entry,id)=>id===0||entry.kind==='choice'?[{id,entry,title:'',bytes:0}]:[]).slice(-maxRows);
  }
  rows(position:PlayerPosition):SceneHistoryRow[]{
    return this.records.map(mark=>({id:mark.id,entry:mark.entry,title:mark.title,
      ready:!!mark.seal&&(mark.entry.kind==='choice'?mark.entry.location.asset!==position.asset||mark.entry.location.scene!==position.scene:mark.entry.key!==position.currentText)}));
  }
  plan(id:number,history:readonly HistoryEntry[],position:PlayerPosition,read:readonly string[],sf:Record<string,ScriptValue>):ReplayPlan{
    const mark=this.records.find(x=>x.id===id),from=this.next-history.length;
    if(!mark?.seal||id<from||id>=this.next||history[id-from]?.key!==mark.entry.key||!this.rows(position).some(x=>x.id===id&&x.ready))throw Error('这个剧情位置没有可恢复的现场');
    const snapshot=decodePlayerSnapshot(mark.seal),journal=new LiveSceneHistory(this.identity);
    journal.next=id;
    journal.records=this.records.filter(x=>x.id<id).map(x=>({...x}));
    journal.bytes=journal.records.reduce((sum,x)=>sum+x.bytes,0);
    const {globals}=snapshot.script;
    // Local branch variables are positional. System progress and previously read keys never rewind.
    return {identity:this.identity,entry:mark.entry,journal,snapshot:{...snapshot,read:[...read],history:history.slice(0,id-from),
      script:{globals:{...globals,sf}},mode:{...snapshot.mode,auto:false,skip:'none'}}};
  }
}
export interface SceneHistoryRecorder { journal:LiveSceneHistory;caption:()=>string;capture:(work:()=>Promise<PlayerSnapshot>)=>Promise<PlayerSnapshot>;eligible:()=>boolean }
export function captureHistory(log:SceneHistoryRecorder,key:string,blocked:()=>boolean,work:()=>Promise<PlayerSnapshot>){
  return log.journal.offer(key,log.caption(),()=>{if(blocked()||!log.eligible())throw Error('Unavailable scene boundary');return log.capture(work);});
}
