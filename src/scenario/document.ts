import { Psb2Reader, PsbFormatError } from '../formats/psb2/reader.ts';
import type { PsbNode } from '../formats/psb2/types.ts';
import type { CommandPart, DialogueView, ScenarioEvent, ScenarioIndex, SceneDiagnostic, SceneIndex, TextRecord } from './types.ts';

/** Browser-side structural event adapter; no engine commands are dispatched here. */
export class ScenarioDocument {
  readonly index: ScenarioIndex;
  readonly reader: Psb2Reader;
  private readonly labels = new Map<string, number[]>();

  constructor(reader: Psb2Reader) {
    this.reader = reader;
    const root = this.object(reader.header.root);
    const sceneRefs = this.array(reader.property(root.offset, 'scenes'), true);
    const scenes: SceneIndex[] = [];
    const diagnostics: SceneDiagnostic[] = [];
    for (const [sceneNumber, sourceRef] of sceneRefs.entries()) {
      const scene = this.object(sourceRef);
      const label = this.optionalString(reader.property(sourceRef, 'label'));
      const textRefs = this.array(reader.property(sourceRef, 'texts'));
      const texts: TextRecord[] = textRefs.map(ref => ({ sourceRef: ref, slots: this.array(ref, true) }));
      const records = this.array(reader.property(sourceRef, 'lines'), true);
      const events: ScenarioEvent[] = [];
      for (const [sourceIndex, recordRef] of records.entries()) {
        const record = reader.node(recordRef);
        const origin = { sourceRef: recordRef, sourceIndex };
        const report = (message: string) => diagnostics.push({ scene: sceneNumber, sourceIndex, sourceRef: recordRef, message });
        if (record.kind === 'integer') {
          // SCN text markers are one-based; the original integer is retained.
          if (record.value > 0n && record.value <= BigInt(texts.length)) {
            const textIndex = Number(record.value - 1n);
            events.push({ ...origin, kind: 'text', externalId: record.value.toString(),
              textIndex, textRef: texts[textIndex].sourceRef });
          } else {
            const reason = 'Integer marker is outside the scene text table';
            report(reason); events.push({ ...origin, kind: 'opaque', psbKind: record.kind, reason });
          }
        } else if (record.kind === 'string') {
          events.push({ ...origin, kind: 'marker', value: record.value });
        } else if (record.kind === 'array' && record.items.length > 0) {
          const first = reader.node(record.items[0]);
          if (first.kind === 'integer' && record.items.length >= 2) {
            const stateSlot = record.items[1];
            events.push({ ...origin, kind: 'record', recordId: first.value.toString(),
              variant: record.items.length, stateSlot, stateKind: reader.node(stateSlot).kind, slots: record.items });
          } else if (first.kind === 'string' && record.items.length % 2 === 1) {
            const parts: CommandPart[] = [];
            for (let i = 1; i < record.items.length; i += 2) {
              const operation = reader.node(record.items[i]);
              const key = operation.kind === 'string'
                ? { kind: 'string' as const, value: operation.value }
                : operation.kind === 'integer'
                  ? { kind: 'integer' as const, value: operation.value.toString(), storageBytes: operation.storageBytes }
                  : { kind: 'reference' as const, psbKind: operation.kind, sourceRef: record.items[i] };
              if (key.kind === 'reference') report('Command part key has kind ' + operation.kind);
              parts.push({ key, keyRef: record.items[i], argumentRef: record.items[i + 1] });
            }
            events.push({ ...origin, kind: 'command', target: first.value, parts, slots: record.items });
          } else {
            const reason = 'Unmapped tuple shape ' + first.kind + ':' + record.items.length;
            report(reason); events.push({ ...origin, kind: 'opaque', psbKind: record.kind, reason });
          }
        } else {
          const reason = 'Unmapped line record kind ' + record.kind;
          report(reason); events.push({ ...origin, kind: 'opaque', psbKind: record.kind, reason });
        }
      }
      scenes.push({ sourceRef, label, fields: scene.entries, texts, events });
      if (label !== null) {
        const positions = this.labels.get(label) ?? [];
        positions.push(sceneNumber); this.labels.set(label, positions);
      }
    }
    this.index = { schemaVersion: 2, sourceFormat: 'PSB2', rootRef: root.offset,
      name: this.optionalString(reader.property(root.offset, 'name')),
      rootFields: root.entries, scenes, diagnostics };
  }

  private object(offset: number): Extract<PsbNode, { kind: 'object' }> {
    const node = this.reader.node(offset);
    if (node.kind !== 'object') throw new PsbFormatError('Expected scenario object', offset);
    return node;
  }

  private array(offset: number | undefined, required = false): readonly number[] {
    if (offset === undefined) {
      if (required) throw new PsbFormatError('Required scenario array is absent');
      return [];
    }
    const node = this.reader.node(offset);
    if (node.kind === 'null' && !required) return [];
    if (node.kind !== 'array') throw new PsbFormatError('Expected scenario array', offset);
    return node.items;
  }

  private optionalString(offset: number | undefined): string | null {
    if (offset === undefined) return null;
    const node = this.reader.node(offset);
    if (node.kind === 'null') return null;
    if (node.kind !== 'string') throw new PsbFormatError('Expected scenario string', offset);
    return node.value;
  }

  scenePosition(label: string): number | undefined {
    const positions = this.labels.get(label);
    if (positions && positions.length > 1) throw new Error('Ambiguous scene label: ' + label);
    return positions?.[0];
  }

  dialogue(sceneNumber: number, textIndex: number): DialogueView {
    const scene = this.index.scenes[sceneNumber];
    const metadata = scene?.texts[textIndex];
    if (!metadata) throw new Error('Dialogue position is outside the scenario');
    const at = (index: number): PsbNode | undefined => metadata.slots[index] === undefined
      ? undefined : this.reader.node(metadata.slots[index]);
    return { metadata, speaker: at(0), displayName: at(1), body: at(2),
      voiceData: at(3), attributes: at(4), restoreState: at(5) };
  }
}
