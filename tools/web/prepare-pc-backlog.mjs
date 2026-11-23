import {readFile,copyFile,mkdir,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAssets as owned} from './web-paths.mjs';
import {Psb2Reader} from '../../src/formats/psb2/reader.ts';
import {pimgLayout} from '../../src/graphics/pimg-layout.ts';
const [flag,input,...extra]=process.argv.slice(2);
if(flag!=='--prepared'||!input||!path.isAbsolute(input)||extra.length)throw Error('Use --prepared ABSOLUTE_OFFLINE_ROOT');
const root=path.join(await realpath(input),'runtime-data/graphics-r9');
await mkdir(owned,{recursive:true});if(await realpath(owned)!==owned)throw Error('Invalid redirected art output');
const json=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
const all=(await json('pimg/pimg-models.json')).models,png=new Map((await json('pimg-images/manifest.json')).entries.map(r=>[r.id,r])),files=new Set(),layout={};
for(const [sheet,height] of [['backlog',1440],['dialog',1080]]){
  const m=all.filter(r=>r.name===sheet+'.pimg');if(m.length!==1||path.basename(m[0].source)!=='image.pck'||!/^\d+[.]psbmeta$/u.test(m[0].metadataFile))throw Error('Missing original active '+sheet);
  const {metadataFile,sourceByteLength,resources}=m[0],p=pimgLayout(new Psb2Reader(await readFile(path.join(root,'pimg',metadataFile)),{},sourceByteLength));
  if(p.width!==1920||p.height!==height)throw Error('Wrong native backlog scale');
  const ids=new Map(resources.map(r=>[r.name,r.imageId]));const rows={};
  for(const l of p.layers){
    if(l.layerType!==0)continue;const name=[l.name];let i=l.parentId;
    while(i!==undefined){const q=p.byId.get(i);name.unshift(q.name);i=q.parentId;}
    const key=name.join('/');
    if(!(sheet==='dialog'?/^(?:@cont_bg|@dialog_sceanjump|_yesno\/@(?:yes|no):(?:defo|over|on))$/u:/^(?:@bg|@backlog|_chapter_title\/@|スクロール項目\/@|_(?:slider|back|jump|home|pageup|next|end)\/)/u).test(key))continue;
    const r={x:l.left,y:l.top,w:l.width,h:l.height};
    if(l.imageName){const image=png.get(ids.get(l.imageName));if(!image||!/^\d+[.]png$/u.test(image.file)||image.width!==l.width||image.height!==l.height)throw Error('Unbound original history art '+key);r.file=image.file;files.add(r.file);}
    if(Object.hasOwn(rows,key))throw Error('Ambiguous backlog layer '+key);rows[key]=r;
  }
  layout[sheet]=rows;
}
const out=path.join(owned,'pc-backlog-v1');await mkdir(out);
for(const file of files)await copyFile(path.join(root,'pimg-images',file),path.join(out,file));
await writeFile(path.join(out,'layout.json'),JSON.stringify(layout),{flag:'wx'});console.log(JSON.stringify({out,originalLayers:files.size}));
