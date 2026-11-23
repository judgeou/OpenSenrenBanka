import type {PsbValue} from '../../formats/psb-value.ts';
export const tailTracks=new Set([10609,11286,12421,13104,13651,14683,15605,16073,18536,20006]);
export const tailLoopStarts=new Map([[11167,0],[12299,0],[13529,0],[15947,30],[18419,0],[19888,0]]);
export const tailTerminal=(reference:number,time:number):boolean=>
  ([12357,13587].includes(reference)&&time===20)||([18472,19316].includes(reference)&&time===60);
export type TailPose={pose:readonly [number,number,number,number];orientation?:readonly [number,number,number]};
/** Exact source families: translations of tail/bubbles and one pivoted tail bend. */
export function tailPose(ref:number,type:number,mask:number,row:Record<string,PsbValue>):TailPose{
  const curved=ref===16073,c=row.coord;
  const x=curved?12:-11.25,y=curved?-254.25:-60.75;
  if(!Array.isArray(c)||c.length!==3||Number(c[0])!==x||Number(c[1])!==y||Number(c[2])!==0||!([2,3].includes(type)&&curved||type===2&&!curved))throw Error('Unsupported native Mako tail coordinate');
  if(mask===0x80003)return {pose:[x,y,1,1]};
  if(!curved||mask!==0x801f3||type!==3||Number(row.zx)!==1||Number(row.zy)!==1.1937377452850342||Number(row.angle)!==0.11652859300374985||Number(row.sx)!==0||Number(row.sy)!==-.2617128789424896)throw Error('Unsupported native Mako tail affine key');
  return {pose:[x,y,1,Number(row.zy)],orientation:[Number(row.angle),Number(row.sx),Number(row.sy)]};
}
