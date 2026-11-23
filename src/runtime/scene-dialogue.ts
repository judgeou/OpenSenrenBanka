import type {ScenarioDocument} from '../scenario/document.ts';
import type {RuntimeDialogue} from './types.ts';
import type {RuntimeLocation} from '../scenario/invocation.ts';
import {psbValue} from '../formats/psb-value.ts';
import type {PsbValue} from '../formats/psb-value.ts';
export function sceneDialogue(document:ScenarioDocument,asset:string,scene:number,eventIndex:number,location:(ref:number,event:number)=>RuntimeLocation):RuntimeDialogue {
    const event=document.index.scenes[scene].events[eventIndex];
    if (event.kind !== 'text') throw new Error('Expected dialogue event');
    const record = document.index.scenes[scene].texts[event.textIndex], at = (slot: number): PsbValue => record.slots[slot] === undefined ? null : psbValue(document.reader, record.slots[slot]);
    const body = at(2), flags = at(4); if (typeof body !== 'string' || typeof flags !== 'bigint') throw new Error('Invalid dialogue fields');
    return { key: asset + '/' + scene + '/' + event.externalId, speaker: at(0), displayName: at(1), body, voices: at(3), flags,
      lastInScene: event.textIndex + 1 === document.index.scenes[scene].texts.length, location: location(event.sourceRef,eventIndex) };
}
