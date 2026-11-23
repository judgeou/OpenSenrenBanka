import type {NativeGraphicsServices} from './native-graphics.ts';
import type {NativeUiPublication} from './native-ui-planes.ts';
import {nativeUiLease,paintNativeScene} from './motion/frame-presentation.ts';

/** Original fore.base capture, with message drawing suppressed in this pass only.
 * Same prepared world and logical time as the committed on-screen frame. */
export async function nativeSaveThumbnail(services:NativeGraphicsServices,publication:NativeUiPublication|undefined,now:number):Promise<Blob>{
  const width=496,height=279,{stage,pool}=services;
  const full=pool.acquire(services.width,services.height);
  let rgba:Uint8ClampedArray<ArrayBuffer>;
  try{
    const ui=nativeUiLease(services,publication,now);
    try{
      const base=ui&&{...ui,planes:ui.planes.filter(plane=>!/^message(?:[-/]|$)/u.test(plane.id))};
      paintNativeScene(services,full,now,base);
      const reduced=pool.acquire(width,height);
      try{stage.shrinkTarget(full.target,reduced.target);rgba=new Uint8ClampedArray(stage.readTarget(reduced.target));}
      finally{reduced.release();}
    }finally{ui?.release();}
  }finally{full.release();stage.bind();}
  // Native stage textures store authored top at storage row zero (unlike the displayed back buffer).
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Cannot encode original save thumbnail');
  try{ctx.putImageData(new ImageData(rgba,width,height),0,0);return await canvas.convertToBlob({type:'image/png'});}
  finally{canvas.width=canvas.height=0;}
}
