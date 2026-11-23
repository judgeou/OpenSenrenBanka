import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {audioKind,cache,digest,readJson} from './yoshino-media-plan.mjs';
import {work} from './web-paths.mjs';
import {recoveredMakoAudio} from './mako-recovered-audio.mjs';
import {opusReceipt} from './yoshino-opus-inspect.mjs';

const graphics=path.join(work,'mako-prepared-graphics');
const imageCache=path.join(cache,'mako-images');
function nextId(old){
  if(!/^\d{5}$/u.test(old))throw Error('Expected a numeric supplemental resource key: '+old);
  const id=80000+Number(old);if(id>89999)throw Error('Supplemental resource key out of range');
  return String(id);
}
function extend(before,rows,key){
  const set=new Set(before.map(key));for(const row of rows){const id=key(row);if(set.has(id))throw Error('Supplemental resource collides with baseline: '+id);set.add(id);}
  return [...before,...rows];
}

export async function appendMakoAssets(io){
  let imageCount=0;
  async function raster(location,source){
    const manifest=await readJson(path.join(graphics,source,'manifest.json'));
    if(manifest.format!=='prepared-web-images-v1'||manifest.failed!==0||!manifest.entries.length)throw Error('Mako image sources incomplete: '+source);
    const originals=await io.read(location),rows=[];
    for(const r of manifest.entries){
      const src=source+'/'+r.file,dest=src.replace(/[.][^.]+$/u,'.webp');
      const receipt=await readJson(path.join(imageCache,'receipt/image',dest.replaceAll('/','-')+'.json'));
      if(receipt.old!==r.sha256||receipt.before!==r.bytes||receipt.quality!==75||receipt.src!==src||receipt.dst!==dest||receipt.width!==r.width||receipt.height!==r.height||typeof receipt.transparent!=='boolean')throw Error('WebP receipt differs: '+src);
      const id=nextId(r.id),file=id+'.webp';
      await io.use(path.posix.dirname(location)+'/'+file,path.join(imageCache,'encoded',dest),receipt);
      rows.push({...r,id,file,sha256:receipt.sha256,bytes:receipt.bytes});
      imageCount++;
    }
    const entries=extend(originals.entries,rows,r=>r.id);
    await io.json(location,{...originals,entries,totalImages:entries.length});
    return new Map(rows.map(r=>[r.id,r]));
  }
  await raster('images/manifest.json','ordinary-png');
  const cgLayers=await raster('pimg-images/manifest.json','pimg-png');
  const motionLayers=await raster('mtn/images.json','mtn-png');
  async function models(location,inputDirectory,inputFile,isPimg){
    const previous=await io.read(location),from=path.join(graphics,inputDirectory),incoming=await readJson(path.join(from,inputFile)),rows=[];
    if(incoming.format!==previous.format||(incoming.failed??0)!==0||!incoming.models.length)throw Error('Model format differs: '+inputFile);
    for(const m of incoming.models){
      const metadataFile=nextId(m.metadataFile.split('.')[0])+'.psbmeta';
      await io.use(path.posix.dirname(location)+'/'+metadataFile,path.join(from,m.metadataFile),{sha256:m.metadataSha256,bytes:m.metadataBytes});
      const ref=isPimg?'resources':'textures',index=isPimg?cgLayers:motionLayers;
      const links=m[ref].map(row=>{
        const imageId=nextId(row.imageId),match=index.get(imageId);
        if(!match)throw Error('Model raster was not encoded: '+m.name+' '+row.imageId);
        return {...row,imageId,[isPimg?'targetFile':'imageFile']:match.file};
      });
      rows.push({...m,...(isPimg?{id:nextId(m.id)}:{}),metadataFile,[ref]:links});
    }
    await io.json(location,{...previous,models:extend(previous.models,rows,r=>r.name.toLowerCase())});
  }
  await models('pimg/models.json','pimg-inputs','pimg-models.json',true);
  await models('mtn/models.json','mtn-png','motion-models.json',false);

  const plan=await recoveredMakoAudio(),original=await io.read('audio/manifest.json');
  const byPath=new Map(plan.audio.map(a=>[a.src,a]));
  const extra=[];let voices=0,music=0,effects=0;
  for(const r of plan.manifest.files){
    const id=nextId(r.id),file=id+'.ogg',kind=audioKind(r.name);
    if(r.nonLoopSidecar)throw Error('Mako audio requires an unplanned distinct sidecar: '+r.name);
    if(kind==='effect'){
      await io.use('audio/'+file,path.join(plan.base,r.file),r);extra.push({...r,id,file});effects++;continue;
    }
    const encoding=byPath.get(r.file),kbps=kind==='music'?64:32,proof=await readJson(path.join(plan.cache,'receipt/audio',r.file+'.json'));
    const payload=path.join(plan.encoded,r.file),bytes=await readFile(payload);
    const measured=opusReceipt(bytes,kbps,encoding.frames,r.channels);
    if(proof.old!==r.sha256||proof.bitrateKbps!==kbps||proof.samples!==measured.samples||proof.preSkip!==measured.preSkip||proof.bytes!==bytes.length||proof.sha256!==digest(bytes))throw Error('Mako Opus receipt differs: '+r.name);
    const {old,duration,bitrateKbps,...encoded}=proof;
    await io.use('audio/'+file,payload,proof,bytes);
    extra.push({...r,...encoded,id,file,loopSampleRate:r.loopSampleRate??r.sampleRate});
    if(kind==='music')music++;else voices++;
  }
  const files=extend(original.files,extra,f=>f.id);extend(original.files,extra,f=>f.name.toLowerCase().replaceAll(String.fromCharCode(92),'/'));
  const codecs={};for(const f of files)codecs[f.codec]=(codecs[f.codec]??0)+1;
  await io.json('audio/manifest.json',{...original,files,entries:files.length,codecs});
  return {images:imageCount,voices,music,unchangedEffects:effects};
}
