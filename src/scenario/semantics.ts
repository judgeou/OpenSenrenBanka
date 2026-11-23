import type { ScenarioDocument } from './document.ts';
import type { PsbNode } from '../formats/psb2/types.ts';
import type { ScenarioEvent } from './types.ts';

type RecordEvent = Extract<ScenarioEvent, { kind: 'record' }>;
type CommandEvent = Extract<ScenarioEvent, { kind: 'command' }>;
export interface CheckpointView {
  readonly point: bigint; readonly stateRef: number; readonly textId: bigint | undefined;
  readonly force: boolean; readonly sourceLine: bigint | undefined; readonly textFlags: bigint | undefined;
  readonly labelRef: number | undefined; readonly textNumberRef: number | undefined;
}
export interface CommandEnvelope {
  readonly target: string; readonly targetRef: number; readonly arguments: readonly number[];
  readonly deferred: { readonly kind: 'integer'; readonly value: bigint; readonly sourceRef: number }
    | { readonly kind: 'label'; readonly value: string; readonly sourceRef: number } | undefined;
}

function integerAt(document: ScenarioDocument, ref: number | undefined): bigint | undefined {
  if (ref === undefined) return undefined;
  const node = document.reader.node(ref);
  if (node.kind === 'null') return undefined;
  if (node.kind !== 'integer') throw new Error('Expected checkpoint integer at ' + ref);
  return node.value;
}

export function checkpointView(document: ScenarioDocument, event: RecordEvent): CheckpointView {
  const forceRef = event.slots[3];
  return { point: BigInt(event.recordId), stateRef: event.stateSlot,
    textId: integerAt(document, event.slots[2]),
    force: forceRef !== undefined && document.reader.node(forceRef).kind !== 'null',
    sourceLine: integerAt(document, event.slots[4]), textFlags: integerAt(document, event.slots[5]),
    labelRef: event.slots[6], textNumberRef: event.slots[7] };
}

/** Integer state slots refer to one-based text records, whose sixth slot is state. */
export function resolveStateReference(document: ScenarioDocument, sceneIndex: number, sourceRef: number): number | undefined {
  const scene = document.index.scenes[sceneIndex];
  if (!scene) throw new Error('Scene is outside the scenario');
  const visited = new Set<number>();
  let ref = sourceRef;
  while (true) {
    if (visited.has(ref) || visited.size >= 1024) throw new Error('Cyclic/over-budget state reference');
    visited.add(ref);
    const node = document.reader.node(ref);
    if (node.kind === 'object') return ref;
    if (node.kind === 'null') return undefined;
    if (node.kind !== 'integer' || node.value < 1n || node.value > BigInt(scene.texts.length)) {
      throw new Error('Unresolved state reference at ' + ref);
    }
    const next = scene.texts[Number(node.value - 1n)].slots[5];
    if (next === undefined) throw new Error('Text record has no restore-state slot');
    ref = next;
  }
}

export function checkpointAtOrAfter(document: ScenarioDocument, sceneIndex: number, point: bigint): RecordEvent | undefined {
  const scene = document.index.scenes[sceneIndex];
  if (!scene) throw new Error('Scene is outside the scenario');
  const selects = document.reader.property(scene.sourceRef, 'selects');
  if (selects !== undefined && document.reader.node(selects).kind !== 'null') {
    return scene.events.find((event): event is RecordEvent => event.kind === 'record');
  }
  return scene.events.find((event): event is RecordEvent => event.kind === 'record' && BigInt(event.recordId) >= point);
}

export function commandEnvelope(document: ScenarioDocument, event: CommandEvent): CommandEnvelope {
  const deferred = event.target === 'delayrun';
  const targetRef = event.slots[deferred ? 2 : 0];
  if (targetRef === undefined) throw new Error('Command has no target slot');
  const target = document.reader.node(targetRef);
  if (target.kind !== 'string') throw new Error('Command target is not a string');
  if (!deferred) return { target: target.value, targetRef, arguments: event.slots.slice(1), deferred: undefined };
  const triggerRef = event.slots[1];
  const trigger: PsbNode = document.reader.node(triggerRef);
  if (trigger.kind === 'integer') return { target: target.value, targetRef, arguments: event.slots.slice(3),
    deferred: { kind: 'integer', value: trigger.value, sourceRef: triggerRef } };
  if (trigger.kind === 'string') return { target: target.value, targetRef, arguments: event.slots.slice(3),
    deferred: { kind: 'label', value: trigger.value, sourceRef: triggerRef } };
  throw new Error('Unsupported deferred-command trigger kind ' + trigger.kind);
}
