export interface LoopBlock { readonly kind: string; readonly fields: Readonly<Record<string, string | number | boolean>> }
export function parseSli(source: string): readonly LoopBlock[] {
  let at = 0; const blocks: LoopBlock[] = [];
  function space() {
    while (at < source.length) { if (/\s/u.test(source[at])) { at++; continue; }
      if (source[at] === '#' || source.startsWith('//', at)) { const end = source.indexOf('\n', at); at = end < 0 ? source.length : end + 1; continue; } break; }
  }
  function word(): string { space(); const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(at)); if (!match) throw new Error('Invalid SLI identifier'); at += match[0].length; return match[0]; }
  function expect(text: string) { space(); if (!source.startsWith(text, at)) throw new Error('Expected SLI ' + text + ' at ' + at); at += text.length; }
  while (true) {
    space(); if (at >= source.length) return blocks; const kind = word(), fields: Record<string, string | number | boolean> = Object.create(null); expect('{');
    while (true) {
      space(); if (source[at] === '}') { at++; break; } const key = word(); expect('='); space(); let value: string | number | boolean;
      if (source[at] === '"' || source[at] === "'") { const quote = source[at++]; let text = ''; while (at < source.length && source[at] !== quote) { const char = source[at++]; text += char === String.fromCharCode(92) ? source[at++] : char; } expect(quote); value = text; }
      else { const match = /^[^;\s}]+/u.exec(source.slice(at)); if (!match) throw new Error('Missing SLI value'); at += match[0].length; const text = match[0]; value = text.toLowerCase() === 'true' ? true : text.toLowerCase() === 'false' ? false : /^[+-]?[0-9]+$/u.test(text) ? Number(text) : text; if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('SLI number exceeds safe range'); }
      if (Object.hasOwn(fields, key)) throw new Error('Duplicate SLI field'); fields[key] = value; expect(';');
    }
    blocks.push({ kind, fields }); if (blocks.length > 100000) throw new Error('SLI block budget exceeded');
  }
}
