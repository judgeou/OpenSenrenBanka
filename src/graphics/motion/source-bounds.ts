import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { LeafProgram } from './leaf-program.ts';
import { leafStates, identity } from './leaf-sampler.ts';
import type { Transform } from './leaf-sampler.ts';
export interface BoundItem { readonly owner: number; readonly id: number; readonly rect: readonly [number, number, number, number] }
export interface SourceBounds { readonly items: readonly BoundItem[]; readonly rect: readonly [number, number, number, number] | null }
export interface BoundsClip { readonly owner: number; readonly program: LeafProgram; readonly frame: number; readonly root: Transform }
/** Called only at the real source post-update boundary. No texture/GPU work,
 * callbacks or counter mutation. Transparent active rasters still have bounds.
 * Native finite helpers use x87 RC=down/up (0x173F/0x1B3F) around FRNDINT.
 */
export function sourceBounds(raster: LeafProgram, frame: number, children: readonly BoundsClip[]): SourceBounds {
  const items: BoundItem[] = [];
  const collect = (program: LeafProgram, at: number, root: Transform, owner: number) => {
    const { states, active } = leafStates(program, at, root);
    for (const [id, slot] of active) {
      const state = states.get(id)!, ox = slot.ox + slot.texture.originX, oy = slot.oy + slot.texture.originY;
      const xs: number[] = [], ys: number[] = [];
      for (const [x, y] of [[-ox, -oy], [slot.texture.width - ox, -oy], [-ox, slot.texture.height - oy], [slot.texture.width - ox, slot.texture.height - oy]]) {
        xs.push(state.x + state.a * x + state.c * y); ys.push(state.y + state.b * x + state.d * y);
      }
      const rect = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))] as const;
      if (!rect.every(Number.isSafeInteger)) throw new Error('MTN post-update bounds exceed finite range');
      items.push({ owner, id, rect });
    }
  };
  collect(raster, frame, identity, -1);
  for (const child of children) collect(child.program, child.frame, child.root, child.owner);
  return { items, rect: union(items) };
}
function union(items: readonly BoundItem[]): SourceBounds['rect'] {
  if (!items.length) return null;
  return [Math.min(...items.map(item => item.rect[0])), Math.min(...items.map(item => item.rect[1])), Math.max(...items.map(item => item.rect[2])), Math.max(...items.map(item => item.rect[3]))];
}
export function boundsValue(value: SourceBounds): PsbValue { return { items: value.items.map(item => ({ owner: item.owner, id: item.id, rect: [...item.rect] })), rect: value.rect ? [...value.rect] : null }; }
function activeIds(program: LeafProgram, frame: number): number[] {
  const ids: number[] = [];
  for (const track of program.tracks) {
    let index = 0;
    while (index < track.frames.length - 2 && frame >= track.frames[index + 1].time) index++;
    if ('texture' in track.frames[index]) ids.push(track.id);
  }
  return ids;
}
/** Restore validates stored geometry only. No curves/matrices/leafStates run. */
export function readSourceBounds(value: PsbValue, raster: LeafProgram, frame: number, children: readonly BoundsClip[], upperBound: number): SourceBounds {
  const row = psbRecord(value), expected = new Set(activeIds(raster, frame).map(id => '-1:' + id));
  for (const child of children) for (const id of activeIds(child.program, child.frame)) expected.add(child.owner + ':' + id);
  if (!Array.isArray(row.items) || row.items.length !== expected.size || row.items.length > upperBound) throw new Error('Incomplete saved MTN post-update bounds');
  const items: BoundItem[] = [];
  for (const raw of row.items) {
    const item = psbRecord(raw), key = item.owner + ':' + item.id;
    if (typeof item.owner !== 'number' || typeof item.id !== 'number' || !expected.delete(key) || !Array.isArray(item.rect) || item.rect.length !== 4 || item.rect.some(value => typeof value !== 'number' || !Number.isSafeInteger(value))) throw new Error('Invalid saved MTN bound item');
    const rect = item.rect as [number, number, number, number];
    if (rect[2] < rect[0] || rect[3] < rect[1] || rect[0] < -raster.originX || rect[1] < -raster.originY || rect[2] > raster.width - raster.originX || rect[3] > raster.height - raster.originY) throw new Error('Saved MTN bound item exceeds its decoded surface');
    items.push({ owner: item.owner, id: item.id, rect: [...rect] });
  }
  const rect = union(items), savedRect = row.rect;
  if (rect === null ? savedRect !== null : !Array.isArray(savedRect) || savedRect.length !== 4 || rect.some((value, index) => savedRect[index] !== value)) throw new Error('Saved MTN bounds union mismatch');
  return { items, rect };
}
