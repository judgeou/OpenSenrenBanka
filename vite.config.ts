import { defineConfig, normalizePath } from 'vite';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {localAssets,projectRoot} from './tools/web/web-paths.mjs';
const pimgRoots=new Map([['virtual:yoshino-pc-dialogue','pc-dialogue-v1'],['virtual:yoshino-pc-save','pc-save-v1'],['virtual:yoshino-pc-backlog','pc-backlog-v1']]);
const efficiency=process.env.SENREN_Y06_MODE??'both';
if(!['baseline','audio','graphics','both'].includes(efficiency))throw Error('Invalid SENREN_Y06_MODE');
export default defineConfig({
  define:{__SENREN_CONTINUOUS_OPUS__:efficiency==='audio'||efficiency==='both',__SENREN_DIRECT_TRANSITIONS__:efficiency==='graphics'||efficiency==='both'},
  root:projectRoot,base:'./',appType:'mpa',publicDir:false,
  plugins:[{
    name:'yoshino-pc-ui',resolveId(id){if(pimgRoots.has(id))return '\0'+id;},
    async load(id){
      if(!id.startsWith('\0'))return;const art=pimgRoots.get(id.slice(1));if(!art)return;
      const folder=path.join(localAssets,art);
      if(await realpath(folder)!==folder)throw Error('原 PC 界面资源目录不得重定向');
      const sheets:Record<string,Record<string,{file?:string}>>=JSON.parse(await readFile(path.join(folder,'layout.json'),'utf8'));
      const imports=new Map<string,string>();
      const source=Object.fromEntries(Object.entries(sheets).map(([sheet,rows])=>[sheet,Object.fromEntries(Object.entries(rows).map(([name,layer])=>{
        const {file,...box}=layer;if(!file)return [name,JSON.stringify(box)];
        if(!/^\d{5}[.]png$/u.test(file))throw Error('非法原界面资源文件名');
        if(!imports.has(file))imports.set(file,'i'+imports.size);
        return [name,JSON.stringify(box).slice(0,-1)+', src:'+imports.get(file)+'}'];
      }))]));
      const modules=[...imports].map(([file,name])=>'import '+name+' from '+JSON.stringify(normalizePath(path.join(folder,file))+'?url')+';');
      const pairs=Object.entries(source).map(([sheet,rows])=>JSON.stringify(sheet)+':{'+Object.entries(rows).map(([name,expr])=>JSON.stringify(name)+':'+expr).join(',')+'}');
      return modules.join('\n')+'\nexport default {'+pairs.join(',')+'};';
    },
  }],
  server:{host:'127.0.0.1'},
  preview:{host:'127.0.0.1'},build:{outDir:'dist',emptyOutDir:true,target:'chrome120'},
});
