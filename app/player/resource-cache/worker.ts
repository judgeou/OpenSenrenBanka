/// <reference lib="webworker" />
import {cacheScopePrefix} from './edition-cache-types.ts';
import type {CacheBuild} from './edition-cache-types.ts';
import {RangeStore} from './range-store.ts';
import {MediaCache} from './media-cache.ts';

declare const SENREN_CACHE_BUILD:CacheBuild;
const worker=self as unknown as ServiceWorkerGlobalScope;
const {version,media,movies,shell}=SENREN_CACHE_BUILD,scope=new URL(worker.registration.scope),prefix=cacheScopePrefix(scope);
const shellName=prefix+'shell:'+version,assetName=prefix+'assets:'+media,ranges=new RangeStore(prefix+'ranges');
const streamed=new MediaCache(ranges,media),shellURL=new URL('index.html',scope).href;
let generation=0,cleaning:Promise<void>|undefined;
const pending=new Set<Promise<unknown>>();
const owned=(url:URL)=>url.origin===scope.origin&&url.pathname.startsWith(scope.pathname);
const local=(url:URL)=>url.pathname.slice(scope.pathname.length);
const fetchable=(path:string)=>path==='yoshino.webp'||path.startsWith('assets/')||path.startsWith('resources/');
const rangeFile=(path:string)=>/[.](ogg|opus|mp4)$/iu.test(path);
function browserCache(event:ExtendableEvent,work:Promise<unknown>){event.waitUntil(work.catch(()=>{}));}
function deferred(event:ExtendableEvent,p:Promise<unknown>){
  const tracked=p.catch(()=>{}).finally(()=>pending.delete(tracked));pending.add(tracked);browserCache(event,tracked);
}
async function erase():Promise<void>{
  if(cleaning)return cleaning;
  generation++;
  cleaning=(async()=>{
    await Promise.all(pending);
    const names=await caches.keys();
    await Promise.all([...names.filter(k=>k.startsWith(prefix)).map(name=>caches.delete(name)),ranges.clear()]);
  })().finally(()=>{cleaning=undefined;});
  return cleaning;
}
async function navigation(request:Request,valid:()=>boolean,event:FetchEvent):Promise<Response>{
  try{
    const response=await fetch(request,{cache:'no-store'});
    // Only store this worker's own sealed page; a fresh release starts its
    // own worker before the first resource request, or uses normal HTTP.
    if(response.ok&&!response.redirected&&response.headers.get('Content-Type')?.includes('text/html')&&valid()){
      const copy=response.clone();
      deferred(event,(async()=>{
        const text=await copy.text();
        if(text===shell&&valid()){const storage=await caches.open(shellName);if(valid())await storage.put(shellURL,new Response(shell,{headers:{'Content-Type':'text/html; charset=utf-8'}}));}
      })());
    }
    if(response.ok||response.status<500)return response;
    throw Error('Unavailable static page');
  }catch(error){
    const hit=await caches.match(shellURL,{cacheName:shellName}).catch(()=>undefined);
    if(hit)return hit;
    throw error;
  }
}
async function whole(request:Request,path:string,warm:boolean,valid:()=>boolean,event:FetchEvent):Promise<Response>{
  const bucket=path.startsWith('resources/')||path==='yoshino.webp'?assetName:shellName;
  const hit=await caches.match(request,{cacheName:bucket}).catch(()=>undefined);if(hit)return hit;
  const headers=new Headers(request.headers);headers.delete('X-Senren-Prefetch');
  const response=await fetch(request,{headers,cache:'no-store'});
  if(!warm&&response.status===200&&response.type!=='opaque'&&!response.redirected&&response.body&&valid()&&!/text\/html/iu.test(response.headers.get('Content-Type')??'')){
    const copy=response.clone();
    deferred(event,(async()=>{const storage=await caches.open(bucket);if(valid())await storage.put(request,copy);else await copy.body?.cancel();})());
  }
  return response;
}
worker.addEventListener('install',event=>{
  if(new URL(worker.location.href).searchParams.get('v')!==version){event.waitUntil(Promise.reject(Error('Different static cache release; use the current game entry')));return;}
  event.waitUntil(worker.skipWaiting());
});
worker.addEventListener('activate',event=>event.waitUntil((async()=>{
  try{
    await ranges.useRelease(media);
    await Promise.all((await caches.keys()).filter(k=>k.startsWith(prefix)&&k!==shellName&&k!==assetName).map(k=>caches.delete(k)));
    const own=await caches.open(shellName);
    await own.put(shellURL,new Response(shell,{headers:{'Content-Type':'text/html; charset=utf-8'}}));
  }catch{/* Quota or storage policy must not break ordinary play. */}
  await worker.clients.claim();
})()));
worker.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||!owned(url))return;
  const path=local(url),nav=request.mode==='navigate'&&(path===''||path==='index.html');
  if(!nav&&!fetchable(path))return;
  const warm=request.headers.get('X-Senren-Prefetch')==='1',born=generation,valid=()=>born===generation&&!cleaning;
  event.respondWith((async()=>{
    if(cleaning)await cleaning.catch(()=>{});
    if(nav)return navigation(request,valid,event);
    if(rangeFile(path))return streamed.read(request,movies[path],warm,valid,p=>deferred(event,p));
    if(request.headers.has('Range'))return fetch(request);
    return whole(request,path,warm,valid,event);
  })());
});
worker.addEventListener('message',event=>{
  const source=event.source;
  if(!source||!('url' in source)||!owned(new URL(source.url))||event.data?.version!==version)return;
  const msg=event.data,port=event.ports[0];
  if(msg.type==='clear-resources'&&port){
    event.waitUntil(erase().then(()=>port.postMessage({ok:true}),()=>port.postMessage({ok:false})));return;
  }
  if(msg.type!=='promote-resource'||typeof msg.url!=='string'||!(msg.bytes instanceof ArrayBuffer)||!msg.bytes.byteLength||msg.bytes.byteLength>16*1024*1024||cleaning)return;
  const url=new URL(msg.url,scope),path=local(url);if(!owned(url)||url.search||url.hash||!path.startsWith('resources/'))return;
  const born=generation,valid=()=>born===generation&&!cleaning;
  if(rangeFile(path)){
    if(!path.endsWith('.mp4')&&Number.isSafeInteger(msg.start)&&Number.isSafeInteger(msg.total))deferred(event,streamed.promote(url.href,msg.start,msg.total,msg.bytes,valid));
  }else if(path.endsWith('.webp')&&msg.bytes.byteLength>=12&&new DataView(msg.bytes).getUint32(0)===0x52494646&&new DataView(msg.bytes).getUint32(8)===0x57454250){
    deferred(event,(async()=>{const own=await caches.open(assetName);if(valid())await own.put(url.href,new Response(msg.bytes,{headers:{'Content-Type':'image/webp'}}));})());
  }
});
