/** Child Players use another object in the same authored MTN document. */
const childObject:Readonly<Record<string,readonly [string,string]>>=Object.freeze({
  'sd201.mtn':['SD201','char'], 'sd202.mtn':['SD202','char'],
  'sd203.mtn':['SD203','char203'], 'sd204.mtn':['SD204','char204'],
});
export function makoCrossChild(model:string,parent:string,child:string):boolean{
  const row=childObject[model.toLowerCase()];return row?.[0]===parent&&row[1]===child;
}
const dirkRefs=new Set([5024,5875,6726,7577,8428,9430,10284,11617,13175]);
/** Mode 19: original motionplayer D3D9 state row (ADD, INVSRCALPHA, DESTCOLOR). */
export function makoMultiply(model:string,reference:number):boolean{
  return model.toLowerCase()==='sd201.mtn'&&dirkRefs.has(reference);
}

export const makoIndependentAlpha=(model:string,reference:number):boolean=>
  model.toLowerCase()==='sd201.mtn'&&[17057,17661,18303].includes(reference);
const trees:Readonly<Record<string,{object:string;refs:readonly number[];loops:Readonly<Record<number,number>>}>>={
  'sd201.mtn':{object:'char',refs:[19107],loops:{}},
  'sd202.mtn':{object:'char',refs:[10495,11167,12299,13529,15108,15947,18419,19888],loops:{11167:0,12299:0,13529:0,15947:30,18419:0,19888:0}},
  'sd203.mtn':{object:'char203',refs:[46505,48720,50580,52286,54271,56190,55310,53166],loops:{46505:90,48720:31,50580:31,56190:0,53166:0}},
  'sd204.mtn':{object:'char204',refs:[10412,10965,12145,12689,13233,14795,15339],loops:{10965:0,13233:60}},
};
export function makoNestedCharacter(model:string,object:string,reference:number):boolean{
  const row=trees[model.toLowerCase()];return row?.object===object&&row.refs.includes(reference);
}
export function makoNestedLoop(model:string,object:string,reference:number,loop:number):boolean{
  const row=trees[model.toLowerCase()];return row?.object===object&&row.loops[reference]===loop;
}
export const makoFlowerLayout=(model:string,reference:number):boolean=>
  model.toLowerCase()==='sd203.mtn'&&[30066,30695,31326].includes(reference);
