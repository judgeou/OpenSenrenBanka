export const cacheWorkerFile='yoshino-resource-cache.js';
export const cacheScopePrefix=(scope:URL)=>'senren-static-cache-v1:'+encodeURIComponent(scope.pathname)+':';
export interface CacheBuild {version:string;media:string;shell:string;movies:Readonly<Record<string,number>>}
export interface DownloadedRange {start:number;end:number;total:number}
export interface RangeIndex {total:number;parts:readonly (readonly [number,number])[]}
export function requestedRange(value:string|null,total:number):{start:number;end:number}|undefined {
  if(value===null)return {start:0,end:total};
  const m=/^bytes=(\d*)-(\d*)$/iu.exec(value);
  if(!m||!m[1]&&!m[2])return;
  if(!m[1]){const bytes=Number(m[2]);return Number.isSafeInteger(bytes)&&bytes>0?{start:Math.max(0,total-bytes),end:total}:undefined;}
  const start=Number(m[1]),last=m[2]?Number(m[2]):total-1;
  if(Number.isSafeInteger(start)&&Number.isSafeInteger(last)&&start<total&&last>=start)return {start,end:Math.min(last+1,total)};
}
export function contentRange(value:string|null):DownloadedRange|undefined {
  const m=/^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value??'');if(!m)return;
  const start=Number(m[1]),end=Number(m[2])+1,total=Number(m[3]);
  if([start,end,total].every(Number.isSafeInteger)&&start<end&&end<=total)return {start,end,total};
}
