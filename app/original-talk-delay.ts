import type {RuntimeCommand} from '../src/scenario/invocation.ts';
import {worldPlan} from '../src/world/plan.ts';
/** Original numeric talk queue: same player clock, skip and publication as the label-bound queue.
 * Support the reviewed original millisecond values and update families; not scene/event whitelists. */
export function originalTalkDelay(command:RuntimeCommand):number|undefined{
  const delay=command.deferred;
  if(delay?.kind!=='integer')return;
  const p=command.parameters, update=p.update;
  if(command.name!=='envupdate'||!([50n,100n,200n,300n,500n].includes(delay.value))||!Array.isArray(update)||!update.length||
     Object.keys(p).some(k=>!['update','revupdate','trans'].includes(k)))throw Error('Unbound original numeric talk delay');
  const {updates,reverse}=worldPlan(p);
  const creates=updates.filter(row=>row.kind==='create');
  if(creates.length&&(creates.length!==1||updates[0]!==creates[0]||creates[0].name!=='se'||creates[0].classSpec!=='se'||reverse.length!==1||reverse[0].kind!=='delete'||reverse[0].name!=='se'))throw Error('Unsupported timed world owner lifecycle');
  const rows=updates.filter(row=>row.kind==='update');
  if(!rows.length||creates.length+rows.length!==updates.length||!rows.every(row=>{
    const p=row.parameters;
    // Timed SE stop uses the existing audio entity fade, not a new replay.
    const stop=typeof p.stop==='bigint'&&p.stop>=0n&&p.stop<=9999n||typeof p.stop==='string'&&/^[0-9]{1,4}$/u.test(p.stop);
    return row.name==='se'&&(p.replay!==undefined||Object.keys(p).length===2&&stop)||
      p.showmode!==undefined&&(p.redraw!==undefined||p.hideact!==undefined);
  }))throw Error('Unsupported original timed talk owner');
  return Number(delay.value);
}
