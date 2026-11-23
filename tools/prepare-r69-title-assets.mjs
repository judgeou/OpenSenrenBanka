import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const work=await realpath('work');
const [auditPath,target,...extra]=process.argv.slice(2);
if(!auditPath||!target||extra.length||!/^r69-title-assets-[a-z0-9-]+$/u.test(path.basename(target))||path.dirname(path.resolve(target))!==work||path.dirname(path.resolve(auditPath))!==work)throw Error('Use a title source audit and a new work/r69-title-assets-NAME directory');
const audit=await json(auditPath);
if(audit.motion?.unsupported||audit.motion?.name!=='title_bg.mtn'||audit.menu?.archive!=='r9-chs-image'||audit.menu?.width!==1920||audit.menu?.height!==1080||audit.menu?.layers?.length!==48)throw Error('The original title source profile is not closed');
const files=[];
async function put(dest,file,bytes){
  const names=file.split('/'), leaf=names.pop();
  if(names.length>1||names.some(v=>! /^[a-z0-9-]+$/u.test(v))||! /^[a-z0-9-]+[.][a-z0-9]+$/u.test(leaf))throw Error('Unsafe prepared title asset name');
  await mkdir(path.dirname(path.join(dest,file)),{recursive:true});
  await writeFile(path.join(dest,file),bytes,{flag:'wx'});
  files.push({file,bytes:bytes.length,sha256:hash(bytes)});
}
async function copy(dest,file,source,sha256,count){
  const bytes=await readFile(source);
  if(count!==undefined&&count!==bytes.length||hash(bytes)!==sha256)throw Error('Authored title asset changed: '+source);
  await put(dest,file,bytes);
}
const mtndir=path.join(work,'mtn-textures','r9-v3'), pimgdir=path.join(work,'prepared-pimg-images','r9-chs-v2'), audioDir=path.join(work,'runtime-data','audio-r11-v3');
const [mtndb,atlasdb,pimgdb,audiodb]=await Promise.all([json(path.join(mtndir,'motion-models.json')),json(path.join(mtndir,'manifest.json')),json(path.join(pimgdir,'manifest.json')),json(path.join(audioDir,'manifest.json'))]);
const model=mtndb.models.find(m=>m.name==='title_bg.mtn'), music=audiodb.files.find(a=>a.name.toUpperCase()==='BGM61.OPUS');
if(!model||!music||model.textures.length!==audit.motion.atlasCount||model.metadataFile!==audit.motion.meta||!/^\d+[.]psbmeta$/u.test(model.metadataFile)||!/^\d+[.]ogg$/u.test(music.file))throw Error('Prepared title media does not match original audit');
const atlas=model.textures.map(t=>{
  const row=atlasdb.entries.find(x=>x.id===t.imageId&&x.file===t.imageFile);
  if(!row||!/^\d+[.]png$/u.test(row.file)||row.width!==t.width||row.height!==t.height)throw Error('Prepared title motion atlas changed');
  return row;
});
const rasters=[...new Set(audit.menu.layers.map(l=>l.imageName).filter(Boolean))].map(name=>{
  const row=pimgdb.entries.find(x=>x.name==='title.pimg/'+name);
  if(!row||!/^\d+[.]png$/u.test(row.file))throw Error('Missing active simplified Chinese title raster '+name);
  return row;
});
const dest=path.resolve(target);await mkdir(dest);
const emit=(name,value)=>put(dest,name,Buffer.from(JSON.stringify(value,null,2)+'\n'));
for(const row of atlas)await copy(dest,'atlas/'+row.file,path.join(mtndir,row.file),row.sha256,row.bytes);
for(const row of rasters)await copy(dest,'menu/'+row.file,path.join(pimgdir,row.file),row.sha256,row.bytes);
await copy(dest,'motion/'+model.metadataFile,path.join(mtndir,model.metadataFile),model.metadataSha256,model.metadataBytes);
await copy(dest,'music/'+music.file,path.join(audioDir,music.file),music.sha256,music.bytes);
for(const [archiveName,file,row] of [['r7-data1080','background.png',audit.media.staticBackground],['r7-data','ed-yoshino.jpg',audit.media.thumbnail]]){
  if(row.archive!==archiveName||!/^\d+[.]bin$/u.test(row.file))throw Error('Unexpected original title media provenance');
  await copy(dest,file,path.join(work,'base-resources',archiveName,row.file),row.sha256);
}
await emit('atlas/images.json',{...atlasdb,entries:atlas,failed:0});
await emit('motion/models.json',{...mtndb,models:[model],failed:0});
await emit('music/manifest.json',{...audiodb,entries:1,files:[music],failed:0,sourceWarnings:[]});
await emit('menu/layers.json',{width:audit.menu.width,height:audit.menu.height,sourceSha256:audit.menu.sha256,layers:audit.menu.layers.map(l=>({...l,...(l.imageName&&{file:rasters.find(x=>x.name==='title.pimg/'+l.imageName).file})}))});
const inventory=files.slice().sort((a,b)=>a.file.localeCompare(b.file));
await emit('title-assets.json',{format:'senren-r69-title-assets-v1',identity:hash(JSON.stringify(inventory)),files:inventory});
console.log(JSON.stringify({files:inventory.length,bytes:inventory.reduce((n,f)=>n+f.bytes,0),destination:dest}));
