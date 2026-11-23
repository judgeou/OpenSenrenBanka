import {readFile,realpath,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {localAssets as local} from './web-paths.mjs';
import path from 'node:path';
import {Psb2Reader} from '../../src/formats/psb2/reader.ts';
import {pimgLayout} from '../../src/graphics/pimg-layout.ts';

const [flag,requested,...extra]=process.argv.slice(2);
if(flag!=='--prepared'||!requested||!path.isAbsolute(requested)||extra.length)throw Error('Provide --prepared with the absolute offline preparation root');
const input=path.join(await realpath(requested),'runtime-data/graphics-r9');
await mkdir(local,{recursive:true});if(await realpath(local)!==local)throw Error('local-assets must not be redirected');
const read=async relative=>JSON.parse(await readFile(path.join(input,relative),'utf8'));
const models=await read('pimg/pimg-models.json'),raster=new Map((await read('pimg-images/manifest.json')).entries.map(r=>[r.id,r]));
const expect={sl_save:'image.pck',sl_load:'image.pck',sl_qlod:'image.pck',dialog:'image.pck',qload_popup:'data1080.xp3'};
const layouts={},pics=new Set();
function use(sheet,tag){
  if(sheet==='dialog')return /^(?:@cont_bg|@dialog_(?:save|load|rewrite|qsave|qload)|_yesno\/@(?:yes|no):(?:defo|over|on))$/u.test(tag);
  if(sheet==='qload_popup')return ['#num','#text','#chapter','#date','thumb','qload','#rect'].includes(tag);
  return /^@(?:bg|cont_bg|new)$|^_data(?:_l)?\/|^#_data_表示位置\/|^_foot\/_(?:save|load|qroad|back|title)\/|^_(?:home|prev|prev_more|next|next_more|end|num|plus|mainus)\//u.test(tag);
}
for(const [sheet,archive] of Object.entries(expect)){
  const match=models.models.filter(m=>m.name===sheet+'.pimg');
  if(match.length!==1||path.basename(match[0].source).toLowerCase()!==archive||!/^\d+[.]psbmeta$/u.test(match[0].metadataFile))throw Error('Original active PIMG not bound: '+sheet);
  const m=match[0],p=pimgLayout(new Psb2Reader(await readFile(path.join(input,'pimg',m.metadataFile)),{},m.sourceByteLength));
  if(sheet==='qload_popup'?p.width!==252||p.height!==228:p.width!==1920||p.height!==1080)throw Error('Original sheet size differs: '+sheet);
  const refs=new Map(m.resources.map(r=>[r.name,r.imageId]));const rows={};
  for(const l of p.layers){
    if(l.layerType!==0)continue;const components=[l.name];let parent=l.parentId;
    while(parent!==undefined){const q=p.byId.get(parent);components.unshift(q.name);parent=q.parentId;}
    const tag=components.join('/');if(!use(sheet,tag))continue;
    const box={x:l.left,y:l.top,w:l.width,h:l.height};
    if(l.imageName){
      const r=raster.get(refs.get(l.imageName));if(!r||!/^\d{5}[.]png$/u.test(r.file)||l.width!==r.width||l.height!==r.height)throw Error('Original save art missing '+sheet+'/'+tag);
      box.file=r.file;pics.add(r.file);
    }
    if(Object.hasOwn(rows,tag))throw Error('Ambiguous save layer '+tag);rows[tag]=box;
  }
  layouts[sheet]=rows;
}
const out=path.join(local,'pc-save-v1');await mkdir(out);
for(const file of pics)await copyFile(path.join(input,'pimg-images',file),path.join(out,file));
await writeFile(path.join(out,'layout.json'),JSON.stringify(layouts),{flag:'wx'});
console.log(JSON.stringify({out,layers:pics.size}));
