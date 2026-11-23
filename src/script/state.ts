import { numeric, text } from './operators.ts';
import type { ScriptContext, ScriptValue } from './types.ts';
import { PsbResourceLiteral } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';

export interface ScriptSnapshot { readonly globals: { [name: string]: ScriptValue } }
export function cloneScript(value: ScriptValue): ScriptValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneScript);
  const result: { [name: string]: ScriptValue } = Object.create(null);
  for (const [name, child] of Object.entries(value)) result[name] = cloneScript(child); return result;
}
export function scriptValue(value: PsbValue): ScriptValue {
  if (value instanceof PsbResourceLiteral) throw new Error('Binary PSB resources cannot be script values');
  if (Array.isArray(value)) return value.map(scriptValue);
  if (value === null || typeof value !== 'object') return value;
  const result: { [name: string]: ScriptValue } = Object.create(null);
  for (const [name, child] of Object.entries(value)) result[name] = scriptValue(child); return result;
}
export class ScriptState implements ScriptContext {
  private globals: { [name: string]: ScriptValue } = Object.create(null);
  private readonly functions = new Map<string, (args: readonly ScriptValue[]) => ScriptValue>();
  private readonly getters = new Map<string, () => ScriptValue>();
  private systemVersion=0;
  get systemRevision(): number { return this.systemVersion; }
  setMember(base: object, key: string, value: ScriptValue): void {
    const row=base as Record<string, ScriptValue>;
    if (!Object.is(row[key],value) && this.ownsSystemObject(base)) this.systemVersion++;
    row[key]=value;
  }
  private ownsSystemObject(base: object): boolean {
    const root=this.globals.sf;
    if (root===base) return true;
    const pending=[root], seen=new Set<object>();
    while (pending.length) {
      const item=pending.pop();
      if (!item||typeof item!=='object'||seen.has(item)) continue;
      if (item===base) return true;
      seen.add(item); for (const child of Object.values(item)) if (child && typeof child==='object') pending.push(child);
    }
    return false;
  }
  private context: { [name: string]: ScriptValue } | undefined;
  constructor() {
    for (const name of ['f', 'sf', 'tf']) this.globals[name] = Object.create(null);
    this.register('string', args => text(args[0])); this.register('real', args => Number(numeric(args[0])));
    this.register('int', args => { const number = numeric(args[0]); return typeof number === 'bigint' ? BigInt.asIntN(64, number) : BigInt(Math.trunc(number)); });
  }
  read(name: string): ScriptValue {
    if (name === 'this') return this.context;
    const getter = this.getters.get(name); if (getter) return getter();
    if (Object.hasOwn(this.globals, name)) return this.globals[name];
    return this.context && Object.hasOwn(this.context, name) ? this.context[name] : undefined;
  }
  write(name: string, value: ScriptValue): void {
    if (this.getters.has(name) || ['__proto__', 'prototype', 'constructor', 'this'].includes(name)) throw new Error('Unsafe script global assignment');
    if (this.context && !Object.hasOwn(this.globals, name)) this.context[name] = value; else { if (name==='sf'&&!Object.is(this.globals.sf,value))this.systemVersion++; this.globals[name] = value; }
  }
  register(name: string, callback: (args: readonly ScriptValue[]) => ScriptValue): void {
    if (!name || name.split('.').some(part => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Invalid script binding name');
    if (this.functions.has(name)) throw new Error('Duplicate script function binding: ' + name); this.functions.set(name, callback);
  }
  registerGetter(name: string, getter: () => ScriptValue): void {
    if (!name || this.getters.has(name) || ['__proto__', 'prototype', 'constructor', 'this'].includes(name)) throw new Error('Invalid/duplicate script getter');
    this.getters.set(name, getter);
  }
  call(name: string, args: readonly ScriptValue[]): ScriptValue {
    const callback = this.functions.get(name); if (!callback) throw new Error('Unbound script function: ' + name); return callback(args);
  }
  withContext<T>(context: { [name: string]: ScriptValue }, operation: () => T): T {
    const previous = this.context; this.context = context; try { return operation(); } finally { this.context = previous; }
  }
  snapshot(): ScriptSnapshot { return { globals: cloneScript(this.globals) as { [name: string]: ScriptValue } }; }
  restore(snapshot: ScriptSnapshot, preserveSystemFlags = true): void {
    const system = this.globals.sf;
    if (!snapshot.globals || typeof snapshot.globals !== 'object' || Array.isArray(snapshot.globals)) throw new Error('Invalid saved script globals');
    this.globals = cloneScript(snapshot.globals) as { [name: string]: ScriptValue };
    if (preserveSystemFlags) this.globals.sf = system; else this.systemVersion++;
  }
}
