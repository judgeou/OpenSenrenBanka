import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link,lstat,mkdir,readFile,realpath,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {cache,digest,readJson,variant} from './yoshino-media-plan.mjs';
import {appendMakoAssets} from './mako-media-files.mjs';
import {work} from './web-paths.mjs';
import {prepareAudioStreamIndex} from '../prepare-audio-stream-index.mjs';
import {originalIndex} from '../r68-original-graph.mjs';
import {invocation} from '../../src/scenario/invocation.ts';

const originalEd=path.join(work,'r70-original-ed-mako');
const rel=key=>typeof key==='string'&&key.split('/').every(s=>s.length>0&&s!=='.'&&s!=='..'&&!s.includes(String.fromCharCode(92))&&!s.includes(':'));
const bytes=(key,data)=>({file:key,bytes:data.length,sha256:digest(data)});
async function buildMakoOverlay(archive,planning,outName){
  if(!/^mako-public-[a-z0-9-]+$/u.test(outName))throw Error('Expected a new owned Mako staging name');
  const out=path.join(cache,outName),base=path.join(cache,'public-r3');
  if(await realpath(cache)!==cache||await realpath(base)!==base)throw Error('Non-owned image or publication storage');
  const prior=await readJson(path.join(base,'resources/inventory.json')),desc=await readJson(path.join(base,'resources/session.json'));
  if(desc.edition!=='yoshino-v1'||desc.mediaVariant.format!==variant||prior.identity!==desc.identity)throw Error('Invalid sealed baseline edition');
  const picked=(await readJson(planning)).policy,oldRoute=await readJson(path.join(base,'resources/yoshino-route.json'));
  if(picked.format!=='senren-y01-route-v2'||oldRoute.format!=='senren-y01-route-v1'||Object.keys(oldRoute.positions).some(at=>!picked.positions[at]))throw Error('Mako route does not preserve baseline locations');
  const stage=path.join(cache,'mako-assemble-'+randomUUID()),output=path.join(stage,'resources');
  await mkdir(output,{recursive:true});
  const changed=new Map(),own=new Map(prior.assets.map(row=>[row.file,row]));
  if(own.size!==prior.assets.length||prior.assets.some(row=>!rel(row.file)))throw Error('Invalid baseline inventory');
  const location=k=>{if(!rel(k))throw Error('Invalid asset path '+k);return path.join(output,k);};
  async function use(key,source,seal,data){
    if(own.has(key)||changed.has(key))throw Error('New media file collides with an existing key: '+key);
    const info=await lstat(source);
    if(info.isSymbolicLink()||!info.isFile()||info.size!==seal.bytes)throw Error('Invalid supplemental source '+source);
    if(data){if(data.length!==seal.bytes||digest(data)!==seal.sha256)throw Error('Supplemental bytes changed: '+key);}
    else {
      const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);
      if(hash.digest('hex')!==seal.sha256)throw Error('Supplemental source digest changed: '+key);
    }
    const target=location(key);await mkdir(path.dirname(target),{recursive:true});await link(source,target);
    changed.set(key,{file:key,bytes:seal.bytes,sha256:seal.sha256});
  }
  async function json(key,value){const target=location(key),raw=Buffer.from(JSON.stringify(value));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,raw,{flag:'wx'});changed.set(key,bytes(key,raw));}
  const read=key=>readJson(path.join(base,'resources',key));
  const counts=await appendMakoAssets({read,json,use});
  const incoming=await readJson(path.join(archive,'manifest.json')),before=await read('scenarios/manifest.json'),scenes=new Set(Object.keys(picked.positions).map(k=>k.split('/')[0]));
  const saved=new Map(before.files.map(row=>[row.id,row]));
  for(const item of incoming.files){
    if(!scenes.has(item.id))continue;
    if(saved.has(item.id)){if(saved.get(item.id).sha256!==item.sha256)throw Error('Original shared scenario changed '+item.id);continue;}
    if(!rel(item.binaryFile)||!rel(item.indexFile))throw Error('Invalid original scene capsule');
    await use('scenarios/'+item.binaryFile,path.join(archive,item.binaryFile),item);
    const indexPath=path.join(archive,item.indexFile),index=await readFile(indexPath);
    await use('scenarios/'+item.indexFile,indexPath,bytes(item.indexFile,index),index);
    saved.set(item.id,item);
  }
  const files=[...saved.values()].sort((a,b)=>a.id.localeCompare(b.id));
  if(![...scenes].every(id=>saved.has(id)))throw Error('New route lacks original SCN files');
  await json('scenarios/manifest.json',{...before,files,totalEntries:files.length,preparedEntries:files.length});
  const idx=await originalIndex('.',archive),{doc}=await idx.asset('0041'),scene=3;
  const edCalls=doc.index.scenes[scene].events.filter(e=>e.kind==='command').map(e=>invocation(doc,e,{asset:'0041',scene,event:e.sourceIndex,sourceRef:e.sourceRef})).filter(c=>c.name.toLowerCase()==='sysmovie');
  const ending=await readJson(path.join(originalEd,'ed.json')),ed=edCalls[0];
  if(edCalls.length!==1||ed.parameters.file!=='ED2_Mako'||ed.parameters.flag!=='ed2_mako'||ending.file!=='ED2_Mako1080.mp4')throw Error('Original Mako film identity changed');
  await use('movies/'+ending.file,path.join(originalEd,ending.file),ending);
  await json('movies/ed-mako.json',{...ending,command:ed.parameters,location:ed.location});
  await json('yoshino-route.json',picked);
  await json('yoshino-route-v1.json',oldRoute);
  // Save namespace and legacy identity remain listed explicitly. Do not share
  // the new compatibility identity with an unrelated data set.
  const identity=digest(Buffer.from(JSON.stringify([desc.identity,[...changed].sort()])));
  const proof={...desc.mediaVariant,sourceIdentity:identity,...Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,desc.mediaVariant[k]+n])),payloadSha256:digest(Buffer.from(JSON.stringify([...changed].sort())))};
  await json('media-encoding.json',proof);
  await json('session.json',{...desc,identity,previousResourceIdentity:desc.identity,label:'千恋万花・芳乃和茉子版',datasets:{...desc.datasets,endingMako:'movies/ed-mako.json'},mediaVariant:proof});
  for(const [key,row] of own){
    if(changed.has(key)||key==='audio/stream-index.json')continue;
    const target=location(key);await mkdir(path.dirname(target),{recursive:true});await link(path.join(base,'resources',key),target);changed.set(key,row);
  }
  await link(path.join(base,'yoshino.webp'),path.join(stage,'yoshino.webp'));
  const sound=await prepareAudioStreamIndex(path.join(output,'audio'));
  const seek='audio/stream-index.json';changed.set(seek,bytes(seek,await readFile(location(seek))));
  const assets=[...changed.values()].sort((a,b)=>a.file.localeCompare(b.file));
  await json('inventory.json',{...prior,kind:'derived-yoshino-mako-media-inventory',identity,scenarioFiles:files.length,mediaVariant:proof,files:assets.length,bytes:assets.reduce((n,row)=>n+row.bytes,0),assets,generated:[]});
  await rename(stage,out);
  return {out,identity,assets:assets.length,scenarios:files.length,...counts,tracks:sound.tracks};
}
const [archive,planning,outName]=process.argv.slice(2);
if(!archive||!planning||!outName||process.argv.length!==5)throw Error('Usage: mako-media-overlay.mjs ORIGINAL_SCENARIO_DIR ROUTE_GRAPH_FILE mako-public-NAME');
console.log(JSON.stringify(await buildMakoOverlay(path.resolve(archive),path.resolve(planning),outName)));
