import path from 'node:path';
import { mkdir, realpath, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {localAssets as local,projectRoot} from './web-paths.mjs';
import { solveRoute } from './source-route.mjs';
import { scanOriginalScenes } from '../scan-original-scenes.mjs';
import { packageR62Assets } from '../package-r62-assets.mjs';

const args=process.argv.slice(2), planOnly=args.includes('--plan');
function opt(name){const i=args.indexOf(name);const value=args[i+1];if(i<0||!value||value.startsWith('--'))throw Error('必须显式提供 '+name);return value;}
const requested=opt('--prepared'), title=opt('--title');
if(args.length!==(planOnly?5:4)||!path.isAbsolute(requested)||!/^[a-zA-Z0-9_-]+$/u.test(title))throw Error('用法：--prepared <本地准备数据绝对路径> --title <该目录内的标题资源子目录> [--plan]');
const prepared=await realpath(requested);
const inside=(root,file)=>{const r=path.relative(root,file);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
if(prepared===projectRoot||prepared===local||inside(local,prepared))throw Error('准备输入与专版输出不能重合');
await mkdir(local,{recursive:true});
if(path.relative(await realpath(projectRoot),await realpath(local))!=='local-assets')throw Error('local-assets 不得重定向到其他目录');
const id=randomUUID().slice(0,8), stage=path.join(local,'stage-'+id), site=path.join(local,'site');
const route=await solveRoute(prepared);
const parts=route.parts.map(x=>({...x,limit:Infinity}));
const scan=scanOriginalScenes(parts,true);
const sceneIds=[...new Set(parts.map(x=>x.asset.id))].sort();
const scope={...scan,edition:'yoshino-v1',milestone:'R69',label:'芳乃线专版',initial:route.entry,scenarioIds:sceneIds,
  firstChoice:scan.flows.find(x=>x.asset==='0001'&&x.scene===5),audio:[...scan.audio.values()],shapes:[...scan.shapes.values()],
  counts:{texts:scan.texts.length,commands:scan.commands.length,viableScenes:parts.length},
  end:{main:route.audit.mainEnd,after:route.audit.afterEnd}};
console.log(JSON.stringify({phase:'source-plan',scenarioIds:sceneIds,...scope.counts,routeStates:route.audit.exploredStates}));
if(!planOnly)await mkdir(stage);
const inventory=await packageR62Assets(prepared,stage,scope,{planOnly,editionAssets:async io=>{
  const seal=await io.json(title+'/title-assets.json');
  if(seal.format!=='senren-r69-title-assets-v1'||!Array.isArray(seal.files)||seal.files.length<8||seal.files.length>100||
      io.hash(Buffer.from(JSON.stringify(seal.files)))!==seal.identity)throw Error('原标题资源清单无效：'+title);
  const seen=new Set();
  for(const row of seal.files){
    if(typeof row.file!=='string'||!row.file.split('/').every(s=>/^[a-z0-9-]+(?:[.][a-z0-9]+)?$/u.test(s))||seen.has(row.file))throw Error('非法原标题文件');
    seen.add(row.file);const result=await io.copy(title+'/'+row.file,'r69-title/'+row.file);
    if(row.bytes!==result.bytes||row.sha256!==result.sha256)throw Error('原标题媒体摘要错误：'+row.file);
  }
  await io.copy(title+'/title-assets.json','r69-title/title-assets.json');
  await io.writeJson('yoshino-route.json',route.policy);
}});
const report={format:'senren-y01-preflight-v1',identity:inventory.identity,scenarioIds:sceneIds,counts:scope.counts,
  assetFiles:inventory.assets.length+inventory.generated.length,assetBytes:[...inventory.assets,...inventory.generated].reduce((n,x)=>n+x.bytes,0),
  sharedContainers:['整份原 SCN 保留原偏移与摘要（仅 0001–0031）；同容器未选节点不可进入。','活动同一个 MTN/PIMG 容器的图层/纹理及与状态表达式共享的候选保持完整。'],
  route:route.audit,assets:inventory.assets,generated:inventory.generated};
const record=path.join(local,(planOnly?'preflight-':'prepared-')+id+'.json');
await writeFile(record,JSON.stringify(report),{flag:'wx'});
if(!planOnly){
  const old=await lstat(site).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const previous=path.join(local,'previous-'+id);
  if(old){
    if(!old.isDirectory()||old.isSymbolicLink()||JSON.parse(await readFile(path.join(site,'resources/session.json'),'utf8')).edition!=='yoshino-v1')throw Error('保留非本专版生成的 site 目录');
    await rename(site,previous);
  }
  try{await rename(stage,site);}catch(error){if(old)await rename(previous,site);throw error;}
}
console.log(JSON.stringify({identity:report.identity,assetFiles:report.assetFiles,assetBytes:report.assetBytes,planOnly,report:record}));
