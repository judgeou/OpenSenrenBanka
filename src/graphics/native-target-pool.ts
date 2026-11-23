import type { WebGlStage,StageTarget } from './webgl-stage.ts';
interface Entry {readonly target:StageTarget;readonly bytes:number;holds:number;stamp:number}
export interface NativeTargetLease {readonly target:StageTarget;retain():NativeTargetLease;release():void}
export class NativeTargetPool {
  private readonly entries=new Set<Entry>();
  private stamp=0;
  private closed=false;
  constructor(private readonly stage:WebGlStage,private readonly idleBudget=128*1024*1024,private readonly beforeAllocate?:(bytes:number)=>void){
    if(!Number.isSafeInteger(idleBudget)||idleBudget<0)throw Error('Invalid native target pool budget');
  }
  acquire(width:number,height:number):NativeTargetLease {
    if(this.closed)throw Error('Native target pool is closed');
    let entry:Entry|undefined;
    for(const row of this.entries)if(!row.holds&&row.target.texture.width===width&&row.target.texture.height===height&&(!entry||row.stamp>entry.stamp))entry=row;
    if(!entry){
      const bytes=width*height*4;
      this.beforeAllocate?.(bytes);
      entry={target:this.stage.target(width,height),bytes,holds:0,stamp:0};
      this.entries.add(entry);
    }
    return this.lease(entry);
  }
  private lease(entry:Entry):NativeTargetLease {
    entry.holds++;entry.stamp=++this.stamp;let released=false;
    return {target:entry.target,retain:()=>{
      if(released||this.closed)throw Error('Cannot retain released native target');
      return this.lease(entry);
    },release:()=>{
      if(released)return;
      released=true;entry.holds--;entry.stamp=++this.stamp;if(!entry.holds)this.trim();
    }};
  }
  private trim():void {
    // Pinned scene/transition buffers are not spare buffers. Charging both
    // to this budget destroys reusable scratch targets during a live effect.
    const idle=[...this.entries].filter(row=>!row.holds);
    let bytes=idle.reduce((sum,row)=>sum+row.bytes,0);
    for(const row of idle.sort((a,b)=>a.stamp-b.stamp)){
      if(!this.closed&&bytes<=this.idleBudget)break;
      this.entries.delete(row);bytes-=row.bytes;this.stage.release(row.target.texture);
    }
  }
  close():void{this.closed=true;this.trim();}
}
