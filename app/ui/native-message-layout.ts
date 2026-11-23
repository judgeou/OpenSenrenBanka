





import type { NativeTextAtom, NativeMessageGeometry, MeasuredMessageCell, MessageLayout, LaidMessageCell, MessageLayoutStep } from './message-types.ts';
const weak = '!.?､･ｧｨｩｪｫｬｭｮｯｰ・？！ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
const following = '%),:;]}｡｣ﾞﾟ。，、．：；゛゜ヽヾゝゞ々’”）〕］｝〉》」』】°′″℃￠％‰　' + weak;
const leading = '\\$([{｢‘“（〔［｛〈《「『【￥＄￡';
/** One ruby group is one original processCh call. Parser atoms preserve source offsets. */
export function messageCells(runs: readonly NativeTextAtom[]): NativeTextAtom[] {
  const cells: NativeTextAtom[] = [];
  for (const run of runs) {
    if (/[\uD800-\uDFFF]/u.test(run.text + (run.ruby ?? ''))) throw new Error('C3 original supplementary/surrogate glyph semantics are not yet bound');
    const size = run.size ?? 39, sourceEnd = run.sourceEnd ?? 0;
    if (run.ruby !== undefined) cells.push({ text: run.text, ruby: run.ruby, size, sourceEnd });
    else for (const text of run.text) cells.push({ text, size, sourceEnd });
  }
  if (cells.length > 2048) throw new Error('Native message cell budget exceeded');
  return cells;
}
/** Original horizontal processCh/reline/initLineLayer: threshold before sizeChanged,
 * growing lineSize; clear2 keeps font. Returns immutable page/step plans, never consumes them. */
export function layoutMessage(cells: readonly MeasuredMessageCell[], geometry: NativeMessageGeometry, autoIndent: 0 | 1 = 0): MessageLayout {
  const { x: left, y: top, width, height, imageWidth } = geometry;
  if (![left, top, width, height, imageWidth].every(Number.isSafeInteger) || left < 0 || top < 0 || width < 79 || height < 51 || left + width > imageWidth) throw new Error('Unsupported original message rectangle');
  const result: LaidMessageCell[] = [], steps: MessageLayoutStep[] = [], spacing = 12;
  let x = 0, originY = 0, line = 0, hanging = 2, last = '', units = 0, page = 0, lineSize = 39, initialLineSize = 39;
  const indentBegins = '「『（‘“〔［｛〈《', indentEnds = '」』）’”〕］｝〉》';
  let indent = 0, indentLevel = 0, indentCharacter = '', afterCr = true;
  const reline = (fontSize        )          => {
    if (originY + spacing + lineSize * 2 >= height) return false;
    originY += lineSize + spacing; x = indent; hanging = 2; line++;
    initialLineSize = lineSize = fontSize; return true;
  };
  const clearPage = (fontSize        ) => {
    if (++page >= 128) throw new Error('Native message automatic-page budget exceeded');
    originY = line = 0; x = indent; hanging = 2; initialLineSize = lineSize = fontSize;
  };
  for (const cell of cells) {
    if (!cell.text || !Number.isSafeInteger(cell.size) || cell.size < 1 || cell.size > 256 || !Number.isSafeInteger(cell.advance) || cell.advance < 0 || !Number.isSafeInteger(cell.rubyAdvance) || cell.rubyAdvance < 0) throw new Error('Invalid original message cell');
    if (cell.size * 2 >= width) throw new Error('C3 font too large for finite original wrap profile');
    if (cell.text === '\n') {
      if (!reline(cell.size)) {
        clearPage(cell.size);
        // The failed return was not consumed. Retry it after clear2 rather than dropping it.
        if (!reline(cell.size)) throw new Error('C3 newline cannot fit a fresh original message page');
      }
    } else {
      const wrap = () => {
        if (x < width - 2 * cell.size) return false;
        if (hanging <= 0) return true;
        if (((last === '' || !leading.includes(last)) && !following.includes(cell.text)) || (last !== '' && weak.includes(last) && weak.includes(cell.text)) || left + x > imageWidth) return true;
        hanging--; return false;
      };
      if (wrap() && !reline(cell.size)) clearPage(cell.size);
      lineSize = Math.max(lineSize, cell.size); units += cell.text.length;
      result.push(Object.freeze({ ...cell, x: left + x, originY: top + originY + spacing, rubyX: left + x + (cell.advance >> 1) - (cell.rubyAdvance >> 1), initialLineSize, line, page, step: steps.length + 1, revealAt: units }));
      x += cell.advance; last = cell.text;
    }
    if (autoIndent) {
      const character = cell.text.charAt(0), begin = indentBegins.indexOf(character), end = indentEnds.indexOf(character);
      if (cell.text === '\n') afterCr = true;
      else {
        if (begin >= 0) { if (afterCr && indentLevel === 0) { indentCharacter = character; indent = x; } indentLevel++; }
        else if (end >= 0) { if (indentLevel === 1 && indentBegins.indexOf(indentCharacter) === end) indent = 0; indentLevel--; }
        afterCr = false;
      }
    }
    steps.push(Object.freeze({ page, units, sourceEnd: cell.sourceEnd, size: cell.size, character: cell.text !== '\n' }));
  }
  return Object.freeze({ cells: Object.freeze(result), steps: Object.freeze(steps), units, pageCount: page + 1 });
}
