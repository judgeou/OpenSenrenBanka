import{PreparedFrames}from'./prepared-frames.ts';import type{PreparedGraphicFrame}from'./prepared-frames.ts';import{NativeEffectFrames}from'./native-effect-frames.ts';import type{NativePixelContext}from'./native-pixel-effects.ts';import type{EntityClassDefinition}from'../world/class-catalog.ts';import type{GraphicFrame}from'../world/graphic-entity.ts';import type{PsbValue}from'../formats/psb-value.ts';
export interface NativeFramePolicy extends NativePixelContext{readonly scale:number}
/** Concrete GraphicEntityPort.load bridge: native identity and visibility first, original image-local pixel programs second. */
export class NativeGraphicFrames{
 private readonly prepared:PreparedFrames;private readonly effects:NativeEffectFrames;private readonly policy:(definition:EntityClassDefinition,redraw:Readonly<{[key:string]:PsbValue}>)=>NativeFramePolicy;
 constructor(prepared:PreparedFrames,effects:NativeEffectFrames,policy:(definition:EntityClassDefinition,redraw:Readonly<{[key:string]:PsbValue}>)=>NativeFramePolicy){this.prepared=prepared;this.effects=effects;this.policy=policy;}
 async load(redraw:Readonly<{[key:string]:PsbValue}>,definition:EntityClassDefinition,previous?:GraphicFrame,savedState?:PsbValue):Promise<PreparedGraphicFrame|undefined>{const policy=this.policy(definition,redraw);if(!Number.isFinite(policy.scale)||policy.scale<=0)throw new Error('Invalid native source pixel policy');const before=previous&&('source'in previous||'motion'in previous)?previous as PreparedGraphicFrame:undefined,frame=await this.prepared.load(redraw,policy.scale,before,savedState);return frame?this.effects.apply(frame,policy):undefined;}
 clearUnused():void{this.prepared.clearUnused();this.effects.clearUnused();}
 close():void{this.effects.close();this.prepared.close();}
}
