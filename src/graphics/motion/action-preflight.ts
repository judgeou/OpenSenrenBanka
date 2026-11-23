import type { GraphicPresentation } from '../../world/graphic-entity.ts';
import { nativeNumber } from '../../world/native-values.ts';
import type { PreparedGraphicFrame } from '../prepared-frames.ts';
import {allowsMotionCue,rootMotionCues} from './se-profiles.ts';
import type { MotionActionOutbox, NativeMotionActionOwner } from './action-events.ts';
import type { NativeMotionActionProfile } from '../native-frame-stage.ts';
import type { MotionFrame } from './motion-frame.ts';

export function rejectMotionActions(views: Iterable<GraphicPresentation>): void {
  for (const view of views) if ((view.frame as PreparedGraphicFrame | undefined)?.motion?.actions) throw new Error('Eventful motion is forbidden in legacy frame/old-world capture/control');
}
/** Only checks live declarations/data; never evaluates a counter, predicts a
 * frame, resolves expressions, samples textures or queries app callbacks.
 * App must still bind exact delays/owners/sound and animOffSE before activation.
 */
export function preflightMotionActionOwners(views: Iterable<GraphicPresentation>, profile?: NativeMotionActionProfile, outbox?: MotionActionOutbox): readonly NativeMotionActionOwner[] {
  outbox?.preflightUse();
  if (outbox?.peek()) throw new Error('A prior motion delivery remains unconsumed');
  const all = [...views], owners = new Map<MotionFrame, GraphicPresentation[]>();
  for (const view of all) {
    const motion = (view.frame as PreparedGraphicFrame | undefined)?.motion;
    if (!motion) continue;
    const list = owners.get(motion) ?? []; list.push(view); owners.set(motion, list);
  }
  let eventRoots = 0;
  const sourceIds = new Set<number>(), result: NativeMotionActionOwner[] = [];
  for (const [motion, list] of owners) {
    const port = motion.actions; if (!port) continue;
    const cue=rootMotionCues.find(row=>row.profile===port.profile);
    if (!allowsMotionCue(profile,cue) || !outbox || port.outbox !== outbox) throw new Error('Motion action consumer/profile is not installed');
    if (++eventRoots > 1 || list.length !== 1 || port.playSerial !== 1 || !Number.isSafeInteger(port.sourceId) || port.sourceId < 1) throw new Error('Motion action requires one finite motion-SE root with one owner');
    const owner = list[0], speed = nativeNumber(owner.properties.speed, 1);
    if (speed !== 0 && speed !== 1 || owner.name.startsWith('hide_') || owner.link !== undefined && owner.link !== null && owner.link !== '') throw new Error('Eventful motion hide/link/layer speed is unsupported');
    for (const dependent of all) {
      const link = dependent.link;
      if (link !== undefined && link !== null && link !== '' && (typeof link !== 'string' || link === owner.name || link === owner.id)) throw new Error('Eventful owner has an unsupported/unknown reverse link');
    }
    if (port.outbox.peek()) throw new Error('New staged frame cannot import an unconsumed prior delivery');
    port.outbox.preflight(1); port.preflight(owner.id); sourceIds.add(port.sourceId);
    const dispatched = port.completedActions();
    if (!Number.isSafeInteger(dispatched)||dispatched<0||!('timeline' in cue)&&dispatched>1) throw new Error('Unknown committed motion action cursor');
    result.push(Object.freeze({ profile: port.profile, sourceId: port.sourceId, playSerial: port.playSerial, ownerId: owner.id, ownerName: owner.name, dispatched, label: 'se', action: cue.action, actionOrdinal: 1 }));
  }
  if (outbox && (outbox.sources.ids().length !== sourceIds.size || outbox.sources.ids().some(id => !sourceIds.has(id)))) throw new Error('Motion collector has an unpublished/unregistered source');
  return Object.freeze(result);
}

export function retireMotionPublication(previous: GraphicPresentation|undefined, replacement?: GraphicPresentation): void {
  const old=(previous?.frame as PreparedGraphicFrame|undefined)?.motion;
  if (old && old!==(replacement?.frame as PreparedGraphicFrame|undefined)?.motion && old.actions) {
    if(!old.actions.retire) throw new Error('Eventful publication cannot retire its owner');
    old.actions.retire();
  }
}
