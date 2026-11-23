import { binary, numeric, text, truth } from '../script/operators.ts';
import { ScriptEngine } from '../script/expression.ts';
import type { ScriptState } from '../script/state.ts';
import type { ScriptValue } from '../script/types.ts';
export interface BranchRule { readonly selection: string; readonly value: ScriptValue; readonly weight: number | bigint }
export interface BranchRules { readonly keys: readonly string[]; readonly flags: ReadonlyMap<string, readonly BranchRule[]> }
function record(value: ScriptValue): { [key: string]: ScriptValue } { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected branch dictionary'); return value; }
export function branchRules(value: ScriptValue): BranchRules {
  const data = record(value), definitions = record(data.flags); if (!Array.isArray(data.flagkeys)) throw new Error('Missing branch flag keys');
  const keys = data.flagkeys.map(value => { if (typeof value !== 'string') throw new Error('Invalid branch flag key'); return value; });
  const flags = new Map<string, readonly BranchRule[]>();
  for (const key of keys) {
    const rows = definitions[key]; if (rows === undefined) { flags.set(key, []); continue; }
    if (!Array.isArray(rows)) throw new Error('Invalid branch rule table');
    flags.set(key, rows.map(row => { if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' || typeof row[2] !== 'number' && typeof row[2] !== 'bigint') throw new Error('Invalid branch rule row');
      return { selection: row[0], value: row[1], weight: row[2] }; }));
  }
  return { keys, flags };
}
export async function loadBranchRules(url: string | URL, signal?: AbortSignal): Promise<BranchRules> {
  const response = await fetch(url, { signal }); if (!response.ok) throw new Error('Branch definition HTTP ' + response.status);
  const source = await response.text(); if (source.length > 1024 * 1024) throw new Error('Branch definition exceeds budget');
  const data = JSON.parse(source, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$integer === 'string' && /^[+-]?[0-9]{1,20}$/u.test(value.$integer)) return BigInt(value.$integer); return value;
  });
  if (data?.schemaVersion !== 1 || data.format !== 'prepared-senren-branch-rules-v1' || !Array.isArray(data.keys) || !Array.isArray(data.flags)) throw new Error('Invalid branch definition');
  const flags: { [key: string]: ScriptValue } = Object.create(null); let rows = 0;
  for (const field of data.flags) {
    if (!field || typeof field.key !== 'string' || !Array.isArray(field.rules) || Object.hasOwn(flags, field.key)) throw new Error('Invalid prepared branch table');
    flags[field.key] = field.rules.map((rule: BranchRule) => { rows++; return [rule.selection, rule.value, rule.weight]; });
  }
  if (rows !== data.rows) throw new Error('Branch row count mismatch'); return branchRules({ flagkeys: data.keys, flags });
}
export class BranchBindings {
  private readonly state: ScriptState; private readonly expressions: ScriptEngine; private readonly rules: BranchRules;
  private readonly conditions: Readonly<Record<string, () => ScriptValue>>;
  constructor(state: ScriptState, expressions: ScriptEngine, rules: BranchRules, conditions: Readonly<Record<string, () => ScriptValue>>) { this.state = state; this.expressions = expressions; this.rules = rules; this.conditions = conditions;
    for (const name of ['checkAnyClear', 'checkIN', 'checkOUT', 'checkMOUTH', 'checkFACE']) if (typeof conditions[name] !== 'function') throw new Error('Missing branch condition binding: ' + name);
  }
  install(): void {
    this.state.register('SetBranchFlags', args => { this.set(text(args[0]), args[1]); return undefined; });
    this.state.register('CheckBranchFlags', args => this.check(text(args[0]), args[1]));
    for (const [name, getter] of Object.entries(this.conditions)) this.state.registerGetter(name, getter);
  }
  update(target = record(this.state.read('f'))): { [key: string]: ScriptValue } {
    const game = record(this.state.read('f'));
    for (const key of this.rules.keys) {
      if (!key) continue; delete target[key];
      for (const rule of this.rules.flags.get(key) ?? []) if (truth(binary('==', game[rule.selection], rule.value))) {
        const before = numeric(target[key]), weight = rule.weight; target[key] = typeof before === 'bigint' && typeof weight === 'bigint' ? before + weight : Number(before) + Number(weight);
      }
    }
    return target;
  }
  set(key: string, value: ScriptValue): void {
    if (key) { record(this.state.read('f'))[key] = value; record(this.state.read('sf'))[key] = value; } this.update();
  }
  check(source: string, supplied?: ScriptValue): ScriptValue {
    let context: { [key: string]: ScriptValue };
    if (supplied === undefined) { context = this.update(Object.create(null)); Object.assign(record(this.state.read('f')), context); } else context = record(supplied);
    for (const [name, getter] of Object.entries(this.conditions)) if (!Object.hasOwn(context, name)) Object.defineProperty(context, name, { get: getter, configurable: true });
    return this.state.withContext(context, () => this.expressions.execute(source));
  }
}
