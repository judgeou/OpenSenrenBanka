import type {DownloadedRange,RangeIndex} from './edition-cache-types.ts';
const result=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const done=(t:IDBTransaction)=>new Promise<void>((resolve,reject)=>{t.oncomplete=()=>resolve();t.onabort=t.onerror=()=>reject(t.error??Error('Resource cache transaction aborted'));});
/** Separate stores from all gameplay settings, progress, and saves. Keys include the media release. */
export class RangeStore {
  private opening?:Promise<IDBDatabase>;
  constructor(private readonly name:string){}
  private open(){return this.opening??=(async()=>{
    const request=indexedDB.open(this.name,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('index');request.result.createObjectStore('blocks');request.result.createObjectStore('state');};
    const db=await result(request);db.onversionchange=()=>{db.close();this.opening=undefined;};return db;
  })().catch(error=>{this.opening=undefined;throw error;});}
  async index(key:string):Promise<RangeIndex|undefined>{const db=await this.open();return result(db.transaction('index').objectStore('index').get(key));}
  async get(key:string,start:number):Promise<Blob|undefined>{const db=await this.open();return result(db.transaction('blocks').objectStore('blocks').get([key,start]));}
  async put(key:string,range:DownloadedRange,bytes:Blob,valid:()=>boolean):Promise<void>{
    if(bytes.size!==range.end-range.start||!bytes.size||!valid())return;
    const db=await this.open();if(!valid())return;
    const t=db.transaction(['index','blocks'],'readwrite'),finished=done(t),index=t.objectStore('index'),blocks=t.objectStore('blocks');
    // Do the mutation within the read's event to keep the transaction alive.
    const req=index.get(key);
    req.onsuccess=()=>{
      if(!valid())return;
      const old=req.result as RangeIndex|undefined;
      if(old&&old.total!==range.total)return;
      const parts=old?.parts??[];
      if(parts.some(([a,b])=>a<=range.start&&b>=range.end))return;
      const kept:[number,number][]=[];
      for(const [a,b] of parts){if(a>=range.start&&b<=range.end)blocks.delete([key,a]);else kept.push([a,b]);}
      if(kept.length>=16384)return;
      kept.push([range.start,range.end]);kept.sort((a,b)=>a[0]-b[0]);
      blocks.put(bytes,[key,range.start]);index.put({total:range.total,parts:kept},key);
    };
    await finished;
  }
  async clear():Promise<void>{
    const db=await this.open(),t=db.transaction(['index','blocks'],'readwrite'),finished=done(t);
    for(const key of ['index','blocks'])t.objectStore(key).clear();await finished;
  }
  async useRelease(release:string):Promise<void>{
    const db=await this.open(),t=db.transaction(['index','blocks','state'],'readwrite'),finished=done(t),meta=t.objectStore('state'),req=meta.get('release');
    req.onsuccess=()=>{if(req.result===release)return;if(req.result!==undefined){t.objectStore('index').clear();t.objectStore('blocks').clear();}meta.put(release,'release');};
    await finished;
  }
}
