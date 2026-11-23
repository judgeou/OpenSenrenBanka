import type {ScenarioDocument} from '../scenario/document.ts';
import {invocation} from '../scenario/invocation.ts';
import {psbValue} from '../formats/psb-value.ts';
import type {PsbValue} from '../formats/psb-value.ts';
export type UpcomingResource={readonly kind:'audio'|'image';readonly storage:string;readonly start?:string|number|bigint};
const record=(v:PsbValue|undefined)=>v&&typeof v==='object'&&!Array.isArray(v)?v as {[key:string]:PsbValue}:undefined;
const passive=new Set(['meswinload','scnchart','chapter','wait','quickmenu','beginskip','endskip']);
/** Peek at the next few authored records in the loaded scene only. No expression,
 * state mutation, choice execution, structural jump, or file fetch occurs here. */
export function forecastSceneResources(document:ScenarioDocument,asset:string,scene:number,cursor:number):UpcomingResource[]{
  const s=document.index.scenes[scene],out:UpcomingResource[]=[];let texts=0,images=0;
  const add=(kind:UpcomingResource['kind'],storage:PsbValue|undefined,start?:PsbValue)=>{
    if(typeof storage!=='string'||!storage||storage.startsWith('&')||out.length===24||kind==='image'&&images>=3)return;
    if(start!==undefined&&start!==null&&typeof start!=='string'&&typeof start!=='number'&&typeof start!=='bigint')return;
    out.push({kind,storage,...(start!==null&&start!==undefined&&{start})});if(kind==='image')images++;
  };
  for(let i=cursor;i<Math.min(s.events.length,cursor+150)&&texts<4&&out.length<24;i++){
    const event=s.events[i];
    if(event.kind==='text'){
      const slot=s.texts[event.textIndex].slots[3],voices=slot===undefined?null:psbValue(document.reader,slot);
      if(Array.isArray(voices))for(const v of voices.slice(0,8))add('audio',record(v)?.voice);
      texts++;continue;
    }
    if(event.kind==='opaque')break;
    if(event.kind!=='command')continue;
    const c=invocation(document,event,{asset,scene,event:i,sourceRef:event.sourceRef});
    if(c.deferred)continue;
    if(c.name==='playvoice'){add('audio',c.parameters.voice);continue;}
    if(c.name!=='envupdate'){if(passive.has(c.name))continue;break;}
    const rows=c.parameters.update;
    if(!Array.isArray(rows))continue;
    for(const item of rows.slice(0,18)){
      const row=record(item);if(!row)continue;
      const replay=record(row.replay),image=record(record(row.redraw)?.imageFile);
      if(replay)add('audio',replay.filename,replay.start);
      if(image&&!image.options)add('image',image.file);
    }
  }
  return out;
}
