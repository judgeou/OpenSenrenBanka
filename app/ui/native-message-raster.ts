
import { NativeTextRaster } from './native-text-raster.ts';

import { ImmutablePixels, pixelPlane } from './immutable-pixels.ts';
import { layoutMessage, messageCells } from './native-message-layout.ts';
import type { NativeTextAtom, NativeMessageGeometry, NativeMessageRect, NativeGlyphTile, NativePixelLease, NativeTextStyle, MeasuredMessageCell, MessageLayout } from './message-types.ts';
interface PreparedMessage { another: boolean; autoIndent: 0 | 1; runs: readonly NativeTextAtom[]; displayName: string; geometry: NativeMessageGeometry; wasRead: boolean; bank: Map<string, NativeGlyphTile>; cells: MessageLayout['cells']; layout: MessageLayout; name?: ImmutablePixels; nameRect: NativeMessageRect }




/** Presentation only: never store authored brackets in a dialogue record. */
export function pcDisplayName(value: string): string {
  const name = value.trim();
  return !name || name.startsWith('【') && name.endsWith('】') ? name : '【' + name + '】';
}

const glyphKey = (text: string, size: number) => size + '\u0000' + text;
function dispose(message: PreparedMessage | undefined): void { if (!message) return; for (const tile of message.bank.values()) tile.close(); message.name?.close(); }
/** Default Chinese patch message pipeline. Logical content/reveal mutation remains in NativeWindow.
 * prepare only creates immutable pixel assets; acquire only pins them. No timers, page copies or DOM capture. */
export class NativeMessageRaster {
                   raster: NativeTextRaster;
          prepared: PreparedMessage | undefined;
          closed = false;
  constructor(root: URL, systemFontFamily?: string, private readonly pcDialogue = false) { this.raster = new NativeTextRaster(root, systemFontFamily); }
  ready()                { return this.raster.ready(); }
  async prepare(runs: readonly NativeTextAtom[], name: string, body: NativeMessageGeometry, nameRect: NativeMessageRect, wasRead: boolean, autoIndent: 0 | 1 = 0, another = false): Promise<MessageLayout> {
    if (this.closed) throw new Error('Native message rasterizer is closed');
    const current = this.prepared;
    if (current?.runs === runs && current.displayName === name && current.geometry === body && current.nameRect === nameRect && current.wasRead === wasRead && current.autoIndent === autoIndent && current.another === another) return current.layout;
    const cells = messageCells(runs), bank = new Map<string, NativeGlyphTile>(); let namePixels: ImmutablePixels | undefined, bytes = 0;
    // Active source-06: default edgecolor=wcb25, no edgegrad; source-07 DefaultColors.
    const edgeColor = ((this.pcDialogue && another ? 0x6da79f : 0xb75e74) >> 2) & 0x3f3f3f;
    const style: NativeTextStyle = { size: 39, weight: 400, color: wasRead ? 0xefdfff : 0xffffff, edgeExtent: 1, edgeEmphasis: 1024, edgeColor,
      shadowWidth: 1, shadowLevel: 255, shadowX: 2, shadowY: 2, shadowColor: edgeColor };
    const get = async (text: string, size: number) => {
      const id = glyphKey(text, size); let tile = bank.get(id);
      if (!tile) {
        tile = await this.raster.glyph(text, { ...style, size }); bank.set(id, tile);
        bytes += tile.face.width * tile.face.height * 8;
        if (bytes > 33554432) throw new Error('Native message immutable glyph bank exceeds budget');
      }
      return tile;
    };
    try {
      const measured: MeasuredMessageCell[] = [];
      for (const cell of cells) {
        if (cell.text === '\n') measured.push({ ...cell, advance: 0, rubyAdvance: 0 });
        else measured.push({ ...cell, advance: (await get(cell.text, cell.size)).advance, rubyAdvance: cell.ruby === undefined ? 0 : (await get(cell.ruby, 15)).advance });
      }
      const layout = layoutMessage(measured, body, autoIndent);
      let planeCount = 1, planeBytes = 0;
      for (const cell of layout.cells) {
        const parts: [string, number][] = [[cell.text, cell.size]]; if (cell.ruby) parts.push([cell.ruby, 15]);
        for (const [text, size] of parts) {
          const tile = bank.get(glyphKey(text, size)); if (!tile) throw new Error('Prepared native message glyph is absent');
          planeCount += 2; planeBytes += tile.face.width * tile.face.height * 8;
        }
      }
      if (planeCount > 3800 || planeBytes > 50331648) throw new Error('Native message page plane/texture budget exceeded');
      const label = this.pcDialogue ? pcDisplayName(name) : name.trim();
      if (label) namePixels = await this.raster.singleLine(label, nameRect.width, nameRect.height, { ...style, align: -1, valign: 0 });
      if (this.closed) throw new Error('Native message preparation was closed');
      const next: PreparedMessage = { another, autoIndent, runs, displayName: name, geometry: body, wasRead, bank, cells: layout.cells, layout, name: namePixels, nameRect }, previous = this.prepared; this.prepared = next; dispose(previous); return layout;
    } catch (error) { for (const tile of bank.values()) tile.close(); namePixels?.close(); throw error; }
  }
  acquire(page              , shown        , visible         , width        , height        , bodyPage        , cursor        ) {
    if (this.closed || !Number.isSafeInteger(shown) || shown < 0) throw new Error('Invalid native message reveal publication');
    const message = this.prepared, leases: NativePixelLease[] = [];
    if (visible && !message) throw new Error('Original dialogue glyph assets have not been prepared');
    try {
      if (message) {
        // Only consumed glyphs grow the active line. Future larger glyphs must not move old ink early.
        const lineSizes = new Map<number, number>();
        for (const cell of message.cells) if (cell.page === bodyPage && cell.step <= cursor) lineSizes.set(cell.line, Math.max(lineSizes.get(cell.line) ?? cell.initialLineSize, cell.size));
        for (const [index, cell] of message.cells.entries()) {
          if (cell.page !== bodyPage) continue;
          const show = visible && cell.step <= cursor && cell.revealAt <= shown;
          const y = cell.originY + (lineSizes.get(cell.line) ?? cell.initialLineSize) - cell.size;
          const parts: [string, string, number, number, number][] = [['base', cell.text, cell.size, cell.x, y]];
          if (cell.ruby) parts.push(['ruby', cell.ruby, 15, cell.rubyX, y - 12]);
          for (const [part, text, size, x, top] of parts) {
            const tile = message.bank.get(glyphKey(text, size)); if (!tile) throw new Error('Published native message glyph is absent');
            const paints: [string, ImmutablePixels, number][] = [['ink', tile.background, 0], ['face', tile.face, 1]];
            for (const [kind, pixels, order] of paints) {
              leases.push(pixelPlane(show ? pixels : undefined, { root: page === 'fore' ? 'fore.base' : 'back.base', id: 'message/' + index + '/' + part + '/' + kind,
                left: x + tile.left, top: top + tile.top, scaleX: 1, scaleY: 1, opacity: 1, visible: show, clipRectangle: [0, 0, width, height],
                // Original text child absolute900 precedes name901. Each line's divider faces sit above that line's ink.
                order: { kind: 'absolute', absolute: 1000000, localOrder: 900000000 + cell.line * 8192 + order * 4096 + index * 2 + (part === 'ruby' ? 1 : 0) } }));
            }
          }
        }
        const showName = visible && !!message.name;
        leases.push(pixelPlane(showName ? message.name : undefined, { root: page === 'fore' ? 'fore.base' : 'back.base', id: 'message-name', left: message.nameRect.x, top: message.nameRect.y, scaleX: 1, scaleY: 1, opacity: 1, visible: showName,
          clipRectangle: [0, 0, width, height], order: { kind: 'absolute', absolute: 1000000, localOrder: 901000000 } }));
      }
      return { planes: leases.map(lease => lease.plane)                            , release() { for (const lease of leases) lease.release(); } };
    } catch (error) { for (const lease of leases) lease.release(); throw error; }
  }
  clear()       { const previous = this.prepared; this.prepared = undefined; dispose(previous); }
  close()       { if (!this.closed) { this.closed = true; this.clear(); this.raster.close(); } }
}
