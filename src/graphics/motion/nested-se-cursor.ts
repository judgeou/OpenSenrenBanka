import {psbRecord} from '../../formats/psb-value.ts';
import type {PsbValue} from '../../formats/psb-value.ts';
import type {MotionActionOutbox} from './action-events.ts';
import type {NativeCounterState} from './native-counter.ts';
import type {NestedSeKey,NestedSeRoot,NestedSeTimeline} from './nested-se-profile.ts';

/** Child counter runs even after a fixed-duration enclosing raster stops. Do not scan on paint/restore. */
export function crossedNestedSe(cue:NestedSeTimeline,before:NativeCounterState,after:NativeCounterState):NestedSeKey[]{
  const start=before.counterFrames, end=start+after.scaledDeltaFrames, period=cue.period;
  if(after.scaledDeltaFrames<0||end-start>period*4)throw Error('Authored nested SE crossed an unsupported counter span');
  const keys:NestedSeKey[]=[];
  for(let origin=Math.floor(start/period)*period;origin<=end;origin+=period)for(const key of cue.keys){
    const t=origin+key.time;
    if(t<=end&&(t>start||before.layerGate&&t===start))keys.push(key);
  }
  return keys;
}
export class NestedSeCursor {
  private pending:NestedSeKey[]=[];
  private dispatched=0;
  private initialized=false;
  private lastFrame=0;
  private lastCounter=0;
  private at=0;
  get profile(){return this.root.profile;}
  constructor(private readonly root:NestedSeRoot,private readonly sourceId:number,private readonly outbox:MotionActionOutbox,saved?:PsbValue){
    if(saved!==undefined){
      const r=psbRecord(saved);
      if(r.schemaVersion!==1n||r.profile!==this.profile||r.sourceId!==sourceId||r.playSerial!==1||typeof r.initialized!=='boolean'||typeof r.lastFrame!=='number'||typeof r.lastCounter!=='number'||!Number.isFinite(r.lastFrame)||r.lastFrame<0||!Number.isFinite(r.lastCounter)||r.lastCounter<r.lastFrame||typeof r.dispatched!=='number'||!Number.isSafeInteger(r.dispatched)||r.dispatched<0||r.enqueued!==r.dispatched||r.activeSlot!==0||!Array.isArray(r.slots)||r.slots.length!==2||r.slots[0]!==0||r.slots[1]!==1)throw Error('Invalid saved nested SE cursor');
      if(!r.initialized&&(r.lastFrame!==0||r.lastCounter!==0||r.dispatched!==0))throw Error('Uninitialized nested SE cursor has history');
      this.initialized=r.initialized;this.lastFrame=r.lastFrame;this.lastCounter=r.lastCounter;this.dispatched=r.dispatched;
    }
  }
  preflight(_owner:string):void{if(this.pending.length||this.outbox.peek())throw Error('Nested SE delivery still pending');this.outbox.preflight(1);}
  validatePlayback(s:NativeCounterState,evaluated:boolean):void{if(this.initialized!==evaluated||s.evalFrame!==this.lastFrame||s.counterFrames!==this.lastCounter)throw Error('Nested SE cursor disagrees with player phase');}
  commitProgress(_prior:NativeCounterState,next:NativeCounterState,now:number,keys:readonly NestedSeKey[]=[]):void{
    if(this.pending.length||keys.length>32||keys.some(k=>!this.root.timeline.keys.includes(k)))throw Error('Nested SE owner exceeded authored cue membership or capacity');
    this.initialized=true;this.lastFrame=next.evalFrame;this.lastCounter=next.counterFrames;this.at=now;this.pending=[...keys];this.publish();
  }
  private publish():void{
    const k=this.pending[0];if(!k)return;
    this.outbox.append({model:this.root.model,object:this.root.object,motion:this.root.motion,label:'se',action:k.action,trackId:k.trackId,frameSourceRef:k.frameSourceRef,contentSourceRef:k.contentSourceRef,sourceId:this.sourceId,playSerial:1,actionOrdinal:this.dispatched+1,now:this.at});
  }
  ack(id:number):void{
    const head=this.outbox.peek();if(!this.pending.length||!head||head.sourceId!==this.sourceId||head.deliveryId!==id||head.actionOrdinal!==this.dispatched+1)throw Error('Nested SE acknowledgement is not its exact head');
    this.outbox.ack(id);this.dispatched++;this.pending.shift();this.publish();
  }
  completedActions():number{return this.dispatched;}
  capture():PsbValue{
    if(this.pending.length)throw Error('Cannot capture pending nested SE delivery');
    return {schemaVersion:1n,profile:this.profile,sourceId:this.sourceId,playSerial:1,initialized:this.initialized,lastFrame:this.lastFrame,lastCounter:this.lastCounter,slots:[0,1],activeSlot:0,enqueued:this.dispatched,dispatched:this.dispatched};
  }
}
