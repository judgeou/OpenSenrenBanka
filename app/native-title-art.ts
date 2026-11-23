import {ImageCatalog} from '../src/graphics/image-catalog.ts';
import {MtnCatalog} from '../src/graphics/mtn-catalog.ts';
import {MotionSources} from '../src/graphics/motion/sources.ts';
import {WebGlStage} from '../src/graphics/webgl-stage.ts';
import type {PreparedGraphicFrame} from '../src/graphics/prepared-frames.ts';
import {psbRecord} from '../src/formats/psb-value.ts';

export const titleWidth=1920, titleHeight=1080;

/** The authored envinit title_bg/title player, with a title-owned stage and clock. */
export async function openNativeTitleArt(root:URL, assets:URL, canvas:HTMLCanvasElement, ready:()=>void, report:(error:unknown)=>void):Promise<()=>void>{
  const stage=new WebGlStage(canvas,true);
  let images:ImageCatalog|undefined, sources:MotionSources|undefined, picture:PreparedGraphicFrame|undefined;
  let logical=0, elapsed=0, last=0, raf=0, closed=false;
  const retireMotion=()=>{
    const frame=picture, source=sources, atlas=images;
    picture=undefined;sources=undefined;images=undefined;
    try{frame?.release();}finally{try{source?.close();}finally{atlas?.close();}}
  };
  const close=()=>{
    if(closed)return;
    closed=true;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibility);
    try{retireMotion();}finally{stage.close();canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();}
  };
  const visibility=()=>{last=0;};
  try {
    const env=await fetch(new URL('envinit.tjs',root));
    if(!env.ok)throw Error('无法读取原标题的布局及动作定义');
    images=await ImageCatalog.open(new URL('atlas/images.json',assets),{decodedPixelBudget:12*1024*1024});
    const catalog=await MtnCatalog.open(new URL('motion/models.json',assets),images);
    sources=new MotionSources(stage,catalog,()=>logical,await env.text());
    picture=await sources.load({file:'title_bg',options:{},raw:{file:'title_bg'}},1);
    const instance=picture.motion, ox=Number(picture.nativeSource?.afx), oy=Number(picture.nativeSource?.afy);
    if(!instance||!Number.isFinite(ox)||!Number.isFinite(oy))throw Error('原标题动作没有原生图像原点');
    // The stage shader supplies source-pixel x/y, just like the leaf projection.
    const matrix=new Float32Array([2/titleWidth,0,0,0,0,-2/titleHeight,0,0,0,0,1,0,-2*ox/titleWidth,2*oy/titleHeight,0,1]);
    const lastTime=Number(psbRecord(picture.captureState!()).lastTime);
    if(!Number.isSafeInteger(lastTime)||lastTime<2)throw Error('原标题最后一拍无原始时长');
    // The atlas timeline authors the final posed picture at frame 119; frame 120
    // is the structural empty terminator. Keep the last drawable beat, not blank.
    const end=lastTime*1000/60, lastPose=(lastTime-.5)*1000/60;
    let paints=0, presentedEnd=false;
    const draw=(ts:number)=>{
      if(closed)return;
      if(document.hidden){last=0;raf=requestAnimationFrame(draw);return;}
      try {
        if(last)elapsed+=Math.min(70,Math.max(0,ts-last));
        last=ts;
        if(!presentedEnd){
          logical=Math.min(elapsed,lastPose);
          instance.updateFlip(logical,1);instance.progressBeforeDraw(logical);
          const sample=instance.sample(logical);
          try { stage.render([{texture:sample.texture,matrix,opacity:1,visible:true,order:0,blend:'normal'}],titleWidth,titleHeight,[1,1,1,1]); }
          finally { sample.release(); }
          presentedEnd=logical===lastPose;
          canvas.dataset.titleFrames=String(++paints);
        }
        if(elapsed<end)raf=requestAnimationFrame(draw);
        else {
          logical=elapsed;instance.updateFlip(logical,1);instance.progressBeforeDraw(logical);
          if(instance.waiting('movie'))raf=requestAnimationFrame(draw);
          else {retireMotion();canvas.dataset.titleMotion='ended';ready();}
        }
      } catch(error){close();report(error);}
    };
    document.addEventListener('visibilitychange',visibility);
    raf=requestAnimationFrame(draw);
    return close;
  } catch(error){close();throw error;}
}
