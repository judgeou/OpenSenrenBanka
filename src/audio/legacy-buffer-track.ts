import type {AudioLease} from './legacy-audio-buffer.ts';
/** Historical viewer transport; preserves the original full-buffer behavior. */
export class LegacyBufferTrack {
  private source?:AudioBufferSourceNode;private anchor=0;private offset=0;private speed=1;
  finished=false;
  constructor(readonly context:AudioContext,readonly gain:AudioNode,readonly lease:AudioLease,readonly loop?:{start:number;end:number}){}
  get ready(){return !!this.source;}
  open(offset:number,speed:number):void {
    this.stop();this.offset=offset;this.speed=speed;this.finished=false;this.anchor=this.context.currentTime;
    const node=this.context.createBufferSource();this.source=node;node.buffer=this.lease.buffer;node.playbackRate.value=speed;
    if(this.loop){node.loop=true;node.loopStart=this.loop.start;node.loopEnd=this.loop.end;}
    node.connect(this.gain);node.onended=()=>{if(this.source===node)this.finished=true;};node.start(this.anchor,offset);
  }
  pump():void {if(this.finished&&this.loop)throw Error('Looping audio ended without an owned stop');}
  scheduledAt(position:number):number{return this.source?this.anchor+(position-this.offset)/this.speed:Infinity;}
  sample():number {return this.offset+Math.max(0,this.context.currentTime-this.anchor)*this.speed;}
  stop():void {const source=this.source;this.source=undefined;if(source){source.onended=null;source.stop();source.disconnect();}}
}
