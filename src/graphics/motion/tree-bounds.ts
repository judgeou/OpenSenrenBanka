import type { LeafSlot, LeafPoseSlot, LeafTrack } from './leaf-program.ts';
type Range = readonly [number, number];
interface Bounds { readonly a: Range; readonly b: Range; readonly c: Range; readonly d: Range; readonly x: Range; readonly y: Range }
const zero: Range = [0, 0], one: Range = [1, 1];
const identity: Bounds = { a: one, b: zero, c: zero, d: one, x: zero, y: zero };
const add = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]];
function multiply(a: Range, b: Range): Range {
  const terms = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return [Math.min(...terms), Math.max(...terms)];
}
function range<T>(slots: readonly T[], select: (slot: T) => number): Range {
  let low = Infinity, high = -Infinity;
  for (const slot of slots) { const value = select(slot); low = Math.min(low, value); high = Math.max(high, value); }
  if (!Number.isFinite(low) || !Number.isFinite(high)) throw new Error('Unsupported empty raster track');
  return [low, high];
}
function dot(a: Range, x: Range, c: Range, y: Range): Range { return add(multiply(a, x), multiply(c, y)); }
/** Conservative analytical interval bounds, NOT temporal sampling or a probe.
 * Accepted single-cubic curves stay in [0,1], so each interpolated scalar is
 * bounded by its endpoint range. Rotated coefficients are bounded by max scale.
 * Overestimation changes allocation only, not a vertex, origin or output pixel.
 */
export interface NestedBound { readonly parent: number | undefined; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export function rasterTreeBounds(tracks: readonly LeafTrack[], children: readonly NestedBound[] = []): { width: number; height: number; originX: number; originY: number } {
  const ancestors = new Map<number, Bounds>(); let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const track of tracks) {
    const slots = track.frames.filter((frame): frame is LeafPoseSlot => 'scaleX' in frame);
    const parent = track.parent === undefined ? identity : ancestors.get(track.parent);
    if (!parent) throw new Error('MTN raster parent is not prepared');
    const sx = range(slots, slot => slot.scaleX), sy = range(slots, slot => slot.scaleY);
    const rotated = slots.some(slot => slot.angle !== 0), maximum = Math.max(Math.abs(sx[0]), Math.abs(sx[1]), Math.abs(sy[0]), Math.abs(sy[1]));
    const symmetric: Range = [-maximum, maximum];
    const la = rotated || slots.some(slot => slot.flipX) ? symmetric : sx, lb = rotated ? symmetric : zero, lc = rotated ? symmetric : zero, ld = rotated || slots.some(slot => slot.flipY) ? symmetric : sy;
    let px = range(slots, slot => slot.x), py = range(slots, slot => slot.y);
    for (const [i, cur] of track.frames.entries()) if ('positionPath' in cur && cur.positionPath) {
      const next = track.frames[i+1]; if (!next || !('x' in next) || cur.type !== 3) throw new Error('MTN position path has no interpolation target');
      const dx=next.x-cur.x, dy=next.y-cur.y;
      const hull=cur.positionPath.x.map((v,j) => [cur.x+dx*v-dy*cur.positionPath!.y[j],cur.y+dy*v+dx*cur.positionPath!.y[j]]);
      px=[Math.min(px[0],...hull.map(point=>point[0])),Math.max(px[1],...hull.map(point=>point[0]))];
      py=[Math.min(py[0],...hull.map(point=>point[1])),Math.max(py[1],...hull.map(point=>point[1]))];
    }
    const world: Bounds = {
      a: dot(parent.a, la, parent.c, lb), b: dot(parent.b, la, parent.d, lb),
      c: dot(parent.a, lc, parent.c, ld), d: dot(parent.b, lc, parent.d, ld),
      x: add(parent.x, dot(parent.a, px, parent.c, py)), y: add(parent.y, dot(parent.b, px, parent.d, py))
    };
    ancestors.set(track.id, world);
    const rasters = slots.filter((slot): slot is LeafSlot => 'texture' in slot);
    if (!rasters.length) continue; // Layout contributes its transform, never pixels.
    const xlo = range(rasters, slot => -slot.texture.originX), xhi = range(rasters, slot => slot.texture.width - slot.texture.originX);
    const ylo = range(rasters, slot => -slot.texture.originY), yhi = range(rasters, slot => slot.texture.height - slot.texture.originY);
    const ox = range(rasters, slot => slot.ox), oy = range(rasters, slot => slot.oy);
    // The active texture stays A while offsets approach B; combine independent
    // ranges so a source switch cannot underallocate the preceding interval.
    const imageX: Range = [Math.min(xlo[0], xhi[0]) - ox[1], Math.max(xlo[1], xhi[1]) - ox[0]];
    const imageY: Range = [Math.min(ylo[0], yhi[0]) - oy[1], Math.max(ylo[1], yhi[1]) - oy[0]];
    const x = add(world.x, dot(world.a, imageX, world.c, imageY)), y = add(world.y, dot(world.b, imageX, world.d, imageY));
    left = Math.min(left, x[0]); right = Math.max(right, x[1]); top = Math.min(top, y[0]); bottom = Math.max(bottom, y[1]);
  }
  for (const child of children) {
    const parent = child.parent === undefined ? identity : ancestors.get(child.parent);
    if (!parent) throw new Error('Nested raster bounds parent is absent');
    const x = add(parent.x, dot(parent.a, [child.left, child.right], parent.c, [child.top, child.bottom]));
    const y = add(parent.y, dot(parent.b, [child.left, child.right], parent.d, [child.top, child.bottom]));
    left = Math.min(left, x[0]); right = Math.max(right, x[1]); top = Math.min(top, y[0]); bottom = Math.max(bottom, y[1]);
  }
  left = Math.floor(left); top = Math.floor(top);
  const width = Math.max(1, Math.ceil(right) - left), height = Math.max(1, Math.ceil(bottom) - top);
  if (![left, top, width, height].every(Number.isSafeInteger) || width * height > 16 * 1024 * 1024) throw new Error('MTN analytical local surface budget exceeded');
  return { width, height, originX: -left, originY: -top };
}
