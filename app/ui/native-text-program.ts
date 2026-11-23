

/** Converter pending is already parsed, but is not an executed message-layer font. */





/** Finite SCN text program: actual numeric font ratios/default, ruby, escaped literals and newlines.
 * All parsing is data-only. No HTML, script evaluation, unprepared font fallback or swallowed controls. */
import type { NativeTextAtom, NativeTextProgram } from './message-types.ts';
export function nativeTextProgram(body: string, pendingBefore: number | null = null): NativeTextProgram {
  if (body.length > 1048576) throw new Error('Native dialogue exceeds text budget');
  if (pendingBefore !== null && (!Number.isSafeInteger(pendingBefore) || pendingBefore < 1 || pendingBefore > 256)) throw new Error('Invalid converter pending font');
  const atoms: NativeTextAtom[] = []; let size = 39, index = 0, ruby: string | undefined, base = '', remaining = 0;
  let pendingSize                    = pendingBefore;
  function fail(message: string, at = index): never { throw new Error('C3 ' + message + ' at body UTF-16 offset ' + at); }
  // 00852 addTag flushes currentFont; reading a font token alone does not execute it.
  const flushFont = () => { if (pendingSize !== null) { size = pendingSize; pendingSize = null; } };
  const put = (text        ) => {
    if (text.charCodeAt(0) < 32 && text !== '\n' && text !== '\t') fail('unimplemented native dialogue control');
    if (/[\uD800-\uDFFF]/u.test(text)) fail('supplementary/surrogate glyph semantics are not bound');
    if (ruby === undefined) { flushFont(); atoms.push(Object.freeze({ text, size, sourceEnd: index })); }
    else {
      if (text === '\n') fail('ruby crosses a line control');
      base += text;
      if (--remaining === 0) { flushFont(); atoms.push(Object.freeze({ text: base, ruby, size, sourceEnd: index })); ruby = undefined; base = ''; }
    }
    if (atoms.length > 2048) fail('native message cell budget exceeded');
  };
  while (index < body.length) {
    const start = index; let character = body[index++];
    if (character === '\\') {
      if (index === body.length) fail('truncated native dialogue escape', start);
      character = body[index++];
      if (character === 'n') put('\n');
      // Original converter 00852 sends both literal TAB and \t to processCh.
      else if (character === 't') put('\t');
      else if ('wkxir'.includes(character)) fail('inline wait/indent/tab/sp/nul control is not bound: \\' + character, start);
      else put(character);
      continue;
    }
    if (character === '%') {
      if (ruby !== undefined) fail('font control inside unfinished ruby group', start);
      if (body[index] === ';') { index++; pendingSize = 39; continue; }
      const match = /^[0-9]+;?/u.exec(body.slice(index));
      if (!match) {
        const op=body[index];
        if(op&&'frbiseBSCRLpdawtDl'.includes(op))fail('unimplemented authored inline font/style control: %'+op,start);
        // TextTagConverter 00852 VM offset 2151 consumes an unrecognized
        // percent tag through its following semicolon (or end of text), emitting no glyph.
        if(op){const end=body.indexOf(';',index+1);index=end<0?body.length:end+1;}
        continue;
      }
      index += match [0].length;
      const ratio = Number(match [0].replace(';', ''));
      const nextSize = ratio === 0 ? 39 : Math.trunc(39 * (ratio / 100));
      if (!Number.isSafeInteger(nextSize) || nextSize < 1 || nextSize > 256) fail('native font ratio exceeds prepared glyph profile', start);
      pendingSize = nextSize;
      continue;
    }
    if (character === '[') {
      if (ruby !== undefined) fail('overlapping ruby annotation', start);
      const end = body.indexOf(']', index); if (end < 0) fail('unterminated native ruby', start);
      const match = /^([^,\[\]\r\n]*)(?:,([0-9]+))?$/u.exec(body.slice(index, end));
      if (!match) fail('invalid native ruby', start); index = end + 1;
      if (!match [1]) continue;
      remaining = match [2] === undefined ? 1 : Number(match [2]) + 1;
      if (!Number.isSafeInteger(remaining) || remaining < 1 || remaining > 4096 || /[\uD800-\uDFFF]/u.test(match [1])) fail('unsupported native ruby budget/glyph', start);
      ruby = match [1]; continue;
    }
    if ('#$&'.includes(character)) fail('inline color/expression/image program is not bound: ' + character, start);
    put(character);
  }
  if (ruby !== undefined) fail('native ruby exceeds its base text');
  return Object.freeze({ atoms: Object.freeze(atoms), finalSize: size, sourceLength: body.length, pendingBefore, pendingAfter: pendingSize });
}
