import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAssets,projectRoot} from './web-paths.mjs';
export const base=path.join(localAssets,'site'),cache=path.join(localAssets,'media-webp75-opus32-64'),encoded=path.join(cache,'encoded');
export const variant='yoshino-webp75-opus32-64-v1';
export const mediaDirs=['resources/audio','resources/r69-title/music'];
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
export const slash=name=>name.split(path.sep).join('/');
export const asWebp=name=>name.replace(/[.](png|jpg|jpeg|svg)$/iu,'.webp');
export function audioKind(name,title=false){
  name=name.toLowerCase().replaceAll(String.fromCharCode(92),'/');
  if(title||/^(?:bgm[0-9]+[a-z]*|songed2)[.](ogg|opus)$/u.test(name))return 'music';
  if(/^(?:[a-z]+[0-9]+_[0-9]+(?:_[a-z0-9]+)*|(?:yoshino|mako)_loop_[a-z0-9]+|(?:yoshino|mako|murasame|lena|koharu|roka)_senren)[.]ogg$/u.test(name))return 'voice';
  if(name.startsWith('sound/')||['→→走る／道／つっかけ.ogg','■森（夜２）.ogg','お水／注ぐ.ogg','本／置く.ogg','sd101.ogg',...["≪エフェクト21ｓ.ogg","■学院前.ogg","■森（夜２／屋内）.ogg","◎ノイズ.ogg","♪玄関チャイム２.ogg","ブラシ.ogg","机／叩く２.ogg","食器洗い.ogg"]].includes(name))return 'effect';
  throw Error('Unclassified Yoshino audio: '+name);
}
export async function sourcePlan(){
  if(await realpath(base)!==base)throw Error('Expected the owned baseline public directory');
  const session=await readJson(path.join(base,'resources/session.json'));
  if(session.edition!=='yoshino-v1'||session.mediaVariant)throw Error('Expected the original Yoshino-only resources');
  const entries=await readdir(base,{withFileTypes:true,recursive:true});
  if(entries.some(e=>!e.isFile()&&!e.isDirectory()))throw Error('Unexpected link in baseline resources');
  const files=entries.filter(e=>e.isFile()).map(e=>slash(path.relative(base,path.join(e.parentPath,e.name)))).sort();
  const images=files.filter(f=>/[.](png|jpg|jpeg)$/iu.test(f)).map(src=>({src,dst:asWebp(src)}));
  images.push({src:'@icon',dst:'yoshino.webp'});
  const audio=[],effects=[],sidecars=[];
  for(const dir of mediaDirs){
    const title=dir!==mediaDirs[0],m=await readJson(path.join(base,dir,'manifest.json'));
    for(const a of m.files){
      if(!/^[0-9]+[.]ogg$/u.test(a.file))throw Error('Unexpected source Ogg pathname');
      const kind=audioKind(a.name,title),row={src:dir+'/'+a.file,id:a.id,sha256:a.sha256,bytes:a.bytes,kind,channels:a.channels,frames:Math.round(a.duration*48000),sourceRate:a.sampleRate};
      if(!Number.isSafeInteger(row.frames)||row.frames<=0)throw Error('Invalid source duration: '+a.name);
      if(kind==='effect')effects.push(row);else audio.push(row);
      if(a.nonLoopSidecar){
        const twins=m.files.filter(b=>a.id!==b.id&&b.codec===a.nonLoopSidecar.codec&&b.bytes===a.nonLoopSidecar.bytes&&b.sha256===a.nonLoopSidecar.sha256);
        if(twins.length!==1||audioKind(twins[0].name)!=='voice'||typeof a.nonLoopSidecar.file!=='string'||!/^\d+[.]sidecar[.]ogg$/u.test(a.nonLoopSidecar.file))throw Error('Unknown voice sidecar: '+a.name);
        sidecars.push({owner:row.src,src:dir+'/'+a.nonLoopSidecar.file,twin:dir+'/'+twins[0].file,original:a.nonLoopSidecar});
      }
    }
  }
  const known=new Set([...audio,...effects,...sidecars].map(a=>a.src));
  if(files.some(f=>f.endsWith('.ogg')&&!known.has(f)))throw Error('Unknown Ogg is not covered by the media policy');
  return {format:variant,identity:session.identity,base,files,images,audio,effects,sidecars};
}
export async function preparePlan(){
  const shape=await sourcePlan();await mkdir(cache,{recursive:true});if(await realpath(cache)!==cache)throw Error('Media cache is not owned');
  const file=path.join(cache,'plan.json'),bytes=JSON.stringify(shape),old=await readFile(file,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(old!==undefined&&old!==bytes){
    // A move from the old subproject changes only the owned source path, not its receipts.
    const saved=JSON.parse(old),former=path.join(projectRoot,'apps','yoshino-web','local-assets','site');
    if(saved.base!==former||JSON.stringify({...saved,base})!==bytes)throw Error('Source media plan changed; preserve the old cache and prepare a new owned cache');
  }
  if(old===undefined)await writeFile(file,bytes,{flag:'wx'});
  return shape;
}
