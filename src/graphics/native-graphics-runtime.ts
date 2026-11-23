import{NativeUiPlanes,nativeUiProfile}from'./native-ui-planes.ts';
import type{NativeUiSource}from'./native-ui-planes.ts';
import{MotionSources}from'./motion/sources.ts';
import{MotionActionOutbox}from'./motion/action-events.ts';
import type{NativeMotionActionProfile}from'./native-frame-stage.ts';
import{WebGlStage}from'./webgl-stage.ts';
import{NativeGraphics}from'./native-graphics.ts';
import{NativeSpatialScene}from'./native-spatial-scene.ts';
import type{NativeProjectionContext}from'./native-projection.ts';
import{NativeGraphicFrames}from'./native-graphic-frames.ts';
import type{NativeFramePolicy}from'./native-graphic-frames.ts';
import{PreparedFrames}from'./prepared-frames.ts';
import {nativeNoiseStorage} from './native-noise-descriptor.ts';
import {nativeNoiseFrame} from './native-noise-frame.ts';
import type{PreparedGraphicFrame,FrameEvaluation}from'./prepared-frames.ts';
import{NativeEffectFrames}from'./native-effect-frames.ts';
import{NativeMaskCatalog}from'./native-mask-catalog.ts';
import{NativeGpuMasks}from'./native-gpu-masks.ts';
import{NativeExtendedTables}from'./native-extended-tables.ts';
import{NativeTransitionDispatcher}from'./native-transition-dispatcher.ts';
import{NativeTargetPool}from'./native-target-pool.ts';
import{NativeGraphicTextures}from'./native-graphic-textures.ts';
import{NativeClipPass}from'./native-clip-pass.ts';
import{NativeRasterPass}from'./native-raster-pass.ts';
import{NativeLayerPainter}from'./native-layer-painter.ts';
import{NativeRenderStateStore}from'./native-render-state-store.ts';
import type{GraphicsResources}from'./resources.ts';
import type{ImageDefinitions}from'./image-definitions.ts';
import type{NativeImageRequest}from'./image-request.ts';
import type{EntityClassDefinition}from'../world/class-catalog.ts';
import{NativeProperties}from'../world/native-properties.ts';
import{nativeNumber}from'../world/native-values.ts';
import type{PsbValue}from'../formats/psb-value.ts';
import type{WorldEffects}from'../world/entity-world.ts';
import{withNativeGraphics}from'../world/graphics-effects.ts';

export interface NativeGraphicsOptions{readonly canvas:HTMLCanvasElement|OffscreenCanvas;
readonly resources:GraphicsResources;
readonly definitions:ImageDefinitions;
readonly evaluation:FrameEvaluation;
/** Original envinit text; only the literal motions section is read, never executed. */
readonly motionDefinitions?:string;
/** Internal consumer capability, NOT a user callback. Current app must omit it. */
readonly motionActionProfile?:NativeMotionActionProfile;
/** Application-owned original UI pixels and explicit double-page publication; not a DOM overlay. */
readonly ui?:NativeUiSource;
readonly external:(request:NativeImageRequest,scale:number,saved?:PsbValue)=>Promise<PreparedGraphicFrame>;
readonly projection:()=>NativeProjectionContext;
readonly actions:NativeProperties;
readonly now:()=>number;
readonly width:number;
readonly height:number;
readonly maskCatalog:URL;
readonly extendedTables:URL;
readonly framePolicy:(definition:EntityClassDefinition,redraw:Readonly<{[key:string]:PsbValue}>)=>NativeFramePolicy;
readonly effectScale?:()=>number;
readonly renderStateDatabase?:string;readonly legacyRenderStateDatabase?:string;readonly compactCaches?:boolean}
export interface NativeGraphicsRuntime{readonly port:NativeGraphics;withoutRetainedImages<T>(work:()=>Promise<T>):Promise<T>;
worldEffects(base:WorldEffects):WorldEffects;
close():Promise<void>}
/** One real assembly boundary: shared context, native image preparation, clip/raster/transition passes, world batches and persistence. Resources and main entities remain owned by the session. */
export async function openNativeGraphics(options:NativeGraphicsOptions):Promise<NativeGraphicsRuntime>{if(options.ui)nativeUiProfile(options.ui);const disposers:(()=>void|Promise<void>)[]=[];
async function dispose(){const errors:unknown[]=[];
for(const close of disposers.splice(0).reverse())try{await close();
}catch(error){errors.push(error);
}if(errors.length)throw new AggregateError(errors,'Native graphics disposal failed');
}try{const stage=new WebGlStage(options.canvas);
const MiB=1024*1024,idle=(normal:number,compact:number)=>(options.compactCaches?compact:normal)*MiB;
disposers.push(()=>stage.close());
const motionActions=new MotionActionOutbox(options.motionActionProfile),motion=new MotionSources(stage,options.resources.mtn,options.now,options.motionDefinitions,{profile:options.motionActionProfile,outbox:motionActions});
disposers.push(()=>motion.close());
const prepared=new PreparedFrames(options.resources,options.definitions,options.evaluation,async(request,scale,saved,previous)=>request.file===nativeNoiseStorage?nativeNoiseFrame(stage,options.width,options.height,options.now,request,saved):motion.matches(request.file)?motion.load(request,scale,saved,previous):options.external(request,scale,saved),idle(48,24),storage=>storage===nativeNoiseStorage||motion.matches(storage),storage=>motion.picture(storage),options.compactCaches),effects=new NativeEffectFrames(idle(32,12)),frames=new NativeGraphicFrames(prepared,effects,options.framePolicy);
disposers.push(()=>frames.close());
const masks=new NativeGpuMasks(stage,await NativeMaskCatalog.load(options.maskCatalog,options.resources.images));
disposers.push(()=>masks.close());
const tables=await NativeExtendedTables.load(options.extendedTables,stage);
disposers.push(()=>tables.close());
if(tables.width!==options.width||tables.height!==options.height)throw new Error('Native virtual surface and prepared lookup profile differ');
const transitions=new NativeTransitionDispatcher(stage,masks,tables);
disposers.push(()=>transitions.close());
// Keep up to three reusable 1080p scratch buffers, independent of live old/new targets.
const pool=new NativeTargetPool(stage,Math.max(idle(24,12),3*options.width*options.height*4),bytes=>{
      // An unreusable world surface can overlap old, new and temporary frames.
      // Reclaim nonowners before the first GPU allocation, never retry a fault.
      if(bytes<1920*1080*4)return;
      textures.clearUnused();frames.clearUnused();options.resources.images.clearUnused();
    });
disposers.push(()=>pool.close());
const textures=new NativeGraphicTextures(stage,idle(32,12));
disposers.push(()=>textures.close());
const clips=new NativeClipPass(stage,masks);
disposers.push(()=>clips.close());
const raster=new NativeRasterPass(stage);
disposers.push(()=>raster.close());
const painter=new NativeLayerPainter(stage,textures,pool,clips,raster,source=>nativeNumber(options.evaluation.global(source)));
disposers.push(()=>painter.close());
const store=new NativeRenderStateStore(options.renderStateDatabase,options.legacyRenderStateDatabase&&'senren-yoshino-v1-render-'+options.legacyRenderStateDatabase);
disposers.push(()=>store.close());
const ui=options.ui?new NativeUiPlanes(stage,options.ui):undefined;
if(ui)disposers.push(()=>ui.close());
const spatial=new NativeSpatialScene(options.projection),port=new NativeGraphics({stage,frames,spatial,painter,pool,store,transitions,actions:options.actions,now:options.now,width:options.width,height:options.height,effectScale:options.effectScale,ui,motionActionProfile:options.motionActionProfile,motionActions});
disposers.push(()=>port.close());
return{port,worldEffects:base=>withNativeGraphics(base,port),withoutRetainedImages:work=>store.withoutRetainedImages(work),close:dispose};
}catch(error){try{await dispose();
}catch(cleanup){throw new AggregateError([error,cleanup],'Native graphics assembly and cleanup failed');
}throw error;
}}
