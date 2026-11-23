import{psbRecord}from'../formats/psb-value.ts';import type{WorldEffects}from'./entity-world.ts';import{NativeGraphics}from'../graphics/native-graphics.ts';
/** Preserve nonvisual world services while making structural updates and snapshots atomic with respect to the native renderer. */
export function withNativeGraphics(base:WorldEffects,graphics:NativeGraphics):WorldEffects{return{
 beginBatch:async()=>{await graphics.beginBatch();try{await base.beginBatch?.();}catch(error){await graphics.endBatch();throw error;}},
 endBatch:async()=>{try{await base.endBatch?.();}finally{await graphics.endBatch();}},
 reset:async keepMusic=>{graphics.reset();await base.reset(keepMusic);},
 camera:(parameters,after)=>base.camera(parameters,after),tag:value=>base.tag(value),messageOff:value=>base.messageOff(value),
 begin:async(value,mode)=>{await graphics.beginWorld(value,mode);await base.begin(value,mode);},
 finish:async(value,mode)=>{await base.finish(value,mode);await graphics.finishWorld();},
 wait:(value,mode)=>base.wait(value,mode),
 prepareSourceRestore:async names=>{await graphics.prepareSourceRestore(names);await base.prepareSourceRestore(names);},
 capture:async()=>({schemaVersion:1n,base:await base.capture(),graphics:await graphics.capture()}),
 restore:async value=>{const row=psbRecord(value);if(row.schemaVersion!==1n)throw new Error('Invalid native graphical world snapshot');await graphics.restore(row.graphics);await base.restore(row.base);}
};}
