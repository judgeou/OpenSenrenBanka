import type { ScenarioDocument } from '../scenario/document.ts';
import { checkpointAtOrAfter, resolveStateReference } from '../scenario/semantics.ts';
import { clonePsbValue, psbValue } from '../formats/psb-value.ts';
import type { SceneBridge } from './types.ts';
/** Native startScene/goToPoint restores the initial source state; onNext instead calls syncObject. */
export async function enterSourceWorld(document: ScenarioDocument, scene: number, bridge: SceneBridge, kind: 'initial' | 'sync'): Promise<void> {
  const checkpoint = checkpointAtOrAfter(document, scene, 0n); if (!checkpoint) throw new Error('Original scene has no initial checkpoint');
  const reference = resolveStateReference(document, scene, checkpoint.stateSlot); if (reference === undefined) return;
  const state = clonePsbValue(psbValue(document.reader, reference)); if (kind === 'initial') await bridge.restoreWorld(state); else await bridge.syncWorld(state);
}
