import { psbArray, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
export type WorldOperation =
  | { readonly kind: 'reset'; readonly keepMusic: PsbValue }
  | { readonly kind: 'create'; readonly name: string; readonly classSpec: PsbValue }
  | { readonly kind: 'delete'; readonly name: string }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  | { readonly kind: 'swap'; readonly from: string; readonly to: string }
  | { readonly kind: 'tag'; readonly tag: PsbValue }
  | { readonly kind: 'update'; readonly name: string; readonly parameters: { [key: string]: PsbValue } };
export interface WorldPlan { readonly before: readonly WorldOperation[]; readonly updates: readonly WorldOperation[]; readonly reverse: readonly WorldOperation[]; readonly reverseBefore: readonly WorldOperation[]; readonly transition: PsbValue | undefined; readonly wait: PsbValue | undefined; readonly messageOff: PsbValue | undefined; readonly raw: { [key: string]: PsbValue } }
function name(value: PsbValue | undefined): string { if (typeof value !== 'string' || !value) throw new Error('Invalid world object name'); return value; }
export function worldOperations(value: PsbValue | undefined): WorldOperation[] {
  if (value === undefined || value === null) return [];
  return psbArray(value).map(item => {
    if (!Array.isArray(item)) { const parameters = psbRecord(item); return { kind: 'update', name: name(parameters.name), parameters }; }
    const op = item[0]; if (typeof op !== 'string') throw new Error('Invalid structural world operation');
    if (op === 'init' && item.length === 2) return { kind: 'reset', keepMusic: item[1] };
    if (op === 'new' && item.length === 3) return { kind: 'create', name: name(item[1]), classSpec: item[2] };
    if (op === 'del' && item.length === 2) return { kind: 'delete', name: name(item[1]) };
    if ((op === 'ren' || op === 'swp') && item.length === 3) return { kind: op === 'ren' ? 'rename' : 'swap', from: name(item[1]), to: name(item[2]) };
    if (op === 'tag' && item.length === 2) return { kind: 'tag', tag: item[1] };
    throw new Error('Unsupported world structural operation: ' + op);
  });
}
export interface SourceWorldState { readonly entities: readonly { readonly name: string; readonly classSpec: PsbValue; readonly parameters: { [key: string]: PsbValue } | undefined }[]; readonly environment: { [key: string]: PsbValue } | undefined }
export function sourceWorldState(snapshot: PsbValue): SourceWorldState {
  const source = psbRecord(snapshot), data = source.data === undefined || source.data === null ? [] : source.data;
  if (!Array.isArray(data)) throw new Error('Invalid original world object list');
  const names = new Set<string>();
  const entities = data.map(item => {
    if (!Array.isArray(item) || item.length !== 3 || typeof item[0] !== 'string' || names.has(item[0])) throw new Error('Invalid original world object record');
    names.add(item[0]); return { name: item[0], classSpec: item[1], parameters: item[2] === null ? undefined : psbRecord(item[2]) };
  });
  return { entities, environment: source.env === undefined || source.env === null ? undefined : psbRecord(source.env) };
}
export function worldPlan(parameters: { [key: string]: PsbValue }): WorldPlan {
  return { before: worldOperations(parameters.pretrans), updates: worldOperations(parameters.update), reverse: worldOperations(parameters.revupdate),
    reverseBefore: worldOperations(parameters.revpretrans), transition: parameters.trans, wait: parameters.wait, messageOff: parameters.msgoff, raw: parameters };
}
