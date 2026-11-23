import {psbRecord} from '../formats/psb-value.ts';
import type {PsbValue} from '../formats/psb-value.ts';
import {NativeGpuPass} from './native-gpu-pass.ts';
import {nativeNoiseHeight,nativeNoiseMs,nativeNoiseWidth} from './native-noise-descriptor.ts';
import type {NativeImageRequest} from './image-request.ts';
import type {MotionFrame,MotionSampleLease} from './motion/motion-frame.ts';
import type {PreparedGraphicFrame} from './prepared-frames.ts';
import type {StageTarget,WebGlStage} from './webgl-stage.ts';
const fragment='#version 300 es\nprecision highp float;precision highp int;uniform int uSeed;uniform int uTick;out vec4 pixel;void main(){uvec2 p=uvec2(gl_FragCoord.xy);uint h=p.x+65537u*p.y+uint(uSeed)+2246822519u*uint(uTick);h^=h>>16u;h*=2246822519u;h^=h>>13u;h*=3266489917u;h^=h>>16u;float v=float(h&255u)/255.0;pixel=vec4(v,v,v,1.0);}';
const maxSeed=0x7fffffff;
interface Sample {readonly target:StageTarget;tick:number;holds:number;retired:boolean}
/** Noise is sampled on the world GPU. No independent timer, bitmap allocation or network asset. */
export function nativeNoiseFrame(stage:WebGlStage,width:number,height:number,clock:()=>number,request:NativeImageRequest,saved?:PsbValue):PreparedGraphicFrame{
  if(Object.keys(request.options).length)throw Error('Invalid AffineSourceNoise options');
  const scale=width/nativeNoiseWidth;
  if(!Number.isFinite(scale)||scale<=0||height!==nativeNoiseHeight*scale)throw Error('Invalid noise source scale');
  let seed:number,prior=0;
  if(saved===undefined){seed=crypto.getRandomValues(new Uint32Array(1))[0]&maxSeed;}
  else{
    const row=psbRecord(saved);seed=Number(row.seed);prior=Number(row.elapsed);
    if(row.format!=='affine-noise-v1'||Object.keys(row).length!==3||typeof row.seed!=='bigint'||!Number.isInteger(seed)||seed<0||seed>maxSeed||typeof row.elapsed!=='number'||!Number.isFinite(prior)||prior<0)throw Error('Invalid saved native noise phase');
  }
  const began=clock(),pass=new NativeGpuPass(stage,fragment,0,{uSeed:'int',uTick:'int'});
  let live:Sample|undefined,closed=false;
  const elapsed=(now:number)=>prior+Math.max(0,now-began);
  const retire=(row:Sample)=>{row.retired=true;if(!row.holds)stage.release(row.target.texture);};
  const motion:MotionFrame={
    isFlip:()=>!closed,updateFlip:()=>{},waiting:()=>false,
    preflightControl(kind){if(closed||kind!=='sync')throw Error('Unsupported native noise control');},
    control(kind){this.preflightControl(kind);},progressBeforeDraw:()=>{},
    sample(now):MotionSampleLease{
      if(closed||!Number.isFinite(now))throw Error('Unavailable native noise sample');
      const tick=Math.floor(elapsed(now)/nativeNoiseMs)&maxSeed;
      if(!live||live.tick!==tick){
        if(live?.holds){retire(live);live=undefined;}
        const row=live??{target:stage.target(width,height),tick:-1,holds:0,retired:false};
        try{pass.render([], {uSeed:seed,uTick:tick},row.target);row.tick=tick;live=row;}
        catch(error){retire(row);live=undefined;throw error;}
      }
      const row=live;row.holds++;let released=false;
      return {texture:row.target.texture,release(){if(released)return;released=true;if(!--row.holds&&row.retired)stage.release(row.target.texture);}};
    },
  };
  return {key:'affine-noise/'+seed,width,height,motion,nativeSource:{type:2,opacity:255,resolutionx:100,resolutiony:100},pixelScale:1,pageWidth:width,pageHeight:height,offsetX:0,offsetY:0,
    captureState:()=>({format:'affine-noise-v1',seed:BigInt(seed),elapsed:elapsed(clock())}),
    release(){if(closed)return;closed=true;if(live)retire(live);live=undefined;pass.close();}};
}
