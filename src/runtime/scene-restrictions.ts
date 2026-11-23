import type { ScenarioDocument } from '../scenario/document.ts';
import type { Choice } from '../scenario/flow.ts';
import type { ScriptState } from '../script/state.ts';
import type { PlayerSnapshot } from './types.ts';
import type { PlaybackWait } from './playback-gate.ts';

/** Optional edition contract. The original player is unrestricted by default. */
export interface SceneRestrictions {
  destination(asset: string, scene: number): void;
  picks(asset: string, scene: number, script: ScriptState): readonly number[];
}
export function restrictChoices(choices: Choice[], indices: readonly number[] | undefined): Choice[] {
  if (!indices) return choices;
  const rows=choices.filter(c=>indices.includes(c.index));
  if(rows.length!==indices.length||rows.some((c,i)=>c.index!==indices[i]))throw Error('专版选择与原选项不一致');
  return rows;
}
export function checkSavedPosition(document:ScenarioDocument,saved:PlayerSnapshot):void {
  const position=saved.position;
    if (!Number.isInteger(position.scene) || position.scene < 0 || position.scene >= document.index.scenes.length || !Number.isInteger(position.cursor) || position.cursor < 0 || position.cursor > document.index.scenes[position.scene].events.length) throw new Error('Saved scene position is outside source');
}
export function checkSavedControl(saved:PlayerSnapshot,edgeCount:number):void {
  const position=saved.position;
    if (typeof position.entered !== 'boolean' || typeof position.leaving !== 'boolean' || typeof position.ended !== 'boolean' ||
        !Number.isInteger(position.nextIndex) || position.nextIndex < 0 || position.nextIndex > edgeCount ||
        !Array.isArray(saved.read) || saved.read.some(key => typeof key !== 'string') || !Array.isArray(saved.history) || saved.history.length > 4000) throw new Error('Invalid saved player control state');
}
export function checkEditionWait(policy:SceneRestrictions,asset:string,scene:number,script:ScriptState,wait:PlaybackWait):void {
  const picks=policy.picks(asset,scene,script);
  if(wait.kind==='choice'?picks.length===0||picks.join()!==wait.indices.join():picks.length!==0||wait.kind!=='dialogue')throw Error('专版存档选择边界无效');
}
