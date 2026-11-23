import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { foregroundPack } from '../src/graphics/foreground-pack.ts';
const [root,output] = process.argv.slice(2); if(!root||!output)throw new Error('Expected raw foreground source and new metadata output');
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8')),packs:object[]=[],errors:object[]=[];let layers=0,fragments=0;const drawTypes:Record<string,number>=Object.create(null);
for(const source of manifest.entries)if(source.state==='exported'&&/[.]txt$/iu.test(source.name)){
 try{if(!/^[0-9]+[.]bin$/u.test(source.file))throw new Error('Unsafe foreground source');const bytes=await readFile(path.join(root,source.file));const text=new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':'utf-8',{fatal:true}).decode(bytes);
 const name=source.name.replaceAll('\\','/').split('/').at(-1),pack=foregroundPack(name,text);layers+=pack.layout.layers.length;fragments+=pack.imageFragments.size;for(const layer of pack.layout.layers)drawTypes[layer.drawType]=(drawTypes[layer.drawType]??0)+1;packs.push({name,sourceFile:source.file,sourceSha256:createHash('sha256').update(bytes).digest('hex'),pageWidth:pack.pageWidth,pageHeight:pack.pageHeight,width:pack.layout.width,height:pack.layout.height,offsetX:pack.offsetX,offsetY:pack.offsetY,text});
 }catch(error){errors.push({name:source.name,error:error instanceof Error?error.message:String(error)});}}
await writeFile(output,JSON.stringify({schemaVersion:1,format:'prepared-foreground-packs-v1',layers,fragments,drawTypes,failed:errors.length,errors,packs},null,2),{flag:'wx'});console.log('Prepared foreground packs='+packs.length+'; layers='+layers+'; fragments='+fragments+'; failed='+errors.length);if(errors.length)process.exitCode=1;
