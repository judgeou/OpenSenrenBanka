import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { NativeMotionActionProfile } from '../native-frame-stage.ts';
import type { MotionActionOutbox } from './action-events.ts';

/** Keep default event-free schema2 unchanged for the current app wrapper.
 * Explicitly assembled motion capability uses schema3, even with an empty box.
 */
export function graphicActionSnapshot(profile: NativeMotionActionProfile | undefined, outbox: MotionActionOutbox | undefined): { [key: string]: PsbValue } {
  outbox?.preflightUse();
  if (!profile) {
    outbox?.capture(); // Fault cannot be hidden by an absent capability flag.
    if (outbox?.peek()) throw new Error('Event-free graphics cannot save a pending motion action');
    return { schemaVersion: 2n };
  }
  if ((profile !== 'sd002ba-se001-v1'&&profile !== 'r66-motion-se-v1') || !outbox) throw new Error('Unknown/unbound saved graphics action profile');
  if (outbox.peek()) throw new Error('Stable pending motion action restoration is not installed');
  return { schemaVersion: 3n, motionActionProfile: profile, motionActions: outbox.capture() };
}
/** Validate before graphics restore mutates screen/raster/source attachments.
 * A schema2 snapshot cannot silently carry event state. Pending/fault is refused.
 */
export function preflightGraphicActionRestore(row: { readonly [key: string]: PsbValue }, profile: NativeMotionActionProfile | undefined, outbox: MotionActionOutbox | undefined): PsbValue | undefined {
  const current = outbox ? psbRecord(outbox.capture()) : undefined;
  if (current && (current.serial !== 0 || current.acked !== 0)) throw new Error('Collector restore requires fresh runtime state');
  if (row.schemaVersion === 2n) {
    if (row.motionActions !== undefined || row.motionActionProfile !== undefined || outbox?.sources.ids().length) throw new Error('Legacy graphics schema cannot carry motion actions');
    return;
  }
  if (row.schemaVersion !== 3n || (profile !== 'sd002ba-se001-v1'&&profile !== 'r66-motion-se-v1') || row.motionActionProfile !== profile || !outbox) throw new Error('Unsupported saved native graphics action profile');
  const saved = psbRecord(row.motionActions);
  if (!Array.isArray(saved.records) || saved.records.length) throw new Error('Stable pending motion action restoration is not installed');
  outbox.preflightRestore(row.motionActions);
  return row.motionActions;
}
