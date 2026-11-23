import type { Psb2Reader } from '../formats/psb2/reader.ts';
import type { PsbNode, PsbProperty } from '../formats/psb2/types.ts';
export interface MtnFrame { readonly sourceRef: number; readonly time: number; readonly type: 0 | 2 | 3; readonly contentRef: number | undefined }
export interface MtnTrack { readonly id: number; readonly parent: number | undefined; readonly label: string; readonly sourceRef: number; readonly fields: readonly PsbProperty[]; readonly frames: readonly MtnFrame[]; readonly children: readonly number[] }
export interface MtnProgram { readonly objectName: string; readonly motionName: string; readonly sourceRef: number; readonly lastTime: number; readonly loopTime: PsbNode | undefined; readonly fields: readonly PsbProperty[]; readonly tracks: readonly MtnTrack[]; readonly roots: readonly number[] }
function required(reader: Psb2Reader, ref: number, name: string): number { const value = reader.property(ref, name); if (value === undefined) throw new Error('Missing MTN ' + name); return value; }
function numeric(reader: Psb2Reader, ref: number): number {
  const value = reader.node(ref); const number = value.kind === 'integer' ? Number(value.value) : value.kind === 'real' ? value.value : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid MTN timeline number'); return number;
}
export function mtnProgram(reader: Psb2Reader, objectName: string, motionName: string): MtnProgram {
  const objects = required(reader, reader.header.root, 'object'), object = required(reader, objects, objectName);
  const motions = required(reader, object, 'motion'), ref = required(reader, motions, motionName), motion = reader.node(ref);
  if (motion.kind !== 'object') throw new Error('MTN motion is not a dictionary');
  const lastTime = numeric(reader, required(reader, ref, 'lastTime')); if (lastTime < 0) throw new Error('Negative MTN duration');
  const tracks: MtnTrack[] = [];
  function track(at: number, parent: number | undefined, depth: number): number {
    if (depth > 128 || tracks.length > 100000) throw new Error('MTN hierarchy budget exceeded');
    const source = reader.node(at); if (source.kind !== 'object') throw new Error('MTN layer is not a dictionary');
    const id = tracks.length, label = reader.node(required(reader, at, 'label'));
    if (label.kind !== 'string') throw new Error('Invalid MTN layer label');
    const list = reader.node(required(reader, at, 'frameList')); if (list.kind !== 'array') throw new Error('MTN frame list is not an array');
    const frames: MtnFrame[] = [];
    for (const frameRef of list.items) {
      const type = numeric(reader, required(reader, frameRef, 'type')), time = numeric(reader, required(reader, frameRef, 'time'));
      if (type !== 0 && type !== 2 && type !== 3) throw new Error('Unknown MTN frame type: ' + type);
      if (time < 0 || frames.length && frames[frames.length - 1].time > time) throw new Error('Unordered MTN frame times');
      const contentRef = reader.property(frameRef, 'content');
      if (type !== 0 && (contentRef === undefined || reader.node(contentRef).kind !== 'object')) throw new Error('MTN active frame content is absent');
      frames.push({ sourceRef: frameRef, time, type, contentRef });
    }
    const children: number[] = []; tracks.push({ id, parent, label: label.value, sourceRef: at, fields: source.entries, frames, children });
    const descendants = reader.node(required(reader, at, 'children')); if (descendants.kind !== 'array') throw new Error('MTN children is not an array');
    for (const child of descendants.items) children.push(track(child, id, depth + 1)); return id;
  }
  const layer = reader.node(required(reader, ref, 'layer')); if (layer.kind !== 'array') throw new Error('MTN root layers is not an array');
  const roots = layer.items.map(item => track(item, undefined, 0)), loopRef = reader.property(ref, 'loopTime');
  return { objectName, motionName, sourceRef: ref, lastTime, loopTime: loopRef === undefined ? undefined : reader.node(loopRef), fields: motion.entries, tracks, roots };
}
export interface FrameSpan { readonly previous: MtnFrame | undefined; readonly next: MtnFrame | undefined; readonly ratio: number; readonly exact: boolean }
/** Temporal lookup only: mask, acceleration, control points and frame type remain explicit. */
export function frameSpan(frames: readonly MtnFrame[], time: number): FrameSpan {
  if (!Number.isFinite(time)) throw new Error('Invalid MTN sample time');
  let low = 0, high = frames.length; while (low < high) { const middle = (low + high) >>> 1; if (frames[middle].time <= time) low = middle + 1; else high = middle; }
  const previous = frames[low - 1], next = frames[low];
  const ratio = previous && next && next.time > previous.time ? Math.min(1, Math.max(0, (time - previous.time) / (next.time - previous.time))) : 0;
  return { previous, next, ratio, exact: previous?.time === time };
}
