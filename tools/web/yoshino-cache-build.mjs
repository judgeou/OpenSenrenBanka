import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const workerName='yoshino-resource-cache.js';
const src=fileURLToPath(new URL('../../app/player/resource-cache/worker.ts',import.meta.url));
// Kept inline so the first app module, stylesheet and icon already use the
// active worker on a clean profile. The worker's own script is version-checked.
async function start(version,workerName,entry,links){
  const root=new URL('.',document.baseURI),worker=new URL(workerName+'?v='+version,root);
  const sw=navigator.serviceWorker,match=()=>sw?.controller?.scriptURL===worker.href;
  if(sw&&!match()){
    await new Promise(resolve=>{
      const end=()=>{clearTimeout(timer);sw.removeEventListener('controllerchange',change);resolve();};
      const change=()=>{if(match())end();};
      const timer=setTimeout(end,7000);
      sw.addEventListener('controllerchange',change);
      sw.register(worker,{scope:root.href,updateViaCache:'none'}).then(change,end);
    });
  }
  if(sw?.controller&&!match())throw Error('游戏资源版本更新尚未完成，请刷新页面。');
  for(const spec of links){const link=document.createElement('link');Object.assign(link,spec);document.head.append(link);}
  await import(new URL(entry,root).href);
}
export async function emitYoshinoCache(root){
  const index=path.join(root,'index.html'),original=await readFile(index,'utf8');
  const media=createHash('sha256').update(await readFile(path.join(root,'resources','inventory.json'))).digest('hex');
  const product=await build({entryPoints:[src],bundle:true,write:false,platform:'browser',target:'chrome120',minify:true});
  const code=product.outputFiles[0].text,hash=createHash('sha256').update(media).update(code).update(original).update(start.toString());
  for(const name of (await readdir(path.join(root,'assets'))).sort())hash.update(await readFile(path.join(root,'assets',name)));
  const version=hash.digest('hex');
  const entry=/<script type="module" crossorigin src="([^"]+)"><\/script>/u.exec(original);
  if(!entry||!/^[.]\/assets\/[^/]+[.]js$/u.test(entry[1]))throw Error('Unexpected production script entry for persistent cache');
  const links=[];
  let page=original.replace(entry[0],'').replace(/<link (rel="(?:icon|stylesheet)"[^>]*?)>/gu,(_tag,attrs)=>{
    const get=(key)=>new RegExp(key+'="([^"]+)"','u').exec(attrs)?.[1],rel=get('rel'),href=get('href'),type=get('type');
    if(!href?.startsWith('./'))throw Error('Unexpected external cache shell link');
    links.push({rel,href,...(type&&{type})});return '';
  });
  if(!links.some(l=>l.rel==='stylesheet')||!links.some(l=>l.rel==='icon'))throw Error('Missing production shell assets');
  const boot='('+start.toString()+')('+[version,workerName,entry[1],links].map(x=>JSON.stringify(x)).join(',')+').catch(error=>{const e=document.getElementById("warning");if(e){e.textContent=String(error);e.hidden=false;}});';
  page=page.replace('</head>','  <meta name="senren-cache-release" content="'+version+'">\n</head>')
    .replace('</body>','<script type="module">'+boot+'</script></body>');
  const movies={};
  const session=JSON.parse(await readFile(path.join(root,'resources/session.json'),'utf8'));
  for(const name of ['OP_1080.mp4','ED1_Yosh1080.mp4',...(session.datasets.endingMako?['ED2_Mako1080.mp4']:[])]){
    const relative='resources/movies/'+name;movies[relative]=(await stat(path.join(root,relative))).size;
  }
  await writeFile(path.join(root,workerName),'const SENREN_CACHE_BUILD='+JSON.stringify({version,media,shell:page,movies})+';\n'+code,{flag:'wx'});
  await writeFile(index,page);
  return {version,media};
}
