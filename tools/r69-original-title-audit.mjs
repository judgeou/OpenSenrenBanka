import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Psb2Reader} from '../src/formats/psb2/reader.ts';
import {psbValue} from '../src/formats/psb-value.ts';
import {MtnDocument} from '../src/graphics/mtn-catalog.ts';
import {decodeMotionTree} from '../src/graphics/motion/nested-program.ts';
import {pimgLayout} from '../src/graphics/pimg-layout.ts';
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const titleName=/^r69-title-source-[a-z0-9-]+[.]json$/u;
const [output,...extra]=process.argv.slice(2);
if(!output||!titleName.test(path.basename(output))||path.dirname(path.resolve(output))!==path.resolve('work')||extra.length)throw Error('Pass a new work/r69-title-source-NAME.json path');
const raw=async (set,name)=>{
  const root=path.join('work','base-resources',set);
  const {entries}=await json(path.join(root,'manifest.json'));
  const hits=entries.filter(x=>x.name.toLowerCase()===name.toLowerCase());
  if(hits.length!==1||hits[0].state!=='exported'||!/^\d+[.]bin$/u.test(hits[0].file))throw Error('Missing authored title storage '+name);
  const {file,sha256,bytes:count}=hits[0], bytes=await readFile(path.join(root,file));
  if(bytes.length!==count||hash(bytes)!==sha256)throw Error('Title source digest changed: '+name);
  return {name,archive:set,file,sha256,bytes};
};
const source=await raw('r9-chs-image','title.pimg');
const layout=pimgLayout(new Psb2Reader(source.bytes));
const base='work/mtn-textures/r9-v3';
const model=(await json(path.join(base,'motion-models.json'))).models.find(x=>x.name.toLowerCase()==='title_bg.mtn');
if(!model||!/^\d+[.]psbmeta$/u.test(model.metadataFile))throw Error('Missing prepared native title motion');
const meta=await readFile(path.join(base,model.metadataFile));
if(hash(meta)!==model.metadataSha256)throw Error('Prepared title motion metadata changed');
const motion=new MtnDocument(new Psb2Reader(meta,{},model.sourceByteLength),model,undefined);
const programs=new Map();
function inspect(object,action,chain=[]){
  const id=object+'/'+action;
  if(chain.length>8||chain.includes(id))throw Error('Unexpected title motion recursion');
  if(programs.has(id))return;
  const source=motion.motionProgram(object,action);
  const read=(ref,key)=>{const at=motion.reader.property(ref,key);return at===undefined?undefined:psbValue(motion.reader,at);};
  const tracks=source.tracks.map(t=>{
    const toMotion=s=>{const m=/^motion[/]([^/]+)[/]([^/]+)$/u.exec(s??'');if(m)inspect(m[1],m[2],[...chain,id]);};
    const frames=t.frames.map(f=>{const c=f.contentRef===undefined?null:psbValue(motion.reader,f.contentRef);toMotion(c?.src);return {type:f.type,time:f.time,content:c};});
    for(const s of read(t.sourceRef,'particleMotionList')??[])toMotion(s);
    return {id:t.id,parent:t.parent,ref:t.sourceRef,label:t.label,type:read(t.sourceRef,'type'),inheritMask:read(t.sourceRef,'inheritMask'),frames};
  });
  programs.set(id,{ref:source.sourceRef,lastTime:source.lastTime,loopTime:source.loopTime?.nativeValue??source.loopTime?.value,tracks});
}
inspect('title_bg','title');
let unsupported;try{decodeMotionTree(motion,'title_bg','title');}catch(error){unsupported=error.message;}
const {bytes:unused,...archive}=source;
const edThumb=await raw('r7-data','thum/thum_ED芳乃.JPG');
const media={thumbnail:{archive:edThumb.archive,file:edThumb.file,sha256:edThumb.sha256},staticBackground:await raw('r7-data1080','title_bg.png').then(({bytes,...r})=>r),music:await raw('r11-bgm','BGM61.opus').then(({bytes,...r})=>r)};
const report={menu:{...archive,width:layout.width,height:layout.height,layers:layout.layers},motion:{name:model.name,sourceByteLength:model.sourceByteLength,meta:model.metadataFile,atlasCount:model.textures.length,unsupported,programs:Object.fromEntries(programs)},media};
await writeFile(output,JSON.stringify(report,(_key,v)=>typeof v==='bigint'?String(v):v,2)+'\n',{flag:'wx'});
