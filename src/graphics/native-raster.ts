import type{NativePixels}from'./native-box-blur.ts';
export interface NativeRasterSnapshot{readonly enabled:boolean;readonly elapsed:number}
/** Native phase starts at zero on the first nonzero raster value, survives amplitude changes and is cleared by zero. */
export class NativeRasterPhase{private start:number|undefined;set(value:number,now:number):void{if(!Number.isFinite(value)||!Number.isFinite(now))throw new Error('Invalid native raster phase');if(value===0)this.start=undefined;else if(this.start===undefined)this.start=now;}capture(now:number):NativeRasterSnapshot{return{enabled:this.start!==undefined,elapsed:this.start===undefined?0:Math.max(0,now-this.start)};}restore(value:NativeRasterSnapshot,now:number):void{if(typeof value.enabled!=='boolean'||!Number.isFinite(value.elapsed)||value.elapsed<0||!Number.isFinite(now))throw new Error('Invalid native raster snapshot');this.start=value.enabled?now-value.elapsed:undefined;}}
/** Integer row offsets from the original post-affine copyRaster routine, including its height/2 time factor. */
export function nativeRasterOffsets(height:number,amplitude:number,lines:number,cycle:number,elapsed:number,top=0,count=height-top):Int32Array {
  if(!Number.isSafeInteger(height)||height<=0||!Number.isSafeInteger(top)||!Number.isSafeInteger(count)||top<0||count<0||top+count>height||
     ![amplitude,lines,cycle,elapsed].every(Number.isFinite))throw Error('Invalid native raster parameters');
  const amount=Math.trunc(amplitude)|0,output=new Int32Array(count);
  // The original row copy shifts by an integer pixel count. The authored ramp
  // may reach zero for cycle/lines while the unrounded amplitude is still < 1.
  // In that state all rows are identity copies; no wave denominator is used.
  if(amount===0)return output;
  lines=Math.trunc(lines)|0;cycle=Math.trunc(cycle)|0;
  if(!lines||!cycle)throw Error('Invalid nonzero native raster (amplitude='+amplitude+', lines='+lines+', cycle='+cycle+')');
  const omega=2*Math.PI/lines;
  let angle=-omega*Math.trunc(elapsed)/cycle*Math.trunc(height/2)+omega*top;
  for(let row=0;row<count;row++,angle+=omega)output[row]=Math.trunc(Math.sin(angle)*amount);
  return output;
}
/** Copies only the native shifted interval; destination edge clearing is owned by the original layer paint pass. */
export function copyNativeRaster(source:NativePixels,destination:NativePixels,offsets:Int32Array,left=0,top=0,width=source.width-left):void{if(source.width!==destination.width||source.height!==destination.height||source.data.buffer===destination.data.buffer||source.data.length!==source.width*source.height*4||destination.data.length!==source.data.length||!Number.isInteger(left)||!Number.isInteger(top)||!Number.isInteger(width)||left<0||top<0||width<0||left+width>source.width||top+offsets.length>source.height)throw new Error('Invalid native raster surface or clip');for(let row=0;row<offsets.length;row++){const delta=offsets[row],length=width-Math.abs(delta);if(length<=0)continue;const line=((top+row)*source.width+left)*4,input=line+Math.max(0,-delta)*4,output=line+Math.max(0,delta)*4;destination.data.set(source.data.subarray(input,input+length*4),output);}}
