import {PimgCompositor} from '../../src/graphics/pimg-compositor.ts';
import {PimgPaths} from '../../src/graphics/pimg-paths.ts';
import {ImmutablePixels} from './immutable-pixels.ts';
import {alternateWindowPixels,pcWindowPixels} from './original-window-palette.ts';
import type {NativeUiGraphics} from './resources.ts';

export async function openWindowFrame(graphics:NativeUiGraphics,perspective:boolean,pcDialogue:boolean){
  const doc=await graphics.pimg.load('window'),compositor=new PimgCompositor(doc),paths=new PimgPaths(compositor.layout);
  const rect=(path:string)=>{
    const r=compositor.layout.byId.get(paths.resolve(path));
    if(!r)throw Error('Original UI rectangle not found: '+path);
    return {x:r.left,y:r.top,width:r.width,height:r.height};
  };
  const name=rect('グループ 1/@window:name:rect'),body={...rect('グループ 1/@window:text:rect'),imageWidth:compositor.layout.width};
  const pixels=await compositor.compose({layers:[paths.resolve('@window')],stacking:'front-first',ignoreStoredVisibility:true});
  let frame:ImmutablePixels|undefined;
  try{
    frame=pcDialogue?await pcWindowPixels(pixels,false):await ImmutablePixels.copy(pixels);
    const alternate=perspective?(pcDialogue?await pcWindowPixels(pixels,true):await alternateWindowPixels(pixels)):undefined;
    return {frame,alternate,name,body};
  }catch(error){frame?.close();throw error;}
  finally{pixels.width=pixels.height=0;}
}
