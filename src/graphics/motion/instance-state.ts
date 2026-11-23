import { psbRecord, psbValue } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import { motionNumber } from './leaf-program.ts';
import { rasterInitialSpeed } from './raster-playback.ts';
import type { RasterPlaybackState } from './raster-playback.ts';
import { freshCounter, readCounter } from './native-counter.ts';
import { affineState } from './affine-playback.ts';
import type { AffinePlaybackState } from './affine-playback.ts';
import {allowsMotionCue,rootMotionCue} from './se-profiles.ts';
import type { NativeMotionActionProfile } from '../native-frame-stage.ts';

export interface BorrowedMotion {
  readonly model: string; readonly object: string; readonly motion: string;
  readonly state: RasterPlaybackState; readonly affine: AffinePlaybackState;
  readonly children?: PsbValue;
}
export interface MotionIdentity {
  readonly actionState?: PsbValue;
  readonly sourceId?: number;
  readonly object: string; readonly motion: string;
  readonly playback: RasterPlaybackState; readonly affine: AffinePlaybackState;
  readonly continued: boolean;
  readonly profile?: { readonly lastTime: number; readonly loopTime: number };
}
const present = (value: PsbValue | undefined): boolean => value !== undefined && value !== null;
function optionNumber(value: PsbValue, name: string): number {
  if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'boolean' && typeof value !== 'string') throw new Error('Unsupported MTN numeric option: ' + name);
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid MTN numeric option: ' + name);
  return number;
}
/** Native public play 0x1004D140 -> 0x1004D210 -> 0x1004D380. Its same-name
 * guard also applies to root Chain(2), so this accepted same-clip continuation
 * does NOT reload, restart playing or set either gate. Force(1) bypasses it.
 * Original tickCount is a real two-gate counter/eval seek; still rejected here.
 */
export function motionIdentity(document: MtnDocument, options: Readonly<{ [key: string]: PsbValue }>, saved?: PsbValue, borrowed?: BorrowedMotion, actionProfile?: NativeMotionActionProfile): MotionIdentity {
  const supported = new Set(['resolution', 'resolutionx', 'resolutiony', 'chara', 'motion', 'speed', 'tickcount', 'flags']);
  for (const key of Object.keys(options)) if (!supported.has(key)) throw new Error('Unsupported MTN image option: ' + key);
  if (saved === undefined && present(options.tickcount)) throw new Error('MTN tickcount seek is not exposed by this finite profile');
  if (saved !== undefined) {
    const state = psbRecord(saved);
    if (/^native-mtn-raster-tree-v[2-7]$/u.test(String(state.backend))) throw new Error('Legacy MTN snapshot uses unwrapped/timeline counter or lacks the two native gates; recreate with tree-v8');
    const eventful = state.backend === 'native-mtn-raster-tree-v9';
    if (state.schemaVersion !== 1n || !eventful && state.backend !== 'native-mtn-raster-tree-v8' || state.model !== document.name || typeof state.object !== 'string' || !state.object || typeof state.motion !== 'string' || !state.motion) throw new Error('Saved MTN identity mismatch');
    const cue=rootMotionCue(state.object,state.motion);
    if (eventful) {
      if (!allowsMotionCue(actionProfile,cue) || state.actionProfile !== cue.profile || state.geometryProfile !== cue.geometry || typeof state.sourceId !== 'number' || !Number.isSafeInteger(state.sourceId) || state.sourceId < 1 || state.actions === undefined || state.actions === null) throw new Error('Saved v9 action source profile is absent or unsupported');
    } else if (state.actions !== undefined || state.sourceId !== undefined || state.actionProfile !== undefined || state.geometryProfile !== undefined || cue) throw new Error('Eventful SD002BA cannot be restored as event-free v8');
    if (typeof state.speed !== 'boolean' || typeof state.atBoundary !== 'boolean' || typeof state.evaluated !== 'boolean') throw new Error('Saved MTN root boundaries are absent');
    const playback: RasterPlaybackState = { ...readCounter(state), speed: state.speed, atBoundary: state.atBoundary, evaluated: state.evaluated,
      pendingFrames: motionNumber(state.pendingFrames, 'saved pending interval') };
    const affine = affineState(state.affine);
    if (eventful && (affine.moviePlaying !== affine.lastPlaying || playback.playing && !affine.lastPlaying)) throw new Error('Saved finite motion-SE affine completion state differs from the finite no-control profile');
    return { object: state.object, motion: state.motion, playback, affine, continued: false,
      ...(eventful ? { actionState: state.actions, sourceId: Number(state.sourceId) } : {}),
      profile: { lastTime: motionNumber(state.lastTime, 'saved lastTime'), loopTime: motionNumber(state.loopTime, 'saved loopTime') } };
  }
  const previous = borrowed?.model === document.name ? borrowed : undefined;
  const metadata = document.field('metadata');
  const raw = metadata?.kind === 'object' ? psbRecord(psbValue(document.reader, metadata.offset)) : undefined;
  const base = raw?.base && typeof raw.base === 'object' && !Array.isArray(raw.base) ? psbRecord(raw.base) : undefined;
  const object = options.chara ?? previous?.object ?? base?.chara;
  const motion = options.motion ?? previous?.motion ?? base?.motion;
  if (typeof object !== 'string' || !object || typeof motion !== 'string' || !motion) throw new Error('MTN requires original resolved chara/motion defaults: ' + document.name);
  if (previous && object !== previous.object && !present(options.motion)) throw new Error('Unsupported MTN chara-only switch without an explicit motion');
  let continued = !!previous, force = !previous;
  if (present(options.motion)) {
    const flags = present(options.flags) ? optionNumber(options.flags!, 'flags') : 1;
    if (flags === 1) { force = true; continued = false; }
    else if (flags === 2) {
      if (!previous || previous.object !== object || previous.motion !== motion) throw new Error('Unsupported MTN Chain across clips or without prior state');
    } else throw new Error('Unsupported MTN play flags: only Force(1) and same-clip Chain(2) are implemented');
  } else if (present(options.flags)) throw new Error('MTN flags without explicit motion are not implemented');
  const old = previous?.state;
  const speed = present(options.speed) ? rasterInitialSpeed(options.speed) : old?.speed ?? true;
  const playback: RasterPlaybackState = force
    ? { ...freshCounter(), scaledDeltaFrames: old?.scaledDeltaFrames ?? 0, speed, pendingFrames: old?.pendingFrames ?? 0, atBoundary: false, evaluated: false }
    : { ...old!, speed };
  const adapter = previous?.affine ?? { moviePlaying: false, lastPlaying: false, uncollectedMilliseconds: 0, atFlipBoundary: false };
  // _setOptions calls onMotionStart only when public play leaves Player.playing
  // true; onMotionStart itself changes _lastPlaying only if _playing was false.
  const start = (force || present(options.motion)) && playback.playing && !adapter.moviePlaying;
  const affine: AffinePlaybackState = start ? { ...adapter, moviePlaying: true, lastPlaying: true } : { ...adapter };
  return { object, motion, playback, affine, continued };
}
