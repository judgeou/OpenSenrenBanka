import type { LeafProgram, LeafSlot, LeafPoseSlot, LeafTrack } from './leaf-program.ts';
import type { StageQuad, StageTexture } from '../webgl-stage.ts';
import { motionEase } from './curve.ts';
import { pathPosition } from './position-path.ts';
export interface Transform { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly x: number; readonly y: number; readonly opacity: number }
export const identity: Transform = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0, opacity: 1 };
function slot(track: LeafTrack, time: number): LeafPoseSlot | undefined {
  let low = 0, high = track.frames.length;
  while (low < high) { const mid = (low + high) >>> 1; if (track.frames[mid].time <= time) low = mid + 1; else high = mid; }
  if (low === 0) return;
  // Same forward-selection boundary as advanceNodeFrameSelectionLike_0x6926B4:
  // a final type=0 marker is the other slot, never promoted beyond count-2.
  const index = Math.min(low - 1, track.frames.length - 2), current = track.frames[index];
  if (!('scaleX' in current)) return;
  const next = track.frames[index + 1];
  if (current.type !== 3 || !next || !('scaleX' in next) || next.time <= current.time) return current;
  const ratio = Math.min(1, Math.max(0, (time - current.time) / (next.time - current.time)));
  const mix = (a: number, b: number, eased = ratio) => a + (b - a) * eased;
  let destinationAngle = next.angle;
  if (current.angle - destinationAngle > 180) destinationAngle += 360;
  else if (destinationAngle - current.angle > 180) destinationAngle -= 360;
  const angle = mix(current.angle, destinationAngle, motionEase(current.angleCurve, ratio));
  const position = motionEase(current.positionCurve, ratio), zoom = motionEase(current.zoomCurve, ratio);
  const [dx,dy] = current.positionPath ? pathPosition(current.positionPath, position, next.x-current.x, next.y-current.y) : [(next.x-current.x)*position, (next.y-current.y)*position];
  return { ...current, x: current.x+dx, y: current.y+dy,
    ox: mix(current.ox, next.ox), oy: mix(current.oy, next.oy), angle: angle < 0 ? angle + 360 : angle >= 360 ? angle - 360 : angle,
    scaleX: mix(current.scaleX, next.scaleX, zoom), scaleY: mix(current.scaleY, next.scaleY, zoom),
    ...(current.skewX!==undefined||next.skewX!==undefined?{skewX:mix(current.skewX??0,next.skewX??0,motionEase(current.skewCurve,ratio)),skewY:mix(current.skewY??0,next.skewY??0,motionEase(current.skewCurve,ratio))}:{}),
    opacity: Math.floor(mix(current.opacity * 255, next.opacity * 255) + 0.5) / 255 };
}
export function motionLocal(slot: Pick<LeafPoseSlot,'x'|'y'|'opacity'|'angle'|'scaleX'|'scaleY'|'skewX'|'skewY'|'flipX'|'flipY'>, order: readonly number[]): Transform {
  let a = 1, b = 0, c = 0, d = 1;
  for (const operation of order) {
    if (operation === 0) {
      if (slot.flipX) { a = -a; c = -c; }
      if (slot.flipY) { b = -b; d = -d; }
    } else if (operation === 1 && slot.angle !== 0) {
      const radians = slot.angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      const nextA = cosine * a - sine * b, nextB = sine * a + cosine * b;
      const nextC = cosine * c - sine * d, nextD = sine * c + cosine * d;
      a = nextA; b = nextB; c = nextC; d = nextD;
    } else if (operation === 2) { a *= slot.scaleX; c *= slot.scaleX; b *= slot.scaleY; d *= slot.scaleY; }
    else if(operation===3&&(slot.skewX||slot.skewY)){
      const sx=slot.skewX??0,sy=slot.skewY??0;
      const na=a+sx*b, nc=c+sx*d; b+=sy*a;d+=sy*c;a=na;c=nc;
    }
  }
  return { a, b, c, d, x: slot.x, y: slot.y, opacity: slot.opacity };
}
export function inherit(parent: Transform, child: Transform): Transform {
  return { a: parent.a * child.a + parent.c * child.b, b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d, d: parent.b * child.c + parent.d * child.d,
    x: parent.x + parent.a * child.x + parent.c * child.y, y: parent.y + parent.b * child.x + parent.d * child.y,
    opacity: Math.trunc(Math.round(parent.opacity * 255) * Math.round(child.opacity * 255) / 255) / 255 };
}
/** Sample accepted native raster trees, including their parents at THIS time.
 * No preflattened stand, unified fade, frame-clock mutation or side effects.
 */
export function leafStates(program: LeafProgram, frame: number, root: Transform = identity): { states: ReadonlyMap<number, Transform>; active: ReadonlyMap<number, LeafSlot> } {
  if (!Number.isFinite(frame) || frame < 0) throw new Error('Invalid MTN sample frame');
  const states = new Map<number, Transform>(), active = new Map<number, LeafSlot>();
  for (const track of program.tracks) {
    const sampled = slot(track, Math.min(frame, program.source.lastTime));
    if (!sampled) continue;
    const parent = track.parent === undefined ? root : states.get(track.parent);
    if (!parent) throw new Error('Unsupported inactive MTN raster parent');
    states.set(track.id, inherit(track.independentAlpha?{...parent,opacity:1}:parent, motionLocal(sampled, track.transformOrder))); if ('texture' in sampled) active.set(track.id, sampled);
  }
  return { states, active };
}
export interface RasterSurface { readonly width: number; readonly height: number; readonly originX: number; readonly originY: number }
export function leafItems(program: LeafProgram, textures: ReadonlyMap<string, StageTexture>, frame: number, root: Transform = identity, surface: RasterSurface = program): ReadonlyMap<number, StageQuad> {
  const { states, active } = leafStates(program, frame, root), output = new Map<number, StageQuad>();
  for (const [order, id] of program.order.entries()) {
    const sampled = active.get(id), state = states.get(id); if (!sampled || !state || state.opacity <= 0) continue;
    const texture = textures.get(sampled.texture.key); if (!texture) throw new Error('MTN texture lease is absent');
    const ox = sampled.ox + sampled.texture.originX, oy = sampled.oy + sampled.texture.originY;
    const left = surface.originX + state.x - state.a * ox - state.c * oy;
    const top = surface.originY + state.y - state.b * ox - state.d * oy;
    const matrix = new Float32Array([2 * state.a / surface.width, -2 * state.b / surface.height, 0, 0,
      2 * state.c / surface.width, -2 * state.d / surface.height, 0, 0, 0, 0, 1, 0, 2 * left / surface.width - 1, 1 - 2 * top / surface.height, 0, 1]);
    const clipNode=program.tracks.find(track=>track.id===id)?.clipAncestor;
    const clip=clipNode===undefined ? undefined : states.get(clipNode);
    // Source type 7 is a centered, 32-unit square, transformed into the
    // motion surface's local rectangular clip. This profile has no rotation.
    const clipRectangle = clip ? [surface.originX+clip.x-16*Math.abs(clip.a), surface.originY+clip.y-16*Math.abs(clip.d),
      32*Math.abs(clip.a),32*Math.abs(clip.d)] as const : undefined;
    output.set(id, { texture, matrix, opacity: state.opacity, visible: true, order, blend: sampled.blend??'normal', clipRectangle });
  }
  return output;
}
export function leafQuads(program: LeafProgram, textures: ReadonlyMap<string, StageTexture>, frame: number): StageQuad[] { return [...leafItems(program, textures, frame).values()]; }
