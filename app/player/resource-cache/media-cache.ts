import {ResponseByteReader} from '../../../src/audio/stream-byte-source.ts';
import {contentRange,requestedRange} from './edition-cache-types.ts';
import type {DownloadedRange} from './edition-cache-types.ts';
import type {RangeStore} from './range-store.ts';

const blockSize=512*1024,firstMovieBlock=128*1024,audioCacheBlock=64*1024;
const identity=(response:Response)=>!response.headers.has('Content-Encoding')||response.headers.get('Content-Encoding')==='identity';
const mime=(url:string)=>url.endsWith('.mp4')?'video/mp4':'audio/ogg';
const normalHeaders=(type:string,span:DownloadedRange,ranged:boolean,hit?:boolean)=>new Headers({
  'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':String(span.end-span.start),
  ...(ranged&&{'Content-Range':'bytes '+span.start+'-'+(span.end-1)+'/'+span.total}),
  ...(hit!==undefined&&{'X-Senren-Cache':hit?'hit':'miss'}),
});

export class MediaCache {
  constructor(private readonly store:RangeStore,private readonly version:string){}
  private key(url:string){return this.version+':'+url;}
  async read(request:Request,movieSize:number|undefined,warm:boolean,valid:()=>boolean,defer:(p:Promise<unknown>)=>void):Promise<Response>{
    const key=this.key(request.url),value=request.headers.get('Range');
    const known=await this.store.index(key).catch(()=>undefined),total=movieSize??known?.total;
    const sequential=!warm&&/[.](ogg|opus)$/iu.test(new URL(request.url).pathname)&&(!value||/^bytes=[0-9]+-$/u.test(value));
    if(total!==undefined){
      const shape=requestedRange(value,total);
      if(!shape)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+total}});
      const hit=this.covered(known?.parts??[],shape.start,shape.end);
      if(sequential)return this.streamAudio(request,key,{...shape,total},known?.parts??[],hit,valid);
      // Speculation can read through the disk but never populate it. This
      // preserves the independent in-memory budget until the asset is used.
      if(!warm||hit)return this.stream(request,key,{...shape,total},!!value,hit,warm,valid);
    }
    // On a cold load the server establishes the original file size.
    const response=await this.network(request,undefined,request.signal);
    const partial=contentRange(response.headers.get('Content-Range'));
    const len=Number(response.headers.get('Content-Length'));
    const span=response.status===206?partial:!value&&response.status===200&&len>0?{start:0,end:len,total:len}:undefined;
    if(sequential&&span&&response.body&&identity(response)){
      const shape=requestedRange(value,span.total);
      if(shape?.start===span.start&&shape.end===span.end)return this.streamAudio(request,key,span,[],false,valid,response.body);
    }
    if(!warm&&span&&identity(response)&&span.end-span.start<=blockSize&&valid()){
      const copy=response.clone();
      defer(copy.blob().then(data=>this.store.put(key,span,data,valid)).catch(()=>{}));
    }
    return response;
  }
  async promote(url:string,start:number,total:number,data:ArrayBuffer,valid:()=>boolean){
    if(data.byteLength>blockSize||!requestedRange('bytes='+start+'-'+(start+data.byteLength-1),total)||start+data.byteLength>total)return;
    await this.store.put(this.key(url),{start,end:start+data.byteLength,total},new Blob([data]),valid);
  }
  private covered(parts:readonly (readonly [number,number])[],from:number,to:number){
    for(const [a,b] of parts){if(a>from)return false;from=Math.max(from,b);if(from>=to)return true;}
    return false;
  }
  private async network(request:Request,span:{start:number;end:number}|undefined,signal:AbortSignal){
    const headers=new Headers(request.headers);headers.delete('X-Senren-Prefetch');
    if(span){
      headers.delete('If-Range');headers.delete('If-None-Match');headers.delete('If-Modified-Since');
      headers.set('Range','bytes='+span.start+'-'+(span.end-1));
    }
    return fetch(request.url,{cache:'no-store',credentials:'same-origin',redirect:'error',headers,signal});
  }
  /** Cache writes are bounded and never decide the lifetime of a playback request. */
  private streamAudio(request:Request,key:string,span:DownloadedRange,parts:readonly (readonly [number,number])[],hit:boolean,
    valid:()=>boolean,initial?:ReadableStream<Uint8Array<ArrayBuffer>>){
    let at=span.start,input=initial?new ResponseByteReader(initial,at,span.end):undefined;
    const owner=new AbortController(),signal=AbortSignal.any([request.signal,owner.signal]);
    let bank:Uint8Array<ArrayBuffer>|undefined,used=0,first=at,canStore=true;
    const flush=async()=>{
      const size=used;used=0;if(!size||!bank||!canStore||!valid())return;
      try{await this.store.put(key,{start:first,end:first+size,total:span.total},new Blob([bank.subarray(0,size)]),valid);}
      catch{canStore=false;bank=undefined;} // Quota, a disabled database, or an I/O failure cannot stop playback.
    };
    const body=new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull:async controller=>{
        try{
          signal.throwIfAborted();
          if(!input){
            const covering=parts.filter(([a,b])=>a<=at&&at<b).reduce<readonly [number,number]|undefined>((best,p)=>!best||p[1]>best[1]?p:best,undefined);
            if(covering){
              const [a,b]=covering,blob=await this.store.get(key,a).catch(()=>undefined);
              if(blob?.size===b-a){
                const end=Math.min(span.end,b),bytes=new Uint8Array(await blob.slice(at-a,end-a).arrayBuffer());
                signal.throwIfAborted();controller.enqueue(bytes);at=end;if(at===span.end)controller.close();return;
              }
            }
            // Request the whole next hole, not one HTTP request per cache block.
            const end=Math.min(span.end,parts.find(([a])=>a>at)?.[0]??span.end);
            const reply=await this.network(request,{start:at,end},signal),r=contentRange(reply.headers.get('Content-Range'));
            if(!reply.body||reply.status!==206||!identity(reply)||r?.start!==at||r?.end!==end||r?.total!==span.total){
              await reply.body?.cancel();throw Error('Unexpected game audio range on the static server');
            }
            input=new ResponseByteReader(reply.body,at,end);
          }
          const read=input,from=at,bytes=await read.take(canStore&&valid()?audioCacheBlock-used:audioCacheBlock);
          at=read.position;
          if(canStore&&valid()){
            bank??=new Uint8Array(audioCacheBlock);if(!used)first=from;
            bank.set(bytes,used);used+=bytes.length;
          }
          if(read.position===read.end){input=undefined;await flush();}
          else if(used===audioCacheBlock)await flush();
          signal.throwIfAborted();controller.enqueue(bytes);if(at===span.end)controller.close();
        }catch(error){await input?.cancel();if(!owner.signal.aborted)controller.error(error);}
      },
      async cancel(){owner.abort();await input?.cancel();await flush();},
    },{highWaterMark:0});
    return new Response(body,{status:request.headers.has('Range')?206:200,headers:normalHeaders(mime(request.url),span,request.headers.has('Range'),hit)});
  }
  private stream(request:Request,key:string,span:DownloadedRange,ranged:boolean,hit:boolean,warm:boolean,valid:()=>boolean){
    let p=span.start;const owner=new AbortController(),signal=AbortSignal.any([request.signal,owner.signal]);
    const body=new ReadableStream<Uint8Array>({
      pull:async controller=>{
        try{
          signal.throwIfAborted();if(p===span.end){controller.close();return;}
          let held:Blob|undefined,end=span.end;
          const index=await this.store.index(key).catch(()=>undefined);
          const parts=index?.total===span.total?index.parts:[];
          const covering=parts.filter(([a,b])=>a<=p&&p<b).reduce<readonly [number,number]|undefined>((best,item)=>!best||item[1]>best[1]?item:best,undefined);
          if(covering){
            const [a,b]=covering,data=await this.store.get(key,a).catch(()=>undefined);
            if(data?.size===b-a){end=Math.min(span.end,b);held=data.slice(p-a,end-a);}
          }
          if(!held){
            const cut=request.url.endsWith('.mp4')&&p===0?firstMovieBlock:blockSize;
            const next=parts.find(([a])=>a>p)?.[0]??span.end;
            end=Math.min(span.end,next,p+cut);
            const response=await this.network(request,{start:p,end},signal),r=contentRange(response.headers.get('Content-Range'));
            if(response.status!==206||!identity(response)||!r||r.start!==p||r.end!==end||r.total!==span.total){
              await response.body?.cancel();throw Error('Unexpected game audio/video range on the static server');
            }
            held=await response.blob();
            if(held.size!==end-p)throw Error('Incomplete game media range');
            if(!warm&&valid())await this.store.put(key,r,held,valid).catch(()=>{});
          }
          signal.throwIfAborted();const bytes=new Uint8Array(await held.arrayBuffer());signal.throwIfAborted();
          controller.enqueue(bytes);p=end;if(p===span.end)controller.close();
        }catch(error){if(!owner.signal.aborted)controller.error(error);}
      },
      cancel(){owner.abort();},
    },{highWaterMark:0});
    return new Response(body,{status:ranged?206:200,headers:normalHeaders(mime(request.url),span,ranged,hit)});
  }
}
