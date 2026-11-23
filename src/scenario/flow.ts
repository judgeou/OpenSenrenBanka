import { psbArray, psbRecord, psbValue } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { ScenarioDocument } from './document.ts';
export type EvalInstruction = { readonly kind: 'program'; readonly source: string } | { readonly kind: 'set'; readonly path: string; readonly value: PsbValue };
export interface Branch { readonly type: number; readonly storage: string; readonly target: string; readonly condition: string; readonly expression: string; readonly raw: { [key: string]: PsbValue } }
export interface Choice extends Branch { readonly index: number; readonly text: string; readonly tag: string; readonly selectionIndex: bigint | undefined }
export interface SceneFlow { readonly before: readonly EvalInstruction[]; readonly after: readonly EvalInstruction[]; readonly next: readonly Branch[]; readonly choices: readonly Choice[]; readonly selectInfo: PsbValue | undefined }
function optionalString(value: PsbValue | undefined, field: string): string {
  if (value === undefined || value === null) return ''; if (typeof value !== 'string') throw new Error('Invalid scene ' + field); return value;
}
function branch(value: PsbValue, defaultType = 0): Branch {
  const raw = psbRecord(value), type = raw.type === undefined ? defaultType : Number(raw.type);
  if (!Number.isInteger(type) || type < 0 || type > 3) throw new Error('Unknown scene next type');
  return { type, storage: optionalString(raw.storage, 'storage'), target: optionalString(raw.target, 'target'),
    condition: optionalString(raw.eval, 'eval'), expression: optionalString(raw.exp, 'exp'), raw };
}
export function sceneFlow(document: ScenarioDocument, sceneIndex: number): SceneFlow {
  const scene = document.index.scenes[sceneIndex]; if (!scene) throw new Error('Scene is outside the scenario');
  function field(name: string): PsbValue | undefined { const ref = document.reader.property(scene.sourceRef, name); return ref === undefined ? undefined : psbValue(document.reader, ref); }
  function values(name: string): PsbValue[] { const value = field(name); return value === undefined || value === null ? [] : psbArray(value); }
  function evals(name: string): EvalInstruction[] {
    return values(name).map(value => {
      if (typeof value === 'string') return { kind: 'program', source: value };
      const tuple = psbArray(value);
      if (tuple.length !== 2 || typeof tuple[0] !== 'string') throw new Error('Unsupported scene assignment record');
      return { kind: 'set', path: tuple[0], value: tuple[1] };
    });
  }
  return { before: evals('preevals'), after: evals('postevals'), next: values('nexts').map(value => branch(value)),
    choices: values('selects').map((value, index) => { const item = branch(value);
      const selectionIndex = item.raw.selidx; if (selectionIndex !== undefined && typeof selectionIndex !== 'bigint') throw new Error('Invalid scene selection index');
      return { ...item, index, text: optionalString(item.raw.text, 'choice text'), tag: optionalString(item.raw.tag, 'choice tag'), selectionIndex }; }),
    selectInfo: field('selectInfo') };
}
