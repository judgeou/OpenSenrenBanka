import {cp,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';

export const nativeFontDirectory='native-font-r28-zh';
export function isFontPayload(file){
  return file===nativeFontDirectory||file.startsWith(nativeFontDirectory+'/')||/\.(?:ttf|ttc|otf|otc|woff2?)$/iu.test(file);
}

/** Keep the sealed source tree and logical save identity intact. Only the output inventory changes. */
export async function copyYoshinoPublicAssets(publicDir,outDir){
  const source=await realpath(publicDir),inventoryFile='resources/inventory.json';
  const inventory=JSON.parse(await readFile(path.join(source,inventoryFile),'utf8'));
  if(!Array.isArray(inventory.assets)||inventory.assets.some(row=>typeof row?.file!=='string'||!Number.isSafeInteger(row.bytes)||row.bytes<0))throw Error('Invalid public resource inventory');
  const assets=inventory.assets.filter(row=>!isFontPayload(row.file));
  await cp(source,outDir,{recursive:true,force:false,errorOnExist:true,filter(from){
    const relative=path.relative(source,from).split(path.sep).join('/');
    const payload=relative.startsWith('resources/')?relative.slice('resources/'.length):relative;
    return relative!==inventoryFile&&!isFontPayload(payload);
  }});
  const released={...inventory,fontMode:'system',assets,files:assets.length,bytes:assets.reduce((total,row)=>total+row.bytes,0)};
  await writeFile(path.join(outDir,inventoryFile),JSON.stringify(released),{flag:'wx'});
}
