import {psbRecord} from '../src/formats/psb-value.ts';
import type {PlayerSnapshot} from '../src/runtime/types.ts';
export type LegacySlot='quick'|'slot-1'|'slot-2'|'slot-3'|'slot-4'|'slot-5'|'slot-6';
export interface OpenedSlot {readonly snapshot:PlayerSnapshot;readonly identity:string;readonly created:string}
export interface SaveRef {readonly key:string;readonly revision:string;readonly legacy?:LegacySlot}
export interface SaveCard extends SaveRef {
  readonly identity:string;readonly created:string;readonly asset:string;readonly scene:number;readonly cursor:number;
  readonly chapter:string;readonly excerpt:string;readonly wait:'choice'|'dialogue';readonly thumbnail?:Blob;
}
export interface SaveCell {readonly index:number;readonly card?:SaveCard;readonly damaged?:boolean}
export class SavePayloadDamaged extends Error {}
export interface PreparedSave {readonly snapshot:PlayerSnapshot;readonly thumbnail:Blob;readonly captured:string}
export const slotsPerPage=12,defaultSavePages=11,maxSavePages=10000;
export const legacyNormal=['slot-1','slot-2','slot-3','slot-4','slot-5','slot-6'] as const;
export function cardFrom(opened:OpenedSlot,ref:SaveRef,thumbnail?:Blob):SaveCard {
  const {snapshot,identity,created}=opened,{position:p,wait,history}=snapshot;
  if(wait.kind!=='dialogue'&&wait.kind!=='choice')throw Error('只允许稳定正文或选择存档');
  const ui=psbRecord(psbRecord(snapshot.world).ui), raw=ui.chapter===null||ui.chapter===undefined?'':psbRecord(ui.chapter).date;
  const chapter=typeof raw==='string'&&/^(?:[0-9]+-[0-9]+|after|prologue)$/u.test(raw)?raw:'';
  const body=history.findLast(h=>h.key===p.currentText&&h.kind==='dialogue')??history.findLast(h=>h.kind==='dialogue');
  const excerpt=(wait.kind==='choice'?'选择 · ':'')+(body?.body??'');
  return {...ref,identity,created,asset:p.asset,scene:p.scene,cursor:p.cursor,chapter,wait:wait.kind,excerpt:excerpt.replace(/\s+/gu,' ').slice(0,320),thumbnail};
}
export const sameCard=(a:SaveRef,b:SaveRef)=>a.key===b.key&&a.revision===b.revision&&a.legacy===b.legacy;
