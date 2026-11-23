import {initEditionShelf} from './edition-save-shelf.ts';

function open(name:string,version:number|undefined,shelf:boolean):Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    let refused=false;const request=version===undefined?indexedDB.open(name):indexedDB.open(name,version);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records');
      if(shelf)initEditionShelf(request.result);
    };
    request.onerror=()=>reject(request.error??Error('无法打开存档数据库'));
    request.onblocked=()=>{refused=true;reject(Error('请关闭同站的其它游戏页后再打开存档'));};
    request.onsuccess=()=>{
      const db=request.result;if(refused){db.close();return;}
      db.onversionchange=()=>db.close();resolve(db);
    };
  });
}

/** Do not upgrade the original v1 database: the previous Pages release must
 * still be able to open it with explicit version 1 after a rollback. Preserve
 * sites already using the historic v2 shelf in place. */
export async function openSaveDatabases(namespace:string,edition:boolean){
  const old=await open(namespace+'-quicksave-v1',edition?undefined:1,false);
  if(!edition)return {primary:old,legacy:undefined};
  if(old.version===2&&old.objectStoreNames.contains('save-cards')&&old.objectStoreNames.contains('save-state'))return {primary:old,legacy:undefined};
  if(old.version!==1){old.close();throw Error('不支持的原存档数据库版本，未改动原档');}
  try{return {primary:await open(namespace+'-pc-saves-v2',1,true),legacy:old};}
  catch(error){old.close();throw error;}
}
