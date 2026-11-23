import {psbRecord} from '../../formats/psb-value.ts';
import type {PsbValue} from '../../formats/psb-value.ts';
interface Segment {readonly from:number;readonly to:number;readonly x:readonly number[];readonly y:readonly number[];readonly knots:readonly number[];readonly samples:readonly number[];readonly seconds:readonly number[]}
export interface PositionPath {readonly x:readonly number[];readonly y:readonly number[];readonly segments:readonly Segment[]}
const cubic=(p:readonly number[],t:number):number=>{const u=1-t;return p[0]*u*u*u+3*p[1]*u*u*t+3*p[2]*u*t*t+p[3]*t*t*t;};
/** Original cubic points, segment arc fractions and baked inverse arc-length splines. R68 supplies one or two authored segments. */
export function positionPath(value:PsbValue,profile:boolean|'sd003-da'=false):PositionPath {
 const fail=():never=>{throw Error('Unsupported original MTN position-control path');}, row=psbRecord(value), doubled=profile==='sd003-da';
 const vec=(input:PsbValue,min:number,max:number,magnitude=profile?32:16):number[]=>{
   if(!Array.isArray(input)||input.length<min||input.length>max)return fail();
   return input.map(v=>typeof v==='number'||typeof v==='bigint'?Number(v):NaN).map(v=>Number.isFinite(v)&&Math.abs(v)<=magnitude?v:fail());
 };
 const normalized=(v:readonly number[])=>v[0]===0&&v.at(-1)===1&&v.every((x,i)=>!i||x>v[i-1]);
 const c=vec(row.c,2,profile===true?2:3), t=vec(row.t,c.length,c.length), total=(c.length-1)*3+1;
 if(Object.keys(row).length!==5||c.some(v=>v!==1)||!normalized(t)||!Array.isArray(row.s)||row.s.length!==c.length-1)fail();
 const x=vec(row.x,total,total),y=vec(row.y,total,total);
 if((!profile&&!normalized(x)||profile===true&&(x.some(v=>v<-.15||v>1.05))||doubled&&x.some(v=>v<-.31||v>2))||x[0]!==0||x.at(-1)!==1||y[0]!==0||y.at(-1)!==0||y.some(v=>Math.abs(v)>(profile?1.75:1)))fail();
 const segments=(row.s as PsbValue[]).map((value,j)=>{
   const s=psbRecord(value),knots=vec(s.x,2,32),samples=vec(s.y,knots.length,knots.length),seconds=vec(s.p,knots.length,knots.length,32); // Second derivatives need more range than normalized control points.
   if(Object.keys(s).length!==3||!normalized(knots)||!normalized(samples)||seconds[0]!==0||seconds.at(-1)!==0)fail();
   for(let i=1;i<knots.length-1;i++){
     const a=knots[i]-knots[i-1],b=knots[i+1]-knots[i];
     if(Math.abs(a*seconds[i-1]+2*(a+b)*seconds[i]+b*seconds[i+1]-6*((samples[i+1]-samples[i])/b-(samples[i]-samples[i-1])/a))>.0001)fail();
   }
   return {from:t[j],to:t[j+1],x:x.slice(3*j,3*j+4),y:y.slice(3*j,3*j+4),knots,samples,seconds};
 });return {x,y,segments};
}
export function pathPosition(path:PositionPath,fraction:number,dx:number,dy:number):readonly [number,number]{
 const seg=path.segments.find(s=>fraction<s.to)??path.segments.at(-1)!,f=(fraction-seg.from)/(seg.to-seg.from),{knots,samples,seconds}=seg;
 let i=0;while(i<knots.length-2&&f>=knots[i+1])i++;
 const h=knots[i+1]-knots[i],b=(f-knots[i])/h,a=1-b;
 const time=Math.max(0,Math.min(1,a*samples[i]+b*samples[i+1]+((a*a*a-a)*seconds[i]+(b*b*b-b)*seconds[i+1])*h*h/6));
 const x=cubic(seg.x,time),y=cubic(seg.y,time);return [dx*x-dy*y,dy*x+dx*y];
}
