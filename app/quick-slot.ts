import {EditionSaveShelf} from './edition-save-shelf.ts';
import {openSaveDatabases} from './save-databases.ts';
import {savePredecessors} from './save-resource-compatibility.ts';
import { assertSpatialWorld } from './spatial-profile.ts';
import { encodePlayerSnapshot, decodePlayerSnapshot, encodePersistentData, decodePersistentData } from '../src/runtime/save-codec.ts';
import type { PlayerSnapshot } from '../src/runtime/types.ts';
import type { ScriptValue } from '../src/script/types.ts';
import type { SystemProgressData } from './native-session.ts';
export type SaveSlot='quick'|'slot-1'|'slot-2'|'slot-3'|'slot-4'|'slot-5'|'slot-6';
export const normalSlots=['slot-1','slot-2','slot-3','slot-4','slot-5','slot-6'] as const;
export interface SlotSummary {readonly created:string;readonly position:string;readonly excerpt:string}
interface Stored { readonly format: 'senren-r62-store-v1'; readonly identity: string; readonly kind: string; readonly created: string; readonly sha256: string; readonly data: string }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('损坏的持久数据对象'); return Object.fromEntries(Object.entries(value)); }
function script(value: unknown, depth = 0): ScriptValue {
  if (depth > 128) throw new Error('系统进度嵌套超限');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (Array.isArray(value)) return value.map(item => script(item, depth + 1));
  const record = object(value), result: Record<string, ScriptValue> = Object.create(null);
  if (Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('系统进度含非脚本对象');
  for (const [key, item] of Object.entries(record)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('非法系统旗标名'); result[key] = script(item, depth + 1); } return result;
}
function system(value: unknown): SystemProgressData {
  const row = object(value), sf = script(row.sf);
  if (!sf || typeof sf !== 'object' || Array.isArray(sf) || !Array.isArray(row.read) || row.read.length > 1000000) throw new Error('损坏的系统／已读进度');
  const read = row.read.map(value => { if (typeof value !== 'string' || value.length > 4096 || !/^[^/]+\/[0-9]+\/[0-9]+$/u.test(value)) throw new Error('非法已读正文标识'); return value; });
  if (new Set(read).size !== read.length) throw new Error('重复的已读正文标识'); return { sf, read };
}
async function digest(data: string): Promise<string> { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function checked(value: unknown, identity: string, kind: Stored['kind']): Promise<Stored | undefined> {
  if (value === undefined) return undefined; const row = object(value);
  if (row.format !== 'senren-r62-store-v1' || row.identity !== identity || row.kind !== kind || typeof row.created !== 'string' || !Number.isFinite(Date.parse(row.created)) || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(row.sha256) || typeof row.data !== 'string') throw new Error('快速槽／系统进度版本或资源身份不匹配');
  if (new TextEncoder().encode(row.data).length > 67108864 || await digest(row.data) !== row.sha256) throw new Error('快速槽／系统进度摘要失败，保留原槽未修改');
  return { format: 'senren-r62-store-v1', identity, kind, created: row.created, sha256: row.sha256, data: row.data };
}
/** One atomic quick slot per resource identity. Rendering attachments are immutable and committed first by the renderer;
 * this metadata transaction is the only operation that replaces the previous slot. Never prune referenced attachments. */
export class QuickSlotStore {
  private closed = false; private writes: Promise<void> = Promise.resolve();
  readonly shelf?:EditionSaveShelf;
  private constructor(private readonly database: IDBDatabase, readonly identity: string,private readonly namespace:string,private readonly predecessors:readonly string[],private readonly legacyDatabase:IDBDatabase|undefined,edition=false) {
    if(edition)this.shelf=new EditionSaveShelf(database,identity,{
      read:async slot=>this.openSnapshot(await this.compatible(slot)),write:operation=>this.write(operation),
      pack:async (key,save,progress)=>{
        const source=this.encode(save.snapshot),merged=await this.merged(progress);
        return {data:{...await this.packed(key,source),created:save.captured},system:await this.packed('system',encodePersistentData(merged))};
      },
      open:async(key,row)=>this.openSnapshot(await checked(row,identity,key)),
    });
  }
  static async open(identity: string, edition?:'yoshino-v1',predecessor?:string): Promise<QuickSlotStore> {
    if (!/^[0-9a-f]{64}$/u.test(identity)||predecessor!==undefined&&(edition!=='yoshino-v1'||predecessor===identity||!(/^[0-9a-f]{64}$/u.test(predecessor)))) throw new Error('非法资源包身份');
    if (!navigator.locks) throw new Error('此浏览器缺少原子存储锁，请使用桌面 Chrome/Edge 本地 HTTP 入口');
    const namespace=edition?'senren-yoshino-v1':'senren-r62-batch';
    const {primary,legacy}=await openSaveDatabases(namespace,!!edition);
    return new QuickSlotStore(primary,identity,namespace,savePredecessors(identity,predecessor),legacy,!!edition);
  }
  private key(kind: Stored['kind']): string { return this.identity + '/' + kind; }
  private raw(kind: Stored['kind'],identity:string,database:IDBDatabase): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('快速槽数据库已关闭'));
    return new Promise((resolve, reject) => { const transaction = database.transaction('records', 'readonly'), request = transaction.objectStore('records').get(identity+'/'+kind); let value: unknown;
      request.onsuccess = () => { value = request.result; }; transaction.oncomplete = () => resolve(value); transaction.onabort = () => reject(transaction.error ?? new Error('读取快速槽被取消')); transaction.onerror = () => {}; });
  }
  private commit(rows: readonly Stored[]): Promise<void> {
    return new Promise((resolve, reject) => { const transaction = this.database.transaction('records', 'readwrite', { durability: 'strict' });
      try { const store = transaction.objectStore('records'); for (const row of rows) store.put(row, this.key(row.kind)); } catch (error) { transaction.abort(); reject(error); return; }
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error('快速槽更新失败，旧槽已保留')); transaction.onerror = () => {}; });
  }
  private async packed(kind: Stored['kind'], data: string): Promise<Stored> { return { format: 'senren-r62-store-v1', identity: this.identity, kind, created: new Date().toISOString(), sha256: await digest(data), data }; }
  private write(operation: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new Error('快速槽数据库已关闭'));
    const next = this.writes.then(async () => { await navigator.locks.request(this.namespace+'-store-' + this.identity, { mode: 'exclusive' }, async () => { await operation(); }); }); this.writes = next.catch(() => {}); return next;
  }
  private async compatible(kind:Stored['kind']):Promise<Stored|undefined>{
    const current=await checked(await this.raw(kind,this.identity,this.database),this.identity,kind);
    if(current)return current;
    const source=this.legacyDatabase??this.database;
    for(const id of this.legacyDatabase?[this.identity,...this.predecessors]:this.predecessors){
      const row=await checked(await this.raw(kind,id,source),id,kind);if(row)return row;
    }
  }
  async loadSystem(): Promise<SystemProgressData | undefined> { const row = await this.compatible('system'); return row ? system(decodePersistentData(row.data)) : undefined; }
  loadQuick(){return this.loadSlot('quick');}
  async loadSlot(slot:SaveSlot): Promise<{ readonly snapshot: PlayerSnapshot; readonly created: string; readonly identity:string } | undefined> {
    await this.writes;return this.openSnapshot(await this.compatible(slot));
  }
  private openSnapshot(row:Stored|undefined){
    if(!row)return;
    const snapshot=decodePlayerSnapshot(row.data); assertSpatialWorld(snapshot.world, row.identity);
    if (snapshot.clock.paused || !['dialogue', 'choice'].includes(snapshot.wait.kind)) throw new Error('快速槽不在支持的稳定正文／选择边界');
    return { snapshot, created: row.created, identity:row.identity };
  }
  private async merged(current: SystemProgressData): Promise<SystemProgressData> {
    const valid = system(current), before = await this.loadSystem(); return { sf: { ...(before?.sf ?? {}), ...valid.sf }, read: [...new Set([...(before?.read ?? []), ...valid.read])] };
  }
  saveSystem(progress: SystemProgressData): Promise<void> { return this.write(async () => { const merged = await this.merged(progress); await this.commit([await this.packed('system', encodePersistentData(merged))]); }); }
  saveQuick(snapshot:PlayerSnapshot,progress:SystemProgressData){return this.saveSlot('quick',snapshot,progress);}
  saveSlot(slot:SaveSlot,snapshot: PlayerSnapshot, progress: SystemProgressData): Promise<void> {
    // Encode and validate before creating a write transaction, and do not delete/clear the old slot on any error.
    const source=this.encode(snapshot);
    return this.write(async () => { const merged = await this.merged(progress); await this.commit([await this.packed(slot, source), await this.packed('system', encodePersistentData(merged))]); });
  }
  private encode(snapshot:PlayerSnapshot){assertSpatialWorld(snapshot.world,this.identity);const source=encodePlayerSnapshot(snapshot);decodePlayerSnapshot(source);return source;}
  async flush(): Promise<void> { await this.writes; }
  async close(): Promise<void> { if (this.closed) return; await this.flush(); this.closed = true; this.database.close();this.legacyDatabase?.close(); }
}
