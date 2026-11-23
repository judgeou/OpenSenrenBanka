import {standFrameVariants} from './stand-frame-variants.ts';import {frameSnapshot,frameSnapshotValue} from './frame-state.ts';import type{FrameSnapshot}from'./frame-state.ts';import {clonePsbValue}from'../formats/psb-value.ts';import {ImageMappings} from './image-mappings.ts';import {pimgVisibility} from './pimg-visibility.ts';import type {GraphicsResources} from './resources.ts';import type {ImageLease} from './image-types.ts';import {PimgCompositor} from './pimg-compositor.ts';import {PimgPaths} from './pimg-paths.ts';import {selectStand} from './stand-selection.ts';import type {StandSelection} from './stand-selection.ts';import type {ImageDefinitions} from './image-definitions.ts';import {imageRequest} from './image-request.ts';import type {NativeImageRequest} from './image-request.ts';import type {PsbValue} from '../formats/psb-value.ts';import type {GraphicFrame} from '../world/graphic-entity.ts';
import {takeCompositeBitmap} from './composite-bitmap.ts';
import {deferredStandFrame} from './deferred-stand-frame.ts';
/** Pixel leases stay immutable until release; redraw is an unapplied original image-local program. */
export interface PreparedGraphicFrame extends GraphicFrame {readonly motionGrayscale?:true;readonly source?:CanvasImageSource & TexImageSource;readonly motion?:import('./motion/motion-frame.ts').MotionFrame;readonly nativeSource?:import('./native-graphic-policy.ts').NativeFrameSourceInfo;readonly pixelScale:number;readonly pageWidth:number;readonly pageHeight:number;readonly offsetX:number;readonly offsetY:number;readonly stand?:StandSelection;readonly redraw?:PsbValue;readonly sourceFile?:string;readonly visibility?:ReadonlyMap<number,boolean>;resolvedFrame?():PreparedGraphicFrame;preparePixels?():Promise<void>;selectScale?(scale:number):boolean;captureState():PsbValue}
interface Composite {source:ImageBitmap;width:number;height:number;holders:number;stamp:number;bytes:number}
export interface FrameEvaluation {global(source:string):PsbValue;local(source:string,variables:Readonly<{[key:string]:PsbValue}>):PsbValue}
/** Materializes prepared rasters only when called by the real presentation loop. */
export class PreparedFrames {
  private readonly graphics:GraphicsResources;private readonly definitions:ImageDefinitions;private readonly evaluation:FrameEvaluation;private readonly other:(request:NativeImageRequest,scale:number,savedState?:PsbValue,previous?:PreparedGraphicFrame)=>Promise<PreparedGraphicFrame>;
  private readonly mappings:ImageMappings;private readonly budget:number;private readonly composites=new Map<string,Composite>();private readonly pending=new Map<string,Promise<Composite>>();private stamp=0;private bytes=0;private reserved=0;private closed=false;
  constructor(graphics:GraphicsResources,definitions:ImageDefinitions,evaluation:FrameEvaluation,other:(request:NativeImageRequest,scale:number,savedState?:PsbValue,previous?:PreparedGraphicFrame)=>Promise<PreparedGraphicFrame>,budget=128*1024*1024,private readonly motionMatches?:(storage:string)=>boolean,private readonly pictureVariant?:(storage:string)=>string,private readonly deferStandPixels=false){if(!Number.isSafeInteger(budget)||budget<0)throw new Error('Invalid frame cache budget');this.graphics=graphics;this.definitions=definitions;this.mappings=ImageMappings.fromDefinitions(definitions.raw);this.evaluation=evaluation;this.other=other;this.budget=budget;}
  async load(redraw:Readonly<{[key:string]:PsbValue}>,scale=1,previous?:PreparedGraphicFrame,savedState?:PsbValue):Promise<PreparedGraphicFrame|undefined>{
    if(this.closed)throw new Error('Prepared frame service is closed');const saved=savedState===undefined?undefined:frameSnapshot(savedState);
    if(!saved&&(redraw.imageFile===undefined||redraw.imageFile===null))return undefined;const raw=saved?{file:saved.storage,options:saved.options,raw:{file:saved.storage,options:saved.options,...(saved.redraw===undefined?{}:{redraw:saved.redraw})}}:imageRequest(redraw.imageFile!,source=>this.evaluation.global(source));if(!raw.file)return undefined;const mapped=saved?{file:saved.storage,options:saved.options}:this.mappings.resolve(raw.file,source=>this.evaluation.global(source),false,true),request={...raw,file:saved?mapped.file:this.pictureVariant?.(mapped.file)??mapped.file,options:{...mapped.options,...raw.options}};if(saved)scale=saved.scale;const redrawProgram=saved?saved.redraw:raw.raw.redraw;
    if(saved?.kind==='external')return this.external(request,scale,saved.payload,redrawProgram);
    if(!saved&&this.motionMatches?.(request.file))return this.external(request,scale,undefined,redrawProgram,previous);
    if(/[.]stand$/iu.test(request.file)){
      if(saved&&saved.kind!=='stand')throw new Error('Saved frame kind does not match stand source');const bases=this.definitions.stand(request.file),restoredBase=saved?bases.find(base=>base.filename===saved.base):undefined;if(saved&&!restoredBase)throw new Error('Saved stand base is absent');
      const selection=selectStand(restoredBase?[restoredBase]:bases,saved?{...request.options,dress:saved.dress!,pose:saved.pose!,diff:saved.pose!,face:saved.face!}:request.options,previous?.sourceFile===request.file?previous.stand:undefined),variants=this.definitions.foregroundVariants(selection.base.filename),initial=saved?variants.find(row=>row.pack.name===saved.pack&&row.scale===saved.scale):this.definitions.foregroundVariant(selection.base.filename,scale);
      if(!initial)throw new Error('Saved stand absolute resolution is incompatible');const frames:PreparedGraphicFrame[]=[];
      try{for(const variant of[initial,...variants.filter(row=>row.pack.name!==initial.pack.name)]){const pack=variant.pack,localSaved=variant===initial?saved:undefined;
        if(pack.imageFragments.size)throw new Error('Unimplemented foreground fragment program');const paths=new PimgPaths(pack.layout),variables={...request.options,dress:selection.dress,pose:selection.pose};
        const ids:number[]=localSaved?[...localSaved.rasters!]:[];for(const id of ids)if(pack.layout.byId.get(id)?.layerType!==0)throw new Error('Saved stand layer is absent');if(!localSaved)for(const layer of selection.layers)if(!layer.condition||!!this.evaluation.local(layer.condition,variables)){const id=paths.resolve(layer.path);if(pack.layout.byId.get(id)!.layerType!==0)throw new Error('Stand visibility reference requires raster semantics');ids.push(id);}
        const key=pack.name+':'+[...new Set(ids)].sort((a,b)=>a-b).join(',');
        const metadata={pixelScale:variant.scale,pageWidth:pack.pageWidth,pageHeight:pack.pageHeight,offsetX:pack.offsetX,offsetY:pack.offsetY,stand:selection,sourceFile:request.file};
        const snapshot:FrameSnapshot={schemaVersion:1n,redraw:redrawProgram,kind:'stand',storage:request.file,options:request.options,scale:variant.scale,pack:pack.name,base:selection.base.filename,dress:selection.dress,pose:selection.pose,face:selection.face,rasters:[...new Set(ids)]};
        const load=async()=>{
          const entry=await this.composite(key,pack.layout,()=>new PimgCompositor({acquireImage:name=>this.graphics.images.acquire(name)},pack.layout).compose({layers:ids,stacking:'front-first',rasterOrder:'native-flat',ignoreStoredVisibility:true}));
          return this.lease(key,entry,metadata,snapshot);
        };
        frames.push(this.deferStandPixels?deferredStandFrame({key,width:pack.layout.width,height:pack.layout.height,...metadata,redraw:redrawProgram,captureState:()=>clonePsbValue(frameSnapshotValue(snapshot))},load):await load());
      }return standFrameVariants(frames);}catch(error){for(const frame of frames)frame.release();throw error;}
    }
    const normalized=request.file.replaceAll('\\','/').toLowerCase(),pimg=this.graphics.pimg.entries.find(entry=>{const name=entry.name.replaceAll('\\','/').toLowerCase(),base=name.split('/').at(-1)!;return[name,base,name.replace(/[.]pimg$/u,''),base.replace(/[.]pimg$/u,'')].includes(normalized);});
    if(pimg){
      if(Object.keys(request.options).some(key=>!['seton','layoff','layon','clear','diff'].includes(key)))return this.external(request,scale,undefined,redrawProgram,previous);if(saved&&saved.kind!=='pimg')throw new Error('Saved frame kind does not match PSD source');const document=await this.graphics.pimg.load(pimg.name),compositor=new PimgCompositor(document);if(saved&&(saved.model!==pimg.name||saved.visible!.length!==compositor.layout.layers.length||saved.visible!.some(pair=>!compositor.layout.byId.has(pair[0]))))throw new Error('Saved PSD layer set does not match source');
      const visibility=pimgVisibility(compositor.layout,saved?{}:request.options,saved?new Map(saved.visible!):previous?.sourceFile===pimg.name?previous.visibility:undefined),key='pimg:'+pimg.name+':'+visibility.rasters.join(',');
      const entry=await this.composite(key,compositor.layout,()=>compositor.compose({layers:visibility.rasters,stacking:'front-first',ignoreStoredVisibility:true}));return this.lease(key,entry,{pixelScale:1,pageWidth:entry.width,pageHeight:entry.height,offsetX:0,offsetY:0,sourceFile:pimg.name,visibility:visibility.visible},{schemaVersion:1n,redraw:redrawProgram,kind:'pimg',storage:request.file,options:request.options,scale,model:pimg.name,visible:[...visibility.visible]});
    }
    if(/[.](stage|mtn|event|txt)$/iu.test(request.file)||Object.keys(request.options).length)return this.external(request,scale,undefined,redrawProgram,previous);
    const motion=this.graphics.mtn?.entries.some(entry=>{const name=entry.name.replaceAll('\\','/').toLowerCase(),base=name.split('/').at(-1)!;return[name,base,name.replace(/[.]mtn$/u,''),base.replace(/[.]mtn$/u,'')].includes(normalized);});if(motion)return this.external(request,scale,undefined,redrawProgram,previous);
    if(saved&&saved.kind!=='image')throw new Error('Saved frame kind does not match ordinary image');const snapshot:FrameSnapshot={schemaVersion:1n,redraw:redrawProgram,kind:'image',storage:request.file,options:request.options,scale};const image:ImageLease=await this.graphics.images.acquire(request.file);if(this.closed){image.release();throw new Error('Frame service closed during load');}let released=false;return{key:'image:'+request.file,redraw:redrawProgram,width:image.bitmap.width,height:image.bitmap.height,source:image.bitmap,pixelScale:1,pageWidth:image.bitmap.width,pageHeight:image.bitmap.height,offsetX:image.metadata.offsetX,offsetY:image.metadata.offsetY,captureState:()=>clonePsbValue(frameSnapshotValue(snapshot)),release:()=>{if(!released){released=true;image.release();}}};
  }
  /** previous is borrowed only until other() settles; the entity/retired layer retains its ownership. */
  private async external(request:NativeImageRequest,scale:number,savedState?:PsbValue,redrawProgram?:PsbValue,previous?:PreparedGraphicFrame):Promise<PreparedGraphicFrame>{const frame=await this.other(request,scale,savedState,previous);if(this.closed){frame.release();throw new Error('Frame service closed during external load');}return{key:frame.key,redraw:redrawProgram,width:frame.width,height:frame.height,source:frame.source,motion:frame.motion,nativeSource:frame.nativeSource,pixelScale:frame.pixelScale,pageWidth:frame.pageWidth,pageHeight:frame.pageHeight,offsetX:frame.offsetX,offsetY:frame.offsetY,sourceFile:request.file,captureState:()=>clonePsbValue(frameSnapshotValue({schemaVersion:1n,redraw:redrawProgram,kind:'external',storage:request.file,options:request.options,scale,payload:frame.captureState()})),release:()=>frame.release()};}
  private async composite(key:string,size:{width:number;height:number},create:()=>Promise<OffscreenCanvas>):Promise<Composite>{
    if(this.closed)throw new Error('Frame service is closed');let entry=this.composites.get(key);if(entry){entry.holders++;entry.stamp=++this.stamp;return entry;}
    let pending=this.pending.get(key);if(!pending){
      const bytes=size.width*size.height*4;
      if(!Number.isSafeInteger(bytes)||bytes<=0)throw new Error('Invalid PIMG composition size');
      this.reserved+=bytes;
      pending=(async()=>{
        try{
          // Evict only idle surfaces before reserving a distinct authored bitmap.
          this.trim();
          const source=await create();
          if(this.closed||source.width!==size.width||source.height!==size.height){source.width=0;throw new Error('PIMG composition owner or dimensions changed');}
          const entry={source:takeCompositeBitmap(source),width:size.width,height:size.height,holders:0,stamp:++this.stamp,bytes};
          this.composites.set(key,entry);this.bytes+=bytes;return entry;
        }finally{this.reserved-=bytes;}
      })();this.pending.set(key,pending);
    }
    try{entry=await pending;if(this.closed)throw new Error('Frame service closed during composition');entry.holders++;entry.stamp=++this.stamp;return entry;}finally{if(this.pending.get(key)===pending)this.pending.delete(key);this.trim();}
  }
  private lease(key:string,entry:Composite,metadata:{pixelScale:number;pageWidth:number;pageHeight:number;offsetX:number;offsetY:number;stand?:StandSelection;sourceFile?:string;visibility?:ReadonlyMap<number,boolean>},snapshot:FrameSnapshot):PreparedGraphicFrame{let released=false;return{key,width:entry.width,height:entry.height,source:entry.source,...metadata,redraw:snapshot.redraw,captureState:()=>clonePsbValue(frameSnapshotValue(snapshot)),release:()=>{if(!released){released=true;entry.holders--;entry.stamp=++this.stamp;this.trim();}}};}
  private trim(force=false):void{for(const[key,entry]of[...this.composites].sort((a,b)=>a[1].stamp-b[1].stamp)){if(entry.holders||!force&&!this.closed&&this.bytes+this.reserved<=this.budget)continue;this.composites.delete(key);this.bytes-=entry.bytes;entry.source.close();}}
  clearUnused():void{this.trim(true);}
  close():void{this.closed=true;this.trim();}
}
