export class DataSymbol { readonly name: string; constructor(name: string) { this.name = name; } }
export type DataValue = undefined | null | boolean | bigint | number | string | DataSymbol | DataValue[] | { [key: string]: DataValue };
/** Parse data-only TJS literals. No functions, statements, property calls or script execution. */
export function parseTjsData(source: string): DataValue {
  if (source.length > 4 * 1024 * 1024) throw new Error('TJS data input exceeds budget');
  let at = 0, nodes = 0; const slash = String.fromCharCode(92);
  function space() {
    while (at < source.length) {
      if (/\s/u.test(source[at])) { at++; continue; }
      if (source.startsWith('//', at)) { const end = source.indexOf('\n', at + 2); at = end < 0 ? source.length : end + 1; continue; }
      if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); if (end < 0) throw new Error('Unterminated data comment'); at = end + 2; continue; }
      break;
    }
  }
  function accept(text: string): boolean { space(); if (!source.startsWith(text, at)) return false; at += text.length; return true; }
  function expect(text: string) { if (!accept(text)) throw new Error('Expected ' + text + ' in TJS data at ' + at); }
  function string(): string {
    const quote = source[at++]; let value = '';
    while (at < source.length) {
      const char = source[at++]; if (char === quote) return value;
      if (char !== slash) { value += char; continue; }
      const escaped = source[at++];
      if (escaped === 'n') value += '\n'; else if (escaped === 'r') value += '\r'; else if (escaped === 't') value += '\t';
      else if (escaped === 'x' || escaped === 'u') {
        const length = escaped === 'x' ? 2 : 4, hex = source.slice(at, at + length);
        if (hex.length !== length || !/^[0-9a-f]+$/iu.test(hex)) throw new Error('Invalid TJS data escape');
        value += String.fromCharCode(parseInt(hex, 16)); at += length;
      } else if (escaped === slash || escaped === quote) value += escaped; else throw new Error('Unsupported TJS data escape at ' + at);
    }
    throw new Error('Unterminated TJS data string');
  }
  function numberAtom(depth: number): number | bigint {
    space(); if (++nodes > 1000000 || depth > 128) throw new Error('TJS numeric data exceeds budget');
    const cast = /^(int|real)\s+/u.exec(source.slice(at)); if (cast) { at += cast[0].length; const value = numberAtom(depth + 1); return cast[1] === 'int' ? BigInt.asIntN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(value))) : Number(value); }
    if (accept('(')) { const value = numberData(depth + 1); expect(')'); return value; }
    const match = /^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9]+(?:[.][0-9]*)?(?:[eE][+-]?[0-9]+)?)/u.exec(source.slice(at)); if (!match) throw new Error('Only literal numeric operands are allowed in data'); at += match[0].length; const raw = match[0];
    return /[.eE]/u.test(raw) && !/^[+-]?0[xX]/u.test(raw) ? Number(raw) : raw.startsWith('-0x') || raw.startsWith('-0X') ? -BigInt(raw.slice(1)) : BigInt(raw.startsWith('+') ? raw.slice(1) : raw);
  }
  function numberData(depth: number, minimum = 0): number | bigint {
    let left = numberAtom(depth); while (true) { space(); const op = source[at], priority = op === '+' || op === '-' ? 1 : op === '*' || op === '/' || op === '%' ? 2 : 0; if (!priority || priority <= minimum || source.startsWith('//', at) || source.startsWith('/*', at)) return left; at++; const right = numberData(depth + 1, priority);
      if (typeof left === 'bigint' && typeof right === 'bigint' && op !== '/') { if (op === '+') left = BigInt.asIntN(64, left + right); else if (op === '-') left = BigInt.asIntN(64, left - right); else if (op === '*') left = BigInt.asIntN(64, left * right); else { if (right === 0n) throw new Error('Numeric data remainder by zero'); left %= right; } }
      else { const a = Number(left), b = Number(right); left = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b; if (!Number.isFinite(left)) throw new Error('Non-finite numeric data expression'); }
    }
  }
  function value(depth: number): DataValue {
    space(); if (++nodes > 1000000 || depth > 128) throw new Error('TJS data tree exceeds budget');
    if (accept('(const)')) return value(depth + 1);
    if (source[at] === '"' || source[at] === "'") return string();
    if (accept('%')) {
      expect('['); const object: { [key: string]: DataValue } = Object.create(null);
      if (accept(']')) return object;
      while (true) {
        space(); let key: string;
        if (source[at] === '"' || source[at] === "'") key = string();
        else { const match = /^[$_\p{ID_Start}][$_\p{ID_Continue}]*/u.exec(source.slice(at)); if (!match) throw new Error('Invalid TJS data dictionary key'); key = match[0]; at += key.length; }
        if (!accept('=>') && !accept(':')) expect(','); if (Object.hasOwn(object, key)) throw new Error('Duplicate TJS data key: ' + key); object[key] = value(depth + 1);
        if (accept(']')) return object; expect(','); if (accept(']')) return object;
      }
    }
    if (accept('[')) {
      const array: DataValue[] = []; if (accept(']')) return array;
      while (true) {
        if (accept(',')) { array.push(undefined); if (accept(']')) return array; continue; }
        array.push(value(depth + 1)); if (accept(']')) return array; expect(','); if (accept(']')) return array;
      }
    }
    const number = /^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9]+(?:[.][0-9]*)?(?:[eE][+-]?[0-9]+)?)/u.exec(source.slice(at));
    if (number || /^(int|real)\s+/u.test(source.slice(at)) || source[at] === '(') return numberData(depth);
    const name = /^[$_\p{ID_Start}][$_\p{ID_Continue}]*/u.exec(source.slice(at));
    if (name) {
      at += name[0].length; let symbol = name[0]; while (source[at] === '.') { at++; const part = /^[$_\p{ID_Start}][$_\p{ID_Continue}]*/u.exec(source.slice(at)); if (!part) throw new Error('Invalid qualified data symbol'); symbol += '.' + part[0]; at += part[0].length; }
      if (symbol === 'void') return undefined; if (symbol === 'null') return null; if (symbol === 'true') return true; if (symbol === 'false') return false; return new DataSymbol(symbol);
    }
    throw new Error('Unsupported TJS data token at ' + at);
  }
  const result = value(0); space(); accept(';'); space(); if (at !== source.length) throw new Error('Unexpected TJS data suffix at ' + at); return result;
}
