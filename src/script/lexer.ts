import type { ScriptValue } from './types.ts';
export interface Token { readonly kind: 'name' | 'value' | 'operator' | 'end'; readonly text: string; readonly at: number; readonly value?: ScriptValue }
export function tokenize(source: string): Token[] {
  if (source.length > 65536) throw new Error('Script expression exceeds input budget');
  const tokens: Token[] = []; let at = 0;
  const slash = String.fromCharCode(92);
  while (at < source.length) {
    if (/\s/u.test(source[at])) { at++; continue; }
    const start = at, char = source[at];
    if (char === '"' || char === "'") {
      at++; let value = '', closed = false;
      while (at < source.length) {
        const next = source[at++]; if (next === char) { closed = true; break; }
        if (next !== slash) { value += next; continue; }
        if (at >= source.length) throw new Error('Truncated script string escape');
        const escape = source[at++];
        if (escape === 'n') value += '\n'; else if (escape === 'r') value += '\r'; else if (escape === 't') value += '\t';
        else if (escape === 'x' || escape === 'u') {
          const length = escape === 'x' ? 2 : 4, hex = source.slice(at, at + length);
          if (hex.length !== length || !/^[0-9a-f]+$/iu.test(hex)) throw new Error('Invalid script Unicode escape');
          value += String.fromCharCode(parseInt(hex, 16)); at += length;
        } else if (escape === char || escape === slash) value += escape; else throw new Error('Unsupported script escape');
      }
      if (!closed) throw new Error('Unterminated script string'); tokens.push({ kind: 'value', text: source.slice(start, at), value, at: start });
    } else if (/[0-9]/u.test(char)) {
      const match = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|(?:[0-9]+(?:[.][0-9]*)?)(?:[eE][+-]?[0-9]+)?)/u.exec(source.slice(at));
      if (!match) throw new Error('Invalid script number'); at += match[0].length;
      const value = /[.eE]/u.test(match[0]) && !/^0[xX]/u.test(match[0]) ? Number(match[0]) : BigInt(match[0]);
      tokens.push({ kind: 'value', text: match[0], value, at: start });
    } else if (/[$_\p{ID_Start}]/u.test(char)) {
      at++; while (at < source.length && /[$_\p{ID_Continue}]/u.test(source[at])) at++;
      tokens.push({ kind: 'name', text: source.slice(start, at), at: start });
    } else {
      const op = ['===','!==','>>>','<<=','>>=','==','!=','<=','>=','&&','||','<<','>>','+=','-=','*=','/=','%=','&=','|=','^='].find(value => source.startsWith(value, at)) ?? char;
      if (!'()[];.,?:+-*/%~!<>=&|^'.includes(char) && char !== slash) throw new Error('Unsupported script token at ' + at);
      at += op.length; tokens.push({ kind: 'operator', text: op, at: start });
    }
    if (tokens.length > 16384) throw new Error('Script token budget exceeded');
  }
  tokens.push({ kind: 'end', text: '', at }); return tokens;
}
