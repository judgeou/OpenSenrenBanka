import {readFile,writeFile,readdir,mkdir,realpath,copyFile,rename,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {prepareAudioStreamIndex} from '../prepare-audio-stream-index.mjs';
import {base,cache,encoded,variant,mediaDirs,digest,readJson,preparePlan} from './yoshino-media-plan.mjs';
import {opusReceipt} from './yoshino-opus-inspect.mjs';
const abs=(r,name)=>{if(!name||path.isAbsolute(name)||name.split('/').some(p=>!p||p==='..'||p==='.'||p.includes(String.fromCharCode(92))))throw Error('Invalid owned derivative entry: '+name);return path.join(r,name);};
const mk=(v)=>Buffer.from(JSON.stringify(v));
const row=(file,data)=>({file,bytes:data.length,sha256:digest(data)});
const receipt=(kind,file)=>path.join(cache,'receipt',kind,file.replaceAll('/','-')+'.json');
async function writeAt(root,name,data){const p=abs(root,name);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,data,{flag:'wx'});}
const imageLists=['resources/images/manifest.json','resources/pimg-images/manifest.json','resources/mtn/images.json','resources/r69-title/atlas/images.json'];

export async function assembleMedia(){
  const plan=await preparePlan(),complete=path.join(cache,'public-r3'),marker=path.join(complete,'resources/media-encoding.json');
  const current=await readJson(marker).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(current){if(await realpath(complete)!==complete||current.format!==variant||current.sourceIdentity!==plan.identity)throw Error('Media public directory does not match the source');return complete;}
  // Refuse before creating a staging tree or touching the previous dist.
  const ready={};for(const type of ['image','audio'])ready[type]=new Set(await readdir(path.join(cache,'receipt',type)).catch(e=>{if(e.code!=='ENOENT')throw e;return [];}));
  const missing={image:plan.images.filter(x=>!ready.image.has(path.basename(receipt('image',x.dst)))),audio:plan.audio.filter(x=>!ready.audio.has(path.basename(receipt('audio',x.src))))};
  if(missing.image.length||missing.audio.length)throw Error('芳乃压缩配方不完整：还缺 '+missing.image.length+' 张 WebP 与 '+missing.audio.length+' 段 Opus；现有 dist 保留。');
  const stage=path.join(cache,'assembly-'+randomUUID()),photo=new Map(),songs=new Map(),changes=new Map(),refs=new Map();
  const baseline=await readJson(path.join(base,'resources/inventory.json'));
  const inventory=new Map([...baseline.assets,...baseline.generated].map(a=>['resources/'+a.file,a]));
  const oldStat=await stat(path.join(base,'resources/inventory.json'));
  const reference=(n,old)=>{if(old&&old.sha256&&!/^[0-9a-f]{64}$/u.test(old.sha256))throw Error('Unreadable asset digest');refs.set(n,old);};
  const accepted=(n,data,prior)=>{if(prior&&(prior.bytes!==data.length||prior.sha256!==digest(data)))throw Error('Encoded derivative differs: '+n);return row(n,data);};
  await mkdir(stage);
  for(const v of plan.images){
    const r=await readJson(receipt('image',v.dst)),data=await readFile(abs(encoded,v.dst)),old=inventory.get(v.src);
    const actual=accepted(v.dst,data,r);
    if(r.src!==v.src||r.dst!==v.dst||r.quality!==75||typeof r.transparent!=='boolean'||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||old&&(r.old!==old.sha256||r.before!==old.bytes))throw Error('Unbound WebP receipt: '+v.dst);
    photo.set(v.src,{...r,...actual});await writeAt(stage,v.dst,data);reference(v.dst,actual);
  }
  for(const v of plan.audio){
    const r=await readJson(receipt('audio',v.src)),data=await readFile(abs(encoded,v.src)),kbps=v.kind==='music'?64:32,info=opusReceipt(data,kbps,v.frames,v.channels),actual=accepted(v.src,data,r);
    if(r.old!==v.sha256||r.samples!==info.samples||r.bitrateKbps!==kbps)throw Error('Unbound Opus receipt: '+v.src);
    songs.set(v.src,{...info,bytes:actual.bytes,sha256:actual.sha256});await writeAt(stage,v.src,data);reference(v.src,actual);
  }
  for(const v of plan.sidecars){
    const old=await readFile(abs(base,v.src)),newData=await readFile(abs(stage,v.twin));
    if(digest(old)!==v.original.sha256||old.length!==v.original.bytes)throw Error('Original voice sidecar changed');
    const updated=accepted(v.src,newData,songs.get(v.twin));
    await writeAt(stage,v.src,newData);reference(v.src,updated);changes.set(v.src,updated);
  }
  for(const file of imageLists){
    const old=await readJson(abs(base,file)),parent=path.posix.normalize(path.posix.join(path.posix.dirname(file),old.assetBaseUrl??'.'));
    const entries=old.entries.map(r=>{
      const image=photo.get(parent+'/'+r.file);
      if(!image||image.width!==r.width||image.height!==r.height||image.old!==r.sha256||image.before!==r.bytes)throw Error('Image manifest geometry or provenance changed: '+r.file);
      return {...r,file:path.posix.basename(image.file),bytes:image.bytes,sha256:image.sha256};
    });
    changes.set(file,mk({...old,entries}));
  }
  const maskFile='resources/native-masks.json',masks=await readJson(abs(base,maskFile));
  const maskEntries=masks.entries.map(r=>{
    const image=photo.get('resources/images/'+r.file);
    if(!image||image.old!==r.sha256||image.width!==r.width||image.height!==r.height)throw Error('Unbound stencil source: '+r.name);
    const alternatives=r.alternatives?.map(other=>other.imageId===r.imageId?{...other,sha256:image.sha256}:other);
    return {...r,file:path.posix.basename(image.file),sha256:image.sha256,alternatives};
  });
  changes.set(maskFile,mk({...masks,entries:maskEntries}));
  const menuFile='resources/r69-title/menu/layers.json',originalMenu=await readJson(abs(base,menuFile));
  const layers=originalMenu.layers.map(r=>{
    if(r.file===undefined||r.file===null)return r;
    const member=photo.get('resources/r69-title/menu/'+r.file);
    if(!member||member.width!==r.width||member.height!==r.height)throw Error('Unbound title menu image: '+r.file);
    return {...r,file:path.posix.basename(member.file)};
  });
  changes.set(menuFile,mk({...originalMenu,layers}));
  for(const dir of mediaDirs){
    const name=dir+'/manifest.json',old=await readJson(abs(base,name));
    const files=old.files.map(r=>{
      const key=dir+'/'+r.file,encoded=songs.get(key);if(!encoded)return r;
      // Preserve original source timeline and exact saved loop seconds. Only
      // the physical decoder and recorded byte/sample headers are changed.
      const {duration, ...fields}=encoded;
      let updated={...r,...fields,loopSampleRate:r.loopSampleRate??r.sampleRate};
      if(r.nonLoopSidecar){
        const spec=plan.sidecars.find(s=>s.owner===key),side=changes.get(spec.src);
        updated.nonLoopSidecar={...r.nonLoopSidecar,bytes:side.bytes,sha256:side.sha256,codec:'opus'};
      }
      return updated;
    });
    const codecs={};for(const f of files)codecs[f.codec]=(codecs[f.codec]??0)+1;
    changes.set(name,mk({...old,codecs,files}));
  }
  for(const [n,data] of changes)if(Buffer.isBuffer(data)){await writeAt(stage,n,data);reference(n,row(n,data));}
  const skip=new Set([...photo.keys(),...songs.keys(),...changes.keys(),'resources/inventory.json','resources/session.json','resources/r69-title/title-assets.json',...mediaDirs.map(x=>x+'/stream-index.json')]);
  for(const file of plan.files){
    if(skip.has(file))continue;
    if(/[.](png|jpg|jpeg|svg)$/iu.test(file))throw Error('Unconverted deliverable image '+file);
    const p=abs(base,file),dst=abs(stage,file),actual=row(file,await readFile(p)),prior=inventory.get(file);
    if(prior&&(prior.bytes!==actual.bytes||prior.sha256!==actual.sha256))throw Error('Original dependency changed: '+file);
    await mkdir(path.dirname(dst),{recursive:true});await copyFile(p,dst);reference(file,actual);
  }
  for(const dir of mediaDirs){await prepareAudioStreamIndex(abs(stage,dir));const file=dir+'/stream-index.json';reference(file,row(file,await readFile(abs(stage,file))));}
  const titleSeal='resources/r69-title/title-assets.json',titlePrefix='resources/r69-title/',oldTitle=await readJson(abs(base,titleSeal));
  const titleFiles=oldTitle.files.map(r=>{
    const file=titlePrefix+r.file,f=refs.get(photo.get(file)?.file??file);
    if(!f)throw Error('Missing derivative title member: '+file);
    return {...f,file:f.file.slice(titlePrefix.length)};
  });
  const newTitle=mk({...oldTitle,files:titleFiles,identity:digest(mk(titleFiles))});await writeAt(stage,titleSeal,newTitle);reference(titleSeal,row(titleSeal,newTitle));
  const rows=[...refs.values()].sort((a,b)=>a.file.localeCompare(b.file,'en'));
  const summary={format:variant,sourceIdentity:plan.identity,payloadSha256:digest(mk(rows)),images:plan.images.length,voices:plan.audio.filter(x=>x.kind==='voice').length,music:plan.audio.filter(x=>x.kind==='music').length,unchangedEffects:plan.effects.length,webpQuality:75,voiceKbps:32,musicKbps:64,payloadBytes:rows.reduce((n,e)=>n+e.bytes,0)};
  const session=await readJson(path.join(base,'resources/session.json'));
  const desc=mk({...session,mediaVariant:summary});await writeAt(stage,'resources/session.json',desc);reference('resources/session.json',row('resources/session.json',desc));
  const proof=mk(summary),proofName='resources/media-encoding.json';await writeAt(stage,proofName,proof);reference(proofName,row(proofName,proof));
  const assets=[...refs.values()].filter(r=>r.file.startsWith('resources/')).map(r=>({...r,file:r.file.slice(10)})).sort((a,b)=>a.file.localeCompare(b.file,'en'));
  const inv=mk({...baseline,kind:'derived-yoshino-media-inventory',mediaVariant:summary,files:assets.length,bytes:assets.reduce((n,e)=>n+e.bytes,0),assets,generated:[]});
  await writeAt(stage,'resources/inventory.json',inv);
  await rename(stage,complete);console.log(JSON.stringify({...summary,originalInventoryBytes:oldStat.size}));return complete;
}
