import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Psb2Reader} from '../src/formats/psb2/reader.ts';
import {ScenarioDocument} from '../src/scenario/document.ts';
import {sceneFlow} from '../src/scenario/flow.ts';

export const sceneKey=(asset,scene)=>asset+'/'+scene;
export const jsonOriginal=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$integer:String(v)}:v,2);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function originalIndex(work, dir=path.join(work,'runtime-data/scenarios-r6-v2')){
 const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.files.length!==92)throw Error('Prepared original SCN inventory changed');
 const files=new Map(manifest.files.map(row=>[row.id,row])), aliases=new Map();
 for(const row of files.values())for(const name of row.logicalAliases){if(aliases.has(name))throw Error('Ambiguous original storage '+name);aliases.set(name,row.id);}
 async function asset(id,storage){
  const row=files.get(id);if(!row||!/^\d+[.]psb$/.test(row.binaryFile))throw Error('Unknown prepared SCN '+id);
  const bytes=await readFile(path.join(dir,row.binaryFile));if(hash(bytes)!==row.sha256)throw Error('Original SCN digest changed '+id);
  return {id,storage:storage??row.logicalAliases.find(x=>x.endsWith('.ks'))??row.logicalAliases[0],sha256:row.sha256,doc:new ScenarioDocument(new Psb2Reader(bytes))};
 }
 return {files,aliases,asset};
}

/** Traverse only the original choice/next edges in the R68 closed set. Keep route
 * occurrences and choices separate from the set of physical SCN positions. */
export async function walkR68(index,byAsset,entry){
 const stop='0010/10', states=new Map(), paths=[], choiceCounts=new Map();
 async function reach(asset,scene,chain,selected){
  const here=sceneKey(asset.id,scene);
  if(chain.includes(here)||chain.length>=96)throw Error('Unexpected cycle/depth at '+here);
  const route=[...chain,here], boundary=here===stop;
  if(!states.has(here))states.set(here,{asset,scene,limit:boundary?11:Infinity});
  if(boundary){paths.push({route,selected});return;}
  const flow=sceneFlow(asset.doc,scene), choices=flow.choices.length>0, rows=choices?flow.choices:flow.next;
  if(!rows.length)throw Error('Missing authored exit '+here);
  const edges=new Map();
  for(const edge of rows){
   if(edge.type!==0||edge.raw.evalstorage||edge.condition)throw Error('Unresolved original condition at '+here+' '+jsonOriginal(edge));
   const id=edge.storage?index.aliases.get(edge.storage):asset.id;
   if(!id||Number(id)<3||Number(id)>10)throw Error('Unexpected original storage at '+here+' '+edge.storage);
   let target=byAsset.get(id);if(!target){target=await index.asset(id,edge.storage);byAsset.set(id,target);}
   const next=target.doc.scenePosition(edge.target);
   if(next===undefined)throw Error('Unresolved original target '+here+' '+edge.target);
   const nextKey=sceneKey(id,next), dest=choices?'choice/'+edge.index:nextKey;
   const previous=edges.get(dest);
   if(previous&&previous.edge.expression!==edge.expression)throw Error('Duplicate edge with different script effects '+here);
   edges.set(dest,{edge,target,next});
  }
  if(!choices&&edges.size!==1)throw Error('Conflicting unconditional next at '+here);
  if(choices){if(rows.length!==2)throw Error('Unexpected original pick count '+here);choiceCounts.set(here,rows.length);}
  for(const {edge,target,next}of edges.values())await reach(target,next,route,choices?{...selected,[here]:edge.index}:selected);
 }
 await reach(entry,0,[],{});
 if([...choiceCounts.keys()].join(',')!=='0006/5,0010/5'||paths.length!==4)throw Error('Original R68 choice closure changed');
 return {parts:[...states.values()].sort((a,b)=>a.asset.id.localeCompare(b.asset.id)||a.scene-b.scene),paths};
}

export async function surveyAll(work){
 const index=await originalIndex(work), assets=[];
 for(const [id] of index.files){
  const asset=await index.asset(id);
  assets.push({id,storage:asset.storage,sha256:asset.sha256,scenes:asset.doc.index.scenes.map((scene,i)=>{
   const f=sceneFlow(asset.doc,i);
   return {scene:i,sourceRef:scene.sourceRef,name:scene.name,points:scene.points?.length,texts:scene.texts.length,events:scene.events?.length,
    before:f.before,after:f.after,choices:f.choices,next:f.next,selectInfo:f.selectInfo};
  })});
 }
 return {format:'senren-original-flow-survey-v1',assets};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [work,output,...extra]=process.argv.slice(2);if(!work||!output||extra.length)throw Error('Pass prepared work and a new flow survey output');
 const result=await surveyAll(work);await writeFile(output,jsonOriginal(result),{flag:'wx'});
 console.log(JSON.stringify({assets:result.assets.length,scenes:result.assets.reduce((n,a)=>n+a.scenes.length,0)}));
}
