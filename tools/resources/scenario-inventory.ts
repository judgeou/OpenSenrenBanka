import type { Psb2Reader } from '../../src/formats/psb2/reader.ts';
import type { PsbNode } from '../../src/formats/psb2/types.ts';

type Counts = Record<string, number>;
const counts = (): Counts => Object.create(null);
const add = (map: Counts, key: string): void => { map[key] = (map[key] ?? 0) + 1; };

function items(reader: Psb2Reader, offset: number | undefined, required = false): readonly number[] {
  if (offset === undefined) {
    if (required) throw new Error('Required scene array is absent');
    return [];
  }
  const node = reader.node(offset);
  if (node.kind === 'null' && !required) return [];
  if (node.kind !== 'array') throw new Error('Expected scene array at ' + offset);
  return node.items;
}
function token(reader: Psb2Reader, offset: number | undefined): string | null {
  if (offset === undefined) return null;
  const node = reader.node(offset);
  if (node.kind === 'string') return node.value;
  if (node.kind === 'integer') return node.value.toString();
  if (node.kind === 'boolean') return String(node.value);
  return null;
}
function text(reader: Psb2Reader, offset: number | undefined): string | null {
  if (offset === undefined) return null;
  const node = reader.node(offset);
  return node.kind === 'string' ? node.value : null;
}
function object(reader: Psb2Reader, offset: number): Extract<PsbNode, { kind: 'object' }> {
  const node = reader.node(offset);
  if (node.kind !== 'object') throw new Error('Expected scene object at ' + offset);
  return node;
}

/** Static inventory only: it neither evaluates TJS nor dispatches scene commands. */
export function inventoryScenario(reader: Psb2Reader) {
  const psbTypes = counts(), integerWidths = counts(), sceneFields = counts();
  const lineShapes = counts(), stateFields = counts(), commandTargets = counts();
  const commandPairs = counts(), entityClasses = counts(), entityStateFields = counts();
  const entityParameterFields = counts();
  const resourceCandidates = new Set<string>();
  let nonFiniteReals = 0, negativeZeroReals = 0;
  const resourceKeys = new Set(['filename', 'file', 'storage', 'imageFile']);
  const psbNodes = reader.walk(node => {
    add(psbTypes, String(node.code));
    if (node.kind === 'integer') add(integerWidths, String(node.storageBytes));
    if (node.kind === 'real') {
      if (!Number.isFinite(node.value)) nonFiniteReals += 1;
      if (Object.is(node.value, -0)) negativeZeroReals += 1;
    }
    if (node.kind === 'object') {
      for (const property of node.entries) {
        if (resourceKeys.has(property.key)) {
          const value = text(reader, property.valueOffset);
          if (value) resourceCandidates.add(value);
        }
      }
    }
  });
  const root = reader.header.root;
  const sceneOffsets = items(reader, reader.property(root, 'scenes'), true);
  const scenes: { label: string | null; offset: number; lineCount: number; textCount: number;
    choiceCount: number; preEvalCount: number; postEvalCount: number; keys: string[] }[] = [];
  const edges: { from: string | null; storage: string | null; target: string | null;
    source: 'nexts' | 'selects'; kind: string | null }[] = [];
  let lineCount = 0, textCount = 0, choiceCount = 0, snapshots = 0, commands = 0;
  let otherLines = 0, preEvalCount = 0, postEvalCount = 0, malformedEntities = 0;

  for (const sceneOffset of sceneOffsets) {
    const scene = object(reader, sceneOffset);
    for (const property of scene.entries) add(sceneFields, property.key);
    const label = text(reader, reader.property(sceneOffset, 'label'));
    const lines = items(reader, reader.property(sceneOffset, 'lines'), true);
    const texts = items(reader, reader.property(sceneOffset, 'texts'));
    const selects = items(reader, reader.property(sceneOffset, 'selects'));
    const preevals = items(reader, reader.property(sceneOffset, 'preevals'));
    const postevals = items(reader, reader.property(sceneOffset, 'postevals'));
    lineCount += lines.length; textCount += texts.length; choiceCount += selects.length;
    preEvalCount += preevals.length; postEvalCount += postevals.length;
    scenes.push({ label, offset: sceneOffset, lineCount: lines.length, textCount: texts.length,
      choiceCount: selects.length, preEvalCount: preevals.length, postEvalCount: postevals.length,
      keys: scene.entries.map(property => property.key) });
    for (const field of ['nexts', 'selects'] as const) {
      for (const edgeOffset of items(reader, reader.property(sceneOffset, field))) {
        object(reader, edgeOffset);
        edges.push({ from: label, source: field,
          storage: text(reader, reader.property(edgeOffset, 'storage')),
          target: text(reader, reader.property(edgeOffset, 'target')),
          kind: token(reader, reader.property(edgeOffset, 'type')) });
      }
    }
    for (const lineOffset of lines) {
      const line = reader.node(lineOffset);
      if (line.kind !== 'array') { add(lineShapes, line.kind); otherLines += 1; continue; }
      const first = line.items[0] === undefined ? undefined : reader.node(line.items[0]);
      add(lineShapes, (first?.kind ?? 'empty') + ':' + line.items.length);
      if (first?.kind === 'string') {
        commands += 1;
        add(commandTargets, first.value);
        add(commandPairs, first.value + ' / ' + (text(reader, line.items[1]) ?? '(no string slot 1)'));
      } else if (first?.kind === 'integer' && line.items[1] !== undefined) {
        const state = reader.node(line.items[1]);
        if (state.kind !== 'object') { otherLines += 1; continue; }
        snapshots += 1;
        for (const property of state.entries) add(stateFields, property.key);
        for (const entityOffset of items(reader, reader.property(state.offset, 'data'))) {
          const entity = reader.node(entityOffset);
          if (entity.kind !== 'array' || entity.items.length < 3) { malformedEntities += 1; continue; }
          const className = text(reader, entity.items[1]);
          if (className === null) { malformedEntities += 1; continue; }
          add(entityClasses, className);
          const stateNode = reader.node(entity.items[2]);
          if (stateNode.kind !== 'object') { malformedEntities += 1; continue; }
          for (const property of stateNode.entries) {
            if (property.key === 'name') continue;
            const key = className + ' / ' + property.key;
            add(entityStateFields, key);
            const params = reader.node(property.valueOffset);
            if (params.kind === 'object') {
              for (const parameter of params.entries) add(entityParameterFields, key + ' / ' + parameter.key);
            }
          }
        }
      } else otherLines += 1;
    }
  }
  return {
    rootName: text(reader, reader.property(root, 'name')),
    rootKeys: object(reader, root).entries.map(property => property.key),
    nameCount: reader.names.length, stringCount: reader.stringCount, resourceCount: reader.resourceCount,
    psbNodes, psbTypes, integerWidths, nonFiniteReals, negativeZeroReals,
    sceneCount: scenes.length, lineCount, textCount, choiceCount, snapshots, commands, otherLines,
    malformedEntities, preEvalCount, postEvalCount, sceneFields, lineShapes, stateFields, commandTargets,
    commandPairs, entityClasses, entityStateFields, entityParameterFields,
    resourceCandidates: [...resourceCandidates], scenes, edges,
  };
}

export type ScenarioInventory = ReturnType<typeof inventoryScenario>;
