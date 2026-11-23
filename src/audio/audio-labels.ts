import { crossedAudioLabels } from './audio-timeline.ts';
import type { AudioLabel, AudioTimeline } from './audio-timeline.ts';
export interface AudioLoop { readonly start: number; readonly end: number }
/** Absolute transport position of the next observable label (including loop edges). */
export function nextAudioLabel(timeline: AudioTimeline, loop: AudioLoop | undefined, cursor: number, include: boolean): number {
  const labels=timeline.labels;
  const first=(from:number,to:number,atStart:boolean)=>labels.find(l=>(atStart?l.time>=from:l.time>from)&&l.time<=to)?.time;
  if(!loop)return first(cursor,Infinity,include)??Infinity;
  if(cursor<loop.end){
    const head=first(cursor,loop.end,include);if(head!==undefined)return head;
    const tail=first(loop.start,loop.end,true);return tail===undefined?Infinity:loop.end+tail-loop.start;
  }
  const length=loop.end-loop.start, start=loop.end+Math.floor((cursor-loop.end)/length)*length, phase=loop.start+(cursor-start);
  const here=first(phase,loop.end,include);
  if(here!==undefined)return Math.max(cursor,start+here-loop.start);
  const tail=first(loop.start,loop.end,true);return tail===undefined?Infinity:start+length+tail-loop.start;
}
/** Traverse unwrapped transport time using a monotonically advancing INTEGER cycle.
 * Recomputing floor((cursor-end)/length) at every boundary can round down and revisit the same segment forever. */
export function audioLabelsBetween(timeline: AudioTimeline, loop: AudioLoop | undefined, from: number, to: number, include = false): readonly AudioLabel[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) throw new Error('Invalid audio label cursor');
  if (!loop) return crossedAudioLabels(timeline, from, to, include);
  const length = loop.end - loop.start; if (!Number.isFinite(length) || length <= 0 || loop.start < 0) throw new Error('Invalid loop label range');
  const result: AudioLabel[] = []; let cursor = from, cycle = cursor < loop.end ? 0 : Math.floor((cursor - loop.end) / length) + 1, budget = 10000;
  const append = (labels: readonly AudioLabel[]) => { if (result.length + labels.length > 100000) throw new Error('Audio label result budget exceeded'); result.push(...labels); };
  while (cursor < to || include) {
    if (--budget < 0) throw new Error('Audio label loop budget exceeded');
    const until = cycle === 0 ? loop.end : loop.end + cycle * length;
    // A division rounded down at an EXACT previously emitted boundary. Advance its integer cycle, never spin.
    if (until <= cursor) { cycle++; continue; }
    const position = cycle === 0 ? cursor : Math.min(loop.end, Math.max(loop.start, loop.start + cursor - (loop.end + (cycle - 1) * length))), next = Math.min(to, until);
    append(crossedAudioLabels(timeline, position, next === until ? loop.end : Math.min(loop.end, position + next - cursor), include));
    if (next >= to) { if (next === until) append(crossedAudioLabels(timeline, loop.start, loop.start, true)); break; }
    cursor = until; cycle++; include = true;
  }
  return result;
}
