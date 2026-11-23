import { tokenize } from './lexer.ts';
import { binary, text, truth, unary } from './operators.ts';
import type { Expression, ScriptContext, ScriptValue } from './types.ts';

const precedence: Record<string, number> = { '=':1, '+=':1, '-=':1, '*=':1, '/=':1, '%=':1, '&=':1, '|=':1, '^=':1, '<<=':1, '>>=':1,
  '||':3, '&&':4, '|':5, '^':6, '&':7, '==':8, '!=':8, '===':8, '!==':8, '<':9, '<=':9, '>':9, '>=':9, '<<':10, '>>':10, '>>>':10, '+':11, '-':11, '*':12, '/':12, '%':12 };
precedence[String.fromCharCode(92)] = 12;
function canonical(value: ScriptValue): ScriptValue { return typeof value === 'boolean' ? value ? 1n : 0n : value; }
function memberKey(value: ScriptValue): string {
  const key = text(value); if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe script member'); return key;
}

export function parseExpressionProgram(source: string): Expression {
  const tokens = tokenize(source); let position = 0, depth = 0;
  const peek = () => tokens[position], take = () => tokens[position++];
  const accept = (text: string) => peek().text === text ? (take(), true) : false;
  const expect = (text: string) => { if (!accept(text)) throw new Error('Expected ' + text + ' at ' + peek().at); };
  function expression(minimum = 1): Expression {
    if (++depth > 128) throw new Error('Script expression nesting budget exceeded');
    try {
      const token = take(); let left: Expression;
      if (token.kind === 'value') left = { kind: 'literal', value: token.value };
      else if (token.kind === 'name') {
        if (token.text === 'void') left = { kind: 'literal', value: undefined };
        else if (token.text === 'null') left = { kind: 'literal', value: null };
        else if (token.text === 'true' || token.text === 'false') left = { kind: 'literal', value: token.text === 'true' ? 1n : 0n };
        else left = { kind: 'name', name: token.text };
      } else if (['!', '~', '+', '-'].includes(token.text)) left = { kind: 'unary', op: token.text, value: expression(13) };
      else if (token.text === '.') {
        const property = take(); if (property.kind !== 'name') throw new Error('Expected contextual script member');
        left = { kind: 'member', base: { kind: 'name', name: 'this' }, key: { kind: 'literal', value: property.text } };
      } else if (token.text === '(') {
        const items = [expression()]; while (accept(',')) items.push(expression()); expect(')');
        left = items.length === 1 ? items[0] : { kind: 'sequence', items };
      } else if (token.text === '[') {
        const items: Expression[] = []; if (!accept(']')) { do { items.push(expression()); } while (accept(',')); expect(']'); }
        left = { kind: 'array', items };
      } else throw new Error('Unexpected script token at ' + token.at);
      while (true) {
        if (accept('.')) {
          const property = take(); if (property.kind !== 'name') throw new Error('Expected script member name');
          left = { kind: 'member', base: left, key: { kind: 'literal', value: property.text } }; continue;
        }
        if (accept('[')) { const key = expression(); expect(']'); left = { kind: 'member', base: left, key }; continue; }
        if (accept('(')) {
          const args: Expression[] = []; if (!accept(')')) { do { args.push(expression()); } while (accept(',')); expect(')'); }
          left = { kind: 'call', target: left, args }; continue;
        }
        if (peek().text === '?' && minimum <= 2) { take(); const yes = expression(); expect(':'); left = { kind: 'conditional', condition: left, yes, no: expression(2) }; continue; }
        const op = peek().text, rank = precedence[op]; if (rank === undefined || rank < minimum) break; take();
        const right = expression(rank === 1 ? rank : rank + 1);
        left = rank === 1 ? { kind: 'assign', op, target: left, value: right } : { kind: 'binary', op, left, right };
      }
      return left;
    } finally { depth--; }
  }
  const items: Expression[] = [];
  while (peek().kind !== 'end') {
    if (accept(';')) continue; items.push(expression());
    if (peek().kind !== 'end' && !accept(';') && !accept(',')) throw new Error('Unexpected script suffix at ' + peek().at);
  }
  return items.length === 1 ? items[0] : { kind: 'sequence', items };
}

/** Bounded data expressions and explicitly registered host calls. Never uses eval/Function. */
export class ScriptEngine {
  private readonly context: ScriptContext; private readonly programs = new Map<string, Expression>(); private callDepth = 0;
  constructor(context: ScriptContext) { this.context = context; }
  compile(source: string): Expression {
    const cached = this.programs.get(source); if (cached) return cached; const parsed = parseExpressionProgram(source);
    if (this.programs.size >= 512) this.programs.delete(this.programs.keys().next().value!); this.programs.set(source, parsed); return parsed;
  }
  execute(source: string): ScriptValue { return this.evaluate(this.compile(source)); }
  set(path: string, value: ScriptValue): void { this.write(this.compile(path), value, node => this.evaluate(node)); }
  private readMember(base: ScriptValue, key: string): ScriptValue {
    if (base === null || base === undefined || typeof base !== 'object' && typeof base !== 'string') throw new Error('Script member base is not an object');
    if ((Array.isArray(base) || typeof base === 'string') && (key === 'count' || key === 'length')) return BigInt(base.length);
    return Object.hasOwn(Object(base), key) ? (base as { [key: string]: ScriptValue })[key] : undefined;
  }
  private write(target: Expression, value: ScriptValue, evaluate: (node: Expression) => ScriptValue): void {
    if (target.kind === 'name') { this.context.write(memberKey(target.name), value); return; }
    if (target.kind !== 'member') throw new Error('Script assignment target is not a reference');
    const base = evaluate(target.base), key = memberKey(evaluate(target.key));
    if (base === null || typeof base !== 'object') throw new Error('Script assignment base is not an object');
    if (Array.isArray(base) && (!/^[0-9]+$/u.test(key) || Number(key) > 1000000)) throw new Error('Invalid script array assignment');
    if (this.context.setMember) this.context.setMember(base,key,value);
    else (base as { [key: string]: ScriptValue })[key] = value;
  }
  private callName(node: Expression): string {
    if (node.kind === 'name') return memberKey(node.name);
    if (node.kind === 'member' && node.key.kind === 'literal' && typeof node.key.value === 'string') return this.callName(node.base) + '.' + memberKey(node.key.value);
    throw new Error('Script calls require a registered static function name');
  }
  evaluate(program: Expression): ScriptValue {
    let remaining = 100000;
    const run = (node: Expression): ScriptValue => {
      if (--remaining < 0) throw new Error('Script evaluation budget exceeded');
      switch (node.kind) {
        case 'literal': return canonical(node.value);
        case 'name': return canonical(this.context.read(memberKey(node.name)));
        case 'member': return canonical(this.readMember(run(node.base), memberKey(run(node.key))));
        case 'array': return node.items.map(run);
        case 'sequence': { let result: ScriptValue; for (const child of node.items) result = run(child); return result; }
        case 'unary': return canonical(unary(node.op, run(node.value)));
        case 'conditional': return truth(run(node.condition)) ? run(node.yes) : run(node.no);
        case 'binary': {
          const left = run(node.left); if (node.op === '&&') return truth(left) ? run(node.right) : left; if (node.op === '||') return truth(left) ? left : run(node.right);
          return canonical(binary(node.op, left, run(node.right)));
        }
        case 'assign': {
          const value = node.op === '=' ? run(node.value) : canonical(binary(node.op.slice(0, -1), run(node.target), run(node.value)));
          this.write(node.target, value, run); return value;
        }
        case 'call': {
          const name = this.callName(node.target), args = node.args.map(run);
          if (++this.callDepth > 64) { this.callDepth--; throw new Error('Script call nesting budget exceeded'); }
          try { return canonical(this.context.call(name, args)); } finally { this.callDepth--; }
        }
      }
    };
    return run(program);
  }
}
