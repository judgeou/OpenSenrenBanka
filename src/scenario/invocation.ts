import { commandEnvelope } from './semantics.ts';
import { psbValue } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { ScenarioDocument } from './document.ts';
import type { ScenarioEvent } from './types.ts';

export interface RuntimeLocation { readonly asset: string; readonly scene: number; readonly event: number; readonly sourceRef: number }
export interface RuntimeCommand {
  readonly name: string; readonly parameters: { [key: string]: PsbValue }; readonly order: readonly string[];
  readonly deferred: { readonly kind: 'integer'; readonly value: bigint } | { readonly kind: 'label'; readonly value: string } | undefined;
  readonly location: RuntimeLocation;
}
export function invocation(document: ScenarioDocument, event: Extract<ScenarioEvent, { kind: 'command' }>, location: RuntimeLocation): RuntimeCommand {
  const envelope = commandEnvelope(document, event);
  if (envelope.arguments.length % 2 !== 0) throw new Error('Unpaired command arguments');
  const parameters: { [key: string]: PsbValue } = Object.create(null), order: string[] = [];
  for (let index = 0; index < envelope.arguments.length; index += 2) {
    const key = document.reader.node(envelope.arguments[index]);
    if (key.kind !== 'string') throw new Error('Unsupported command argument key');
    order.push(key.value); parameters[key.value] = psbValue(document.reader, envelope.arguments[index + 1]);
  }
  return { name: envelope.target, parameters, order, location,
    deferred: envelope.deferred?.kind === 'integer' ? { kind: 'integer', value: envelope.deferred.value } :
      envelope.deferred?.kind === 'label' ? { kind: 'label', value: envelope.deferred.value } : undefined };
}
