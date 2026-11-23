import {cacheWorkerFile} from './edition-cache-types.ts';
import type {PrefetchRequest} from '../../../src/runtime/resource-prefetch.ts';
function active(){
  const version=document.querySelector<HTMLMetaElement>('meta[name="senren-cache-release"]')?.content;
  const worker=navigator.serviceWorker?.controller;
  if(!version||!worker||worker.scriptURL!==new URL(cacheWorkerFile+'?v='+version,document.baseURI).href)return;
  return {version,worker};
}
export function promoteDownloadedAsset(request:PrefetchRequest,bytes:ArrayBuffer):void {
  const entry=active();if(!entry)return;
  try{entry.worker.postMessage({type:'promote-resource',version:entry.version,url:request.url,bytes,start:request.range?.start,total:request.range?.size});}
  catch{/* Disk persistence is opportunistic, never a playback failure. */}
}
async function clear():Promise<boolean>{
  const entry=active();if(!entry)return false;
  const channel=new MessageChannel();
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('资源缓存清理超时')),15000);
    channel.port1.onmessage=e=>{clearTimeout(timer);if(e.data?.ok===true)resolve(true);else reject(Error('浏览器未能清空资源缓存'));};
    try{entry.worker.postMessage({type:'clear-resources',version:entry.version},[channel.port2]);}
    catch(error){clearTimeout(timer);reject(error);}
  });}finally{channel.port1.close();channel.port2.close();}
}
export function cacheSettings():HTMLElement {
  const row=document.createElement('section'),label=document.createElement('p'),button=document.createElement('button'),status=document.createElement('p');
  label.textContent='下载过的游戏资源保存在当前站点。清空只删除资源，不删除存档、已读进度或设置。';
  button.type='button';button.id='clear-resource-cache';button.textContent='清空资源缓存';status.id='resource-cache-status';status.role='status';
  if(!active()){button.disabled=true;status.textContent='当前页面未启用持久资源缓存。';}
  button.onclick=()=>{
    button.disabled=true;status.textContent='正在清空…';
    void clear().then(ok=>{status.textContent=ok?'资源缓存已清空。':'当前页面未启用持久资源缓存。';},error=>{status.textContent=String(error.message??error);})
      .finally(()=>{button.disabled=!active();});
  };
  row.append(label,button,status);return row;
}
