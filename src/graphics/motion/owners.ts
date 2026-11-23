import type { GraphicPresentation } from '../../world/graphic-entity.ts';
import { nativeNumber } from '../../world/native-values.ts';
import type { PreparedGraphicFrame } from '../prepared-frames.ts';
import type { MotionFrame } from './motion-frame.ts';

function source(view: GraphicPresentation | undefined): MotionFrame | undefined {
  return (view?.frame as PreparedGraphicFrame | undefined)?.motion;
}
function visible(view: GraphicPresentation | undefined): view is GraphicPresentation {
  return !!view?.visible && nativeNumber(view.properties.visvalue, 0) > 0;
}
/** Raw owned/published layers, not projected/onscreen views and not all loaded
 * sources. An offscreen or retiring owner can still be in the original flip list.
 * Timeline consumption is left to the separate actual draw adapter.
 */
export function flipOwnedMotions(views: Iterable<GraphicPresentation>, now: number): void {
  const active = new Map<MotionFrame, number>();
  for (const view of views) {
    const motion = source(view);
    if (!motion || !motion.isFlip()) continue;
    const speed = nativeNumber(view.properties.speed, 1), previous = active.get(motion);
    if (previous !== undefined && previous !== speed) throw new Error('Shared MTN owners have incompatible affine layer speeds');
    active.set(motion, speed);
  }
  for (const [motion, speed] of active) motion.updateFlip(now, speed);
}
/** Original mode1 uses target.canSync, even when not the mode2 wait target.
 * Mode2 uses visible target first, then visible hide. Never use one combined
 * query which forces unknown sync semantics while only asking for movie state.
 */
export function ownedMotionView(views: Iterable<GraphicPresentation>, name: string, kind: 'sync' | 'movie'): GraphicPresentation | undefined {
  if (kind !== 'sync' && kind !== 'movie') throw new Error('Unknown MTN wait kind');
  let target: GraphicPresentation | undefined, hide: GraphicPresentation | undefined;
  for (const view of views) {
    if (view.name === name) { if (target) throw new Error('Ambiguous native motion target'); target = view; }
    if (view.name === 'hide_' + name) { if (hide) throw new Error('Ambiguous native hidden motion target'); hide = view; }
  }
  return kind === 'sync' ? target : visible(target) ? target : visible(hide) ? hide : undefined;
}
/** Queries, real control and pure preflight all use this exact layer selector. */
export function ownedMotion(views: Iterable<GraphicPresentation>, name: string, kind: 'sync' | 'movie'): MotionFrame | undefined {
  return source(ownedMotionView(views, name, kind));
}
