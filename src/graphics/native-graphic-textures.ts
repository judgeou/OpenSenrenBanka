import type { WebGlStage,StageTexture } from './webgl-stage.ts';
import type { PreparedGraphicFrame } from './prepared-frames.ts';
interface Resident { readonly texture:StageTexture;readonly bytes:number;holds:number;stamp:number }
export interface NativeTextureLease { readonly texture:StageTexture;release():void }

export class NativeGraphicTextures {
  private readonly entries=new Map<string,Resident>();
  private visible=new Set<string>();
  private drawing:Set<string>|undefined;
  private stamp=0;
  private closed=false;
  constructor(private readonly stage:WebGlStage,private readonly idleBudget=128*1024*1024){
    if(!Number.isSafeInteger(idleBudget)||idleBudget<0)throw Error('Invalid native texture budget');
  }
  /** A draw releases its borrow as soon as it is submitted, but its texture is
   * still the visible working set. Reuse it next frame even above the idle budget. */
  beginPaint(): (painted:boolean)=>void {
    if(this.closed||this.drawing)throw Error('Native texture paint scope unavailable');
    const touched=this.drawing=new Set();
    return painted=>{
      if(this.drawing!==touched)throw Error('Native texture paint scope is no longer active');
      if(painted)this.visible=touched;
      this.drawing=undefined;
      this.trim();
    };
  }
  acquire(frame:PreparedGraphicFrame,now?:number):NativeTextureLease {
    if(this.closed)throw Error('Native graphic texture cache is closed');
    if(frame.motion){
      frame.motion.actions?.outbox.preflight(0);
      if(now===undefined)throw Error('MTN texture sampling requires logical time');
      const sample=frame.motion.sample(now,frame.motionGrayscale);
      try{
        this.stage.texture(sample.texture);
        if(sample.texture.width!==frame.width||sample.texture.height!==frame.height)throw Error('MTN sample geometry changed');
        return sample;
      } catch(error){sample.release();throw error;}
    }
    if(!frame.source)throw Error('Immutable graphic frame source is absent');
    const key=frame.key;
    this.drawing?.add(key);
    let row=this.entries.get(key);
    if(!row){
      const bytes=frame.width*frame.height*4;
      this.trim(Math.max(0,this.idleBudget-bytes));
      row={texture:this.stage.upload(frame.source,frame.width,frame.height),bytes,holds:0,stamp:0};
      this.entries.set(key,row);
    }
    if(row.texture.width!==frame.width||row.texture.height!==frame.height)throw Error('Native immutable frame identity changed dimensions');
    row.holds++;row.stamp=++this.stamp;
    const retained=row;
    let released=false;
    return {texture:row.texture,release:()=>{
      if(released)return;
      released=true;retained.holds--;retained.stamp=++this.stamp;
      if(!this.drawing||this.closed)this.trim();
    }};
  }
  private trim(budget=this.idleBudget):void {
    const idle=[...this.entries].filter(([key,row])=>!row.holds&&(this.closed||!this.visible.has(key)&&!this.drawing?.has(key)));
    let bytes=idle.reduce((sum,[,row])=>sum+row.bytes,0);
    for(const [key,row] of idle.sort((a,b)=>a[1].stamp-b[1].stamp)){
      if(!this.closed&&bytes<=budget)break;
      this.entries.delete(key);bytes-=row.bytes;this.stage.release(row.texture);
    }
  }
  clearUnused():void { this.trim(0); }
  close():void { this.closed=true;this.visible.clear();this.trim(0); }
}
