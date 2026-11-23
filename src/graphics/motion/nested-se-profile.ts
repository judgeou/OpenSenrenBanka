/** Source-backed R69 sound-only child action tracks. Offsets are authored MTN slots. */
export interface NestedSeKey {readonly time:number;readonly action:'se007'|'se009'|'se010';readonly trackId:number;readonly trackRef:number;readonly frameSourceRef:number;readonly contentSourceRef:number}
const key=(time:number,action:NestedSeKey['action'],trackId:number,trackRef:number,frameSourceRef:number,contentSourceRef:number):NestedSeKey=>({time,action,trackId,trackRef,frameSourceRef,contentSourceRef});
export const nestedSeTimelines=[
  {model:'SD101.mtn',object:'SD101',motion:'moAA',ref:13075,period:30,keys:[key(0,'se007',4,13765,13816,13829),key(15,'se010',5,13919,13983,13996)]},
  {model:'SD103.mtn',object:'SD103',motion:'efBAflash',ref:36601,period:150,keys:[[0,37533,37546],[11,37592,37605],[31,37655,37668],[45,37718,37731],[55,37781,37794],[118,37844,37857],[128,37907,37920]].map(([t,f,c])=>key(t,'se009',1,37440,f,c))},
] as const;
export type NestedSeTimeline=(typeof nestedSeTimelines)[number];
export const nestedSeRoots=[
  {profile:'sd101aa-child-se-v1',geometry:'sd101aa-tree-v1',model:'SD101.mtn',object:'SD101',motion:'SD101AA',rootRef:4760,childTrack:4856,timeline:nestedSeTimelines[0],action:'se007'},
  ...([['SD103BA',9526,10941],['SD103BB',11371,11710],['SD103EC',22657,24311],['SD103ED',24655,26154]] as const).map(([motion,rootRef,childTrack])=>({profile:'sd103-flash-child-se-v1' as const,geometry:'sd103-flash-tree-v1' as const,model:'SD103.mtn',object:'SD103',motion,rootRef,childTrack,timeline:nestedSeTimelines[1],action:'se009'} as const)),
] as const;
export type NestedSeRoot=(typeof nestedSeRoots)[number];
export function nestedSeTimeline(model:string,object:string,motion:string,ref:number):NestedSeTimeline|undefined{
  return nestedSeTimelines.find(t=>t.model.toLowerCase()===model.toLowerCase()&&t.object===object&&t.motion===motion&&t.ref===ref);
}
export function nestedSeRoot(object:unknown,motion:unknown):NestedSeRoot|undefined{return nestedSeRoots.find(r=>r.object===object&&r.motion===motion);}
