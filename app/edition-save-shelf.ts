import {cardFrom,defaultSavePages,legacyNormal,maxSavePages,sameCard,slotsPerPage,SavePayloadDamaged} from './save-card.ts';
import type {LegacySlot,OpenedSlot,PreparedSave,SaveCard,SaveCell,SaveRef} from './save-card.ts';
import type {SystemProgressData} from './native-session-types.ts';

const stores=['records','save-cards','save-state'] as const;
interface ShelfState { pages:number; quick:readonly (SaveRef)[] | undefined }
interface LegacyPort {
  read(slot:LegacySlot):Promise<OpenedSlot|undefined>;
  write(run:()=>Promise<void>):Promise<void>;
  pack(ref:string,save:PreparedSave,progress:SystemProgressData):Promise<{data:unknown;system:unknown}>;
  open(ref:string,data:unknown):Promise<OpenedSlot|undefined>;
}
export function initEditionShelf(db:IDBDatabase){
  if(!db.objectStoreNames.contains('save-cards'))db.createObjectStore('save-cards').createIndex('newest',['identity','created']);
  if(!db.objectStoreNames.contains('save-state'))db.createObjectStore('save-state');
}
const normalKey=(page:number,index:number)=>'n/'+page+'/'+index;
const isQuickKey=(key:string)=>/^q\/[0-9a-f-]{36}$/u.test(key);
const ownedThumb=(value:unknown)=>value instanceof Blob&&value.type==='image/png'&&value.size>0&&value.size<=800000;

/** V1 rows remain untouched. This namespace publishes pointers and payloads together;
 * the ordinal of an entry changes, not its identity. */
export class EditionSaveShelf {
  constructor(private readonly db:IDBDatabase,readonly identity:string,private readonly port:LegacyPort){}
  private full(key:string){return this.identity+'/pc/'+key;}
  private query<T>(names:readonly string[],body:(tx:IDBTransaction,ready:(result:T)=>void)=>void):Promise<T>{
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction([...names],'readonly');let value:T;
      tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error??Error('读取存档目录失败'));tx.onerror=()=>{};
      try{body(tx,result=>{value=result;});}catch(error){tx.abort();reject(error);}
    });
  }
  private get(name:string,key:string){return this.query<unknown>([name],(tx,done)=>{const req=tx.objectStore(name).get(key);req.onsuccess=()=>done(req.result);});}
  private async state():Promise<ShelfState>{
    const row=await this.get('save-state',this.identity) as ShelfState|undefined;if(!row)return {pages:defaultSavePages,quick:undefined};
    if(!Number.isInteger(row.pages)||row.pages<defaultSavePages||row.pages>maxSavePages||row.quick!==undefined&&(!Array.isArray(row.quick)||row.quick.length>slotsPerPage||row.quick.some(x=>!x||typeof x.revision!=='string'||!(isQuickKey(x.key)||x.key==='legacy/quick'&&x.legacy==='quick'))||new Set(row.quick.map(x=>x.key)).size!==row.quick.length))throw Error('存档页索引损坏，保留原数据');
    return row;
  }
  private card(value:unknown,key:string):SaveCard|undefined{
    if(value===undefined)return;
    const r=value as SaveCard;
    if(!r||r.identity!==this.identity||r.key!==key||typeof r.revision!=='string'||typeof r.created!=='string'||!Number.isFinite(Date.parse(r.created))||typeof r.asset!=='string'||!/^\d{4}$/u.test(r.asset)||!Number.isSafeInteger(r.scene)||!Number.isSafeInteger(r.cursor)||typeof r.chapter!=='string'||typeof r.excerpt!=='string'||(r.wait!=='dialogue'&&r.wait!=='choice'))throw Error('存档索引损坏');
    return {...r,thumbnail:ownedThumb(r.thumbnail)?r.thumbnail:undefined};
  }
  private async legacy(slot:LegacySlot){
    const row=await this.port.read(slot);if(!row)return;
    return cardFrom(row,{key:'legacy/'+slot,legacy:slot,revision:row.identity+'@'+row.created});
  }
  private entry(key:string){
    return this.query<SaveCard|undefined>(['records','save-cards'],(tx,done)=>{
      const full=this.full(key),card=tx.objectStore('save-cards').get(full),exists=tx.objectStore('records').getKey(full);
      exists.onsuccess=()=>{
        const indexed=card.result!==undefined,stored=exists.result!==undefined;
        if(indexed!==stored){tx.abort();return;}
        if(!indexed){done(undefined);return;}
        try{done(this.card(card.result,key));}catch{tx.abort();}
      };
    });
  }
  private async atNormal(page:number,index:number):Promise<SaveCard|undefined>{
    const key=normalKey(page,index),card=await this.entry(key);
    return card??(page===1&&index<legacyNormal.length?await this.legacy(legacyNormal[index]):undefined);
  }
  private async storedQuick(state:ShelfState):Promise<readonly SaveRef[]>{
    if(state.quick)return state.quick;
    // Preserve a corrupt old row untouched, but do not copy it into the new rotation.
    const legacy=await this.legacy('quick').catch(()=>undefined);return legacy?[{key:legacy.key,revision:legacy.revision,legacy:legacy.legacy}]:[];
  }
  private async getQuick(ref:SaveRef):Promise<SaveCard>{
    const row=ref.legacy?await this.legacy(ref.legacy):await this.entry(ref.key);
    if(!row||!sameCard(row,ref))throw Error('快档已轮替或损坏');return row;
  }
  async latestQuick():Promise<SaveCard|undefined>{
    const state=await this.state();if(!state.quick)return this.legacy('quick');
    return state.quick[0]?this.getQuick(state.quick[0]):undefined;
  }
  async page(page:number):Promise<{page:number;pages:number;cells:SaveCell[];canReduce:boolean}>{
    const state=await this.state(), actual=Math.max(0,Math.min(page,state.pages-1));
    const read=async(index:number):Promise<SaveCell>=>{
      try{
        if(actual)return {index,card:await this.atNormal(actual,index)};
        if(!state.quick)return {index,card:index===0?await this.legacy('quick'):undefined};
        return {index,card:state.quick[index]?await this.getQuick(state.quick[index]):undefined};
      }catch{return {index,damaged:true};}
    };
    const cells=await Promise.all(Array.from({length:slotsPerPage},(_,i)=>read(i)));
    return {page:actual,pages:state.pages,cells,canReduce:state.pages>defaultSavePages&&actual===state.pages-1&&cells.every(cell=>!cell.card&&!cell.damaged)};
  }
  /** Only lightweight index entries, never deserializes new story snapshots at startup. */
  async latest():Promise<SaveCard|undefined>{
    const fresh=await this.query<SaveCard|undefined>(['save-cards'],(tx,done)=>{
      const request=tx.objectStore('save-cards').index('newest').openCursor(IDBKeyRange.bound([this.identity,''],[this.identity,'\uffff']),'prev');
      request.onsuccess=()=>{
        const c=request.result;if(!c){done(undefined);return;}
        try{const key=String(c.primaryKey).slice(this.full('').length);const row=this.card(c.value,key);if(row){done(row);return;}}catch{}
        c.continue();
      };
    });
    const legacy=(await Promise.all([...legacyNormal,'quick' as const].map(async(s,i)=>{
      try{
        if(s==='quick')return await this.visibleLegacyQuick();
        return await this.get('save-cards',this.full(normalKey(1,i)))===undefined?await this.legacy(s):undefined;
      }catch{return undefined;}
    }))).filter((x):x is SaveCard=>!!x);
    if(fresh)legacy.push(fresh);
    return legacy.sort((a,b)=>b.created.localeCompare(a.created))[0];
  }
  private async visibleLegacyQuick(){
    const {quick}=await this.state();return quick===undefined||quick.some(ref=>ref.legacy==='quick')?await this.legacy('quick'):undefined;
  }
  async openLatest():Promise<OpenedSlot|undefined>{
    const first=await this.latest();if(!first)return;
    try{return await this.open(first);}catch{}
    const cards=await this.query<SaveCard[]>(['save-cards'],(tx,done)=>{
      const r=tx.objectStore('save-cards').index('newest').openCursor(IDBKeyRange.bound([this.identity,''],[this.identity,'\uffff']),'prev'),items:SaveCard[]=[];
      r.onsuccess=()=>{const c=r.result;if(!c){done(items);return;}const key=String(c.primaryKey).slice(this.full('').length);
        try{const card=this.card(c.value,key);if(card&&!sameCard(card,first))items.push({...card,thumbnail:undefined});}catch{}
        c.continue();};
    });
    const legacy=await this.page(1);
    for(const c of legacy.cells)if(c.card?.legacy&&!sameCard(c.card,first))cards.push(c.card);
    const quick=await this.visibleLegacyQuick().catch(()=>undefined);if(quick&&!sameCard(quick,first))cards.push(quick);
    for(const card of cards.sort((a,b)=>b.created.localeCompare(a.created))){try{const opened=await this.open(card);if(opened)return opened;}catch{}}
    throw Error('可用存档已损坏或不兼容，保留原数据');
  }
  async open(ref:SaveRef):Promise<OpenedSlot|undefined>{
    if(ref.legacy){
      const row=await this.port.read(ref.legacy),fresh=row&&cardFrom(row,{key:'legacy/'+ref.legacy,legacy:ref.legacy,revision:row.identity+'@'+row.created});
      if(!fresh||!sameCard(fresh,ref))throw Error('旧槽在确认期间改变');return row;
    }
    if(!/^(?:n\/[1-9][0-9]{0,3}\/(?:[0-9]|1[01])|q\/[0-9a-f-]{36})$/u.test(ref.key))throw Error('非法存档位置');
    const joined=await this.query<{card:unknown;data:unknown}>(['records','save-cards'],(tx,done)=>{
      const key=this.full(ref.key),idx=tx.objectStore('save-cards').get(key),snap=tx.objectStore('records').get(key);
      snap.onsuccess=()=>done({card:idx.result,data:snap.result});
    });
    const card=this.card(joined.card,ref.key);
    if(!card||!sameCard(card,ref))throw Error('该槽在确认期间改变或已退休');
    try{
      const opened=await this.port.open(ref.key,joined.data);
      if(!opened||opened.created!==card.created)throw Error('存档缺失');
      return opened;
    }catch(error){throw new SavePayloadDamaged('存档正文损坏，已保留原槽',{cause:error});}
  }
  private commit(body:(tx:IDBTransaction)=>void):Promise<void>{
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction([...stores],'readwrite',{durability:'strict'});
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('保存事务失败，旧槽未变'));tx.onerror=()=>{};
      try{body(tx);}catch(error){tx.abort();reject(error);}
    });
  }
  write(save:PreparedSave,progress:SystemProgressData,target:'quick'|{page:number;index:number;expected?:SaveRef}):Promise<void>{
    if(!ownedThumb(save.thumbnail)||!Number.isFinite(Date.parse(save.captured)))return Promise.reject(Error('存档预览无效'));
    return this.port.write(async()=>{
      const state=await this.state(),revision=crypto.randomUUID();let key:string, retired:SaveRef|undefined;
      if(target==='quick'){
        key='q/'+revision;const ordered=[{key,revision},...await this.storedQuick(state)];retired=ordered[slotsPerPage];state.quick=ordered.slice(0,slotsPerPage);
      }else{
        const {page,index,expected}=target;if(!Number.isInteger(page)||page<1||page>=state.pages||!Number.isInteger(index)||index<0||index>=slotsPerPage)throw Error('非法普通存档位置');
        const before=await this.atNormal(page,index);
        if(expected?!before||!sameCard(before,expected):!!before)throw Error('确认期间存档已改变，请重新选槽');
        key=normalKey(page,index);
      }
      const card=cardFrom({snapshot:save.snapshot,created:save.captured,identity:this.identity},{key,revision},save.thumbnail);
      const packed=await this.port.pack(key,save,progress);
      await this.commit(tx=>{
        const records=tx.objectStore('records'),cards=tx.objectStore('save-cards');
        records.put(packed.data,this.full(key));cards.put(card,this.full(key));records.put(packed.system,this.identity+'/system');
        tx.objectStore('save-state').put(state,this.identity);
        if(retired&&!retired.legacy){const k=this.full(retired.key);records.delete(k);cards.delete(k);}
      });
    });
  }
  resize(add:1|-1):Promise<void>{
    return this.port.write(async()=>{
      const state=await this.state(),next=state.pages+add;if(next<defaultSavePages||next>maxSavePages)throw Error('已达原页数范围');
      if(add<0){const tail=await this.page(state.pages-1);if(!tail.canReduce)throw Error('最后一页非空，不能减页');}
      await this.commit(tx=>tx.objectStore('save-state').put({...state,pages:next},this.identity));
    });
  }
}
