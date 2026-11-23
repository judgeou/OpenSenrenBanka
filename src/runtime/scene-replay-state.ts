import {clonePsbValue,psbValue} from '../formats/psb-value.ts';
import {checkpointAtOrAfter,resolveStateReference} from '../scenario/semantics.ts';
import type {ScenarioDocument} from '../scenario/document.ts';
import type {HistoryEntry,PlayerSnapshot} from './types.ts';
export const copyHistory=(records:readonly HistoryEntry[])=>records.map(e=>({...e,location:{...e.location},speaker:clonePsbValue(e.speaker),displayName:clonePsbValue(e.displayName),voices:clonePsbValue(e.voices)}));
export function checkHistoryTarget(doc:ScenarioDocument,s:PlayerSnapshot,key:string,actual:()=>string,picks:number|undefined){
  const p=s.position;
  if(!p.entered||p.ended||p.leaving||s.wait.kind!=='none'||s.hostWaits.length||doc.index.scenes[p.scene].events[p.cursor]?.kind!=='text'||actual()!==key||picks)throw Error('History replay does not identify its exact original text boundary');
}
export function sourceCheckpoint(doc:ScenarioDocument,scene:number,point:bigint,choosing:boolean){
  const record=checkpointAtOrAfter(doc,scene,point);if(!record)throw Error('Checkpoint was not found');
  const ref=resolveStateReference(doc,scene,record.stateSlot);
  return {cursor:choosing?0:doc.index.scenes[scene].events.indexOf(record)+1,point:record.recordId,state:record.stateSlot,world:ref===undefined?undefined:clonePsbValue(psbValue(doc.reader,ref))};
}
import type {PlaybackGate} from './playback-gate.ts';
export function checkReadWait(gate:PlaybackGate,read:ReadonlySet<string>){const w=gate.wait;if(w.kind==='dialogue'&&read.has(w.key)){w.wasRead=true;gate.set(w);}}
