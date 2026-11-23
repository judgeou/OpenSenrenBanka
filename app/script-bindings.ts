import { BranchBindings } from '../src/world/branch-flags.ts';
import type { BranchRules } from '../src/world/branch-flags.ts';
import type { ScriptState } from '../src/script/state.ts';
import type { ScriptEngine } from '../src/script/expression.ts';
import type { ScriptValue } from '../src/script/types.ts';
import { truth } from '../src/script/operators.ts';
import { parseTjsData } from '../src/formats/tjs-data.ts';
import { originalText } from './original-text.ts';
export function scriptDictionary(state: ScriptState, name: string): Record<string, ScriptValue> {
  const value = state.read(name); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid original dictionary: ' + name); return value;
}
export async function installScriptBindings(root: URL, state: ScriptState, expressions: ScriptEngine, rules: BranchRules): Promise<BranchBindings> {
  const configuration = await originalText(root, 'default.tjs');
  const matches = [...configuration.matchAll(/^\s*[.]clearFlagTagList\s*=\s*(\[[^\]]*\])\s*;/gmu)];
  if (matches.length !== 1) throw new Error('Missing/ambiguous original clearFlagTagList');
  const list = parseTjsData(matches[0][1]); if (!Array.isArray(list) || list.length > 100 || list.some(value => typeof value !== 'string')) throw new Error('Invalid original clearFlagTagList');
  const tags = list.map(value => { if (typeof value !== 'string') throw new Error('Invalid clear-flag name'); return value; });
  const condition = (key: string, positive: boolean): ScriptValue => { const system = scriptDictionary(state, 'sf'); return !truth(system.hselectFix) || (positive ? system[key] : !truth(system[key])); };
  const bindings = new BranchBindings(state, expressions, rules, {
    checkAnyClear: () => { const allSeen = scriptDictionary(state, 'tf').allseen; if (truth(allSeen)) return allSeen; const system = scriptDictionary(state, 'sf'); return tags.some(tag => tag !== '' && truth(system['clear_' + tag])); },
    checkIN: () => condition('hselectOUTIN', false), checkOUT: () => condition('hselectOUTIN', true),
    checkMOUTH: () => condition('hselectMOUTHFACE', true), checkFACE: () => condition('hselectMOUTHFACE', false) });
  bindings.install(); return bindings;
}
