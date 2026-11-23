import {readFile,copyFile,mkdir,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAssets as local} from './web-paths.mjs';
import {Psb2Reader} from '../../src/formats/psb2/reader.ts';
import {pimgLayout} from '../../src/graphics/pimg-layout.ts';

const [flag,requested,...extra]=process.argv.slice(2);
if(flag!=='--prepared'||!requested||!path.isAbsolute(requested)||extra.length)throw Error('Use --prepared with an absolute offline preparation root');
const prepared=await realpath(requested);
await mkdir(local,{recursive:true});if(await realpath(local)!==local)throw Error('local-assets must not be redirected');
const input=path.join(prepared,'runtime-data/graphics-r9');
const models=JSON.parse(await readFile(path.join(input,'pimg/pimg-models.json'),'utf8'));
const decoded=JSON.parse(await readFile(path.join(input,'pimg-images/manifest.json'),'utf8'));
const pngs=new Map(decoded.entries.map(row=>[row.id,row]));
const modelSource=[['quickmenu','patch_data1080.xp3'],['voicebar','data1080.xp3']];
const layout={}, assets=new Set();
for(const [name,archive] of modelSource){
  const matches=models.models.filter(row=>row.name===name+'.pimg');
  if(matches.length!==1)throw Error('Missing or ambiguous PIMG: '+name);
  const m=matches[0];
  if(path.basename(m.source)!==archive||!/^\d{5}[.]psbmeta$/u.test(m.metadataFile))throw Error('Wrong active 1080 UI sheet '+name);
  const p=pimgLayout(new Psb2Reader(await readFile(path.join(input,'pimg',m.metadataFile)),{},m.sourceByteLength));
  if(p.width!==1920||p.height!==1080)throw Error('Unexpected PC overlay surface '+name);
  const textures=new Map(m.resources.map(r=>[r.name,r.imageId]));
  layout[name]=Object.fromEntries(p.layers.filter(l=>l.layerType===0).map(l=>{
    const box={x:l.left,y:l.top,w:l.width,h:l.height};
    if(!l.imageName)return [l.name,box];
    const raster=pngs.get(textures.get(l.imageName));
    if(!raster||!/^\d{5}[.]png$/u.test(raster.file)||raster.width!==l.width||raster.height!==l.height)throw Error('Unbound original UI pixel layer '+l.name);
    assets.add(raster.file);return [l.name,{...box,file:raster.file}];
  }));
}
const out=path.join(local,'pc-dialogue-v1');await mkdir(out);
for(const file of assets)await copyFile(path.join(input,'pimg-images',file),path.join(out,file));
await writeFile(path.join(out,'layout.json'),JSON.stringify(layout),{flag:'wx'});
console.log(JSON.stringify({out,originalSprites:assets.size}));
