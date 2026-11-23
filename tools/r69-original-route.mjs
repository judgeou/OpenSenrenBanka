import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sceneFlow} from '../src/scenario/flow.ts';
import {ScriptState} from '../src/script/state.ts';
import {ScriptEngine} from '../src/script/expression.ts';
import {truth} from '../src/script/operators.ts';
import {BranchBindings} from '../src/world/branch-flags.ts';

// Digest of the literal original button text + target + expression. Ordinal is a result, not input.
const selected={
 "0001/5": [
  "bf38989f19f725b11139084f306bf71671ccb34f74d5ea92ded0651acd2e9a74",
  "*001_01B",
  "SetBranchFlags(\"s001*com_part_1_sel\",2)"
 ],
 "0006/5": [
  "2abc1c65622687cc2f69a0e351024365f06d0757e30c012c949e3b81e0be3057",
  "*006_01A",
  "SetBranchFlags(\"s006*com_part_6_sel\",1)"
 ],
 "0010/5": [
  "519de3613bc71f981f4fce428cd42d0f6f97fbe709c1e70fcee792a99e1a61dd",
  "*010_01B",
  "SetBranchFlags(\"s010*com_part_10_sel\",2)"
 ],
 "0010/13": [
  "d18e8a36489e5fda42670b234521b6fc8e7035ef5dc599f8839e44a0a1dfb7b7",
  "*010_02A",
  "SetBranchFlags(\"s010*010_01com_sel\",1)"
 ],
 "0010/17": [
  "41a10af76530e26816b064ae5057237f434f6ba2f36ed502a511fa5069be2b3b",
  "*010_03A",
  "SetBranchFlags(\"s010*010_02A_sel\",1)"
 ],
 "0010/31": [
  "3bc114f47588e9f819453e1594f502a6e40803d36110999aa5615cd2466b897a",
  "*010_06A",
  "SetBranchFlags(\"s010*010_02com_sel\",1)"
 ],
 "0012/5": [
  "3d6d6c58cc146f697893cf63f753ad282ab0773f73b31f0b850ca7c9c5d130d5",
  "*012_01A",
  "SetBranchFlags(\"s012*com_part_12_sel\",1)"
 ],
 "0014/5": [
  "fbd2c57e8bb7011049ed33e93e70ecb2e9c5615abc64768db9e1bfe4900f1caf",
  "*014_01A",
  "SetBranchFlags(\"s014*com_part_14_sel\",1)"
 ],
 "0026/7": [
  "1e714c9f2a29ad7630a893394f0019e1afc11a7c3cb36420effb66a558dd678c",
  "*110_01A",
  "SetBranchFlags(\"s110*yos_part_10_sel\",1)"
 ],
 "0028/7": [
  "af6b89c5f5321ec00bed3f45ab06baa9d07c8ce5a277407815d05e903e161946",
  "*112_01A",
  "SetBranchFlags(\"s112*yos_part_12_sel\",1)"
 ],
 "0028/15": [
  "2a0f7c10ec12131da79db3c9426df770be81d37778a5803b6cfd623b15a712cc",
  "*112_02Apre",
  "SetBranchFlags(\"s112*112_01com_sel\",1)"
 ],
 "0029/7": [
  "b3c372668c0828685ca836f77fa5eafc4038ad1479461a829992f7594849d059",
  "*113_01A",
  "SetBranchFlags(\"s113*yos_part_13_sel\",1)"
 ],
 "0029/15": [
  "332f6319ba4e147567aecdd7329160a7458760eb0463c44ef75d76ad0b8aa975",
  "*113_02A",
  "SetBranchFlags(\"s113*113_01com_sel\",1)"
 ],
 "0029/25": [
  "1e1354e173ec1b5497193827509f2add3f62132c6fbc3a47bad9bc1716a2871b",
  "*113_03A",
  "SetBranchFlags(\"s113*113_02com_sel\",1)"
 ]
};
const sha=text=>createHash('sha256').update(text).digest('hex');
export async function yosRoute(work,index,{alternate=false}={}){
 const rules=JSON.parse(await readFile(path.join(work,'definitions/r11/branch-rules.json'),'utf8'));
 const num=v=>v?.$integer!==undefined?BigInt(v.$integer):v;
 const script=new ScriptState(), engine=new ScriptEngine(script);
 // Fresh original configuration: use the same system preference truth rules as installScriptBindings.
 const profile=(name,positive)=>{const sf=script.read('sf');return !truth(sf.hselectFix)||(positive?sf[name]:!truth(sf[name]));};
 const branch=new BranchBindings(script,engine,{keys:rules.keys,flags:new Map(rules.flags.map(f=>[f.key,f.rules.map(r=>({...r,value:num(r.value),weight:num(r.weight)}))]))},{checkAnyClear:()=>false,checkIN:()=>profile('hselectOUTIN',false),checkOUT:()=>profile('hselectOUTIN',true),checkMOUTH:()=>profile('hselectMOUTHFACE',true),checkFACE:()=>profile('hselectMOUTHFACE',false)});
 branch.install();
 const parts=[],route=[],choices={},choiceRows={},edgeRows=[],gates=[],owned=new Map();
 const fetch=async(id,storage)=>{let asset=owned.get(id);if(!asset){asset=await index.asset(id,storage);owned.set(id,asset);}return asset;};
 let asset=await fetch('0001'),scene=0,terminal;
 const evals=ops=>{for(const op of ops){if(op.kind==='set')script.write(op.path,op.value);else engine.execute(op.source);}};
 for(let i=0;i<280;i++){
  const here=asset.id+'/'+scene, flow=sceneFlow(asset.doc,scene);
  if(route.includes(here))throw Error('Repeated original Yoshino scene '+here);
  route.push(here);parts.push({asset,scene,limit:Infinity});evals(flow.before);
  let edge;
  if(flow.choices.length){
   let match=selected[here];if(alternate&&here==='0014/5')match=null;
   const eligible=flow.choices.filter(e=>!e.condition||truth(engine.execute(e.condition)));
   const matches=match?eligible.filter(e=>sha(e.text)===match[0]&&e.target===match[1]&&e.expression===match[2]):eligible.filter(e=>e.target==='*014_01B'&&e.expression==='SetBranchFlags("s014*com_part_14_sel",2)');
   if(matches.length!==1)throw Error('Authored selection contract not uniquely bound '+here);
   edge=matches[0];choices[here]=edge.index;choiceRows[here]={text:edge.text,target:edge.target,expression:edge.expression,index:edge.index,sourceRef:asset.doc.index.scenes[scene].sourceRef};
  }else{
   evals(flow.after);
   edge=flow.next.find(e=>{
    const ok=!e.condition||truth(engine.execute(e.condition));
    if(e.condition)gates.push({at:here,condition:e.condition,score:branch.update(Object.create(null)),taken:ok,storage:e.storage,target:e.target});return ok;
   });
   if(alternate&&here==='0015/4'){terminal={at:here,type:'score-proof',target:edge?.target,score:branch.update(Object.create(null))};break;}
  }
  if(!edge||edge.raw.evalstorage)throw Error('Unresolved original edge '+here);
  if(edge.expression)engine.execute(edge.expression);
  edgeRows.push({at:here,type:edge.type,storage:edge.storage,target:edge.target,condition:edge.condition,expression:edge.expression});
  if(edge.type!==0){terminal={at:here,type:edge.type,storage:edge.storage,target:edge.target};break;}
  const id=edge.storage?index.aliases.get(edge.storage):asset.id;
  if(!id)throw Error('Original route storage is absent '+here);
  asset=await fetch(id,edge.storage);scene=edge.target?asset.doc.scenePosition(edge.target):0;
  if(scene===undefined)throw Error('Original target is absent '+here);
 }
 if(alternate?terminal?.type!=='score-proof'||terminal.score.yos!==1n:route.length!==230||owned.size!==30||terminal?.at!=='0030/3'||terminal.type!==1||terminal.storage!=='start.ks'||terminal.target!=='*gameend_title')throw Error('Original ending route contract differs');
 return {parts,route,choices,choiceRows,gates,edgeRows,terminal};
}
