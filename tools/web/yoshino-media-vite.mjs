import {randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,rename} from 'node:fs/promises';
import path from 'node:path';
import {cache,readJson,variant} from './yoshino-media-plan.mjs';
import {projectRoot,webDist} from './web-paths.mjs';
import {emitYoshinoCache} from './yoshino-cache-build.mjs';
import {copyYoshinoPublicAssets} from './yoshino-public-assets.mjs';

export async function readCombinedSession(dir){
  const [session,inventory,routes]=await Promise.all(['session.json','inventory.json','yoshino-route.json'].map(file=>readJson(path.join(dir,'resources',file))));
  if(session.edition!=='yoshino-v1'||!session.previousResourceIdentity||session.identity!==inventory.identity||inventory.kind!=='derived-yoshino-mako-media-inventory'||routes.format!=='senren-y01-route-v2'||session.datasets?.endingMako!=='movies/ed-mako.json')throw Error('Expected sealed combined Mako public assets: '+dir);
  return session;
}
export async function yoshinoMediaOptions(stagingName){
  if(!/^mako-public-[a-z0-9-]+$/u.test(stagingName))throw Error('Invalid combined staging ID');
  const publicDir=path.join(cache,stagingName);
  if(await realpath(publicDir)!==publicDir)throw Error('Combined staging directory must be owned');
  await readCombinedSession(publicDir);
  return {publicDir,plugins:[{name:'yoshino-media-icon',transformIndexHtml:{order:'pre',handler(html){
    const token='href="./yoshino.svg" type="image/svg+xml"';
    if(!html.includes(token))throw Error('Yoshino icon source changed');
    return html.replace(token,'href="./yoshino.webp" type="image/webp"');
  }}}]};
}
export async function publishYoshinoMedia(build,options){
  const candidate=await buildYoshinoCandidate(build,options);return installYoshinoCandidate(candidate);
}
export async function installYoshinoCandidate(candidate){
  if(path.dirname(candidate)!==cache||!/^vite-[a-f0-9-]{36}$/u.test(path.basename(candidate))||await realpath(candidate)!==candidate)throw Error('拒绝发布非本 app 的候选目录');
  const output=webDist,old=await lstat(output).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(old&&(!old.isDirectory()||old.isSymbolicLink()||await realpath(output)!==output))throw Error('拒绝替换非本 app 的 dist');
  const archive=path.join(cache,'previous-dist-'+randomUUID());
  if(old)await rename(output,archive);
  try{await rename(candidate,output);}catch(error){if(old)await rename(archive,output);throw error;}
  return {output,archive:old?archive:undefined};
}
export async function buildYoshinoCandidate(build,options){
  const candidate=path.join(cache,'vite-'+randomUUID());
  await mkdir(candidate);
  await build({root:projectRoot,...options,build:{outDir:candidate,emptyOutDir:false,copyPublicDir:false}});
  await copyYoshinoPublicAssets(options.publicDir,candidate);
  const encoding=JSON.parse(await readFile(path.join(candidate,'resources','media-encoding.json'),'utf8'));
  if(encoding.format!==variant||!(await readFile(path.join(candidate,'index.html'),'utf8')).includes('yoshino.webp'))throw Error('压缩版入口或媒体印记缺失');
  await emitYoshinoCache(candidate);
  console.log(JSON.stringify({candidate}));return candidate;
}
