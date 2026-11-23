export interface DelimitedRow { readonly line: number; readonly cells: readonly string[] }
/** CSV/TSV data only, with quoted newlines, doubled quotes and exact empty trailing cells. */
export function delimitedRows(source: string, separator: ',' | '\t' = ','): readonly DelimitedRow[] {
  if (source.length > 32*1024*1024) throw new Error('Delimited source exceeds budget');
  const rows: DelimitedRow[] = []; let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, firstLine = 1;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const field = () => { cells.push(cell); cell = ''; closed = false; };
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) { if (char === '"') { if (source[at+1] === '"') { cell += '"'; at++; } else { quoted = false; closed = true; } } else { cell += char; if (char === '\n') line++; } continue; }
    if (char === separator) { field(); continue; }
    if (char === '\r' || char === '\n') { if (char === '\r' && source[at+1] === '\n') at++; field(); rows.push({ line: firstLine, cells }); cells = []; line++; firstLine = line; continue; }
    if (char === '"' && !cell && !closed) { quoted = true; continue; }
    if (closed && char !== ' ' && char !== '\t') throw new Error('Text after closing CSV quote at line ' + line);
    if (!closed) cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote at line ' + firstLine); if (cell || cells.length || closed) { field(); rows.push({ line: firstLine, cells }); } return rows;
}
