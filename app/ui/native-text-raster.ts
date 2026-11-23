import { NativeFonts } from './native-fonts.ts';
import { nativeInk } from './native-ink.ts';
import type { NativeTextStyle, NativeGlyphTile } from './message-types.ts';

import { ImmutablePixels } from './immutable-pixels.ts';


// The original Chinese regular and bold faces share this ascent/em ratio.
const originalZhAscent = 2167 / 2048;

/** Font glyph mask -> native fixed-point edge/shadow -> immutable pixels. */
export class NativeTextRaster {
  private readonly fontLease?: ReturnType<typeof NativeFonts.acquire>;
  private readonly family: string;
  private closed = false;
  private readonly metrics = new OffscreenCanvas(1,1);
  constructor(root: URL, systemFontFamily?: string) {
    if (systemFontFamily !== undefined) this.family = systemFontFamily;
    else {
      this.fontLease = NativeFonts.acquire(root);
      this.family = '"' + this.fontLease.fonts.family + '"';
    }
  }
  ready() { return this.closed ? Promise.reject(new Error('Native text rasterizer is closed')) : this.fontLease?.fonts.ready() ?? Promise.resolve(); }
  private font(size: number, weight: number): string { return weight + ' ' + size + 'px ' + this.family; }
  private baseline(size: number, weight: number): number {
    return this.fontLease?.fonts.baseline(size, weight) ?? Math.round(size * originalZhAscent);
  }
  async singleLine(text: string, width: number, height: number, style: NativeTextStyle): Promise<ImmutablePixels> {
    if (this.closed || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4194304 || !Number.isInteger(style.size) || style.size < 1 || style.size > 256 || text.length > 16384 || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error('Unsupported native one-line text geometry/content');
    const weight = style.weight ?? 400; await this.ready(); this.fontLease?.fonts.assert(text, weight);
    if (this.closed) throw new Error('Native glyph preparation was closed');
    const padding = Math.max(style.edgeExtent, (style.shadowWidth ?? 0) + Math.max(Math.abs(style.shadowX ?? 0), Math.abs(style.shadowY ?? 0))) + 1;
    if (!Number.isInteger(padding) || padding > 42) throw new Error('Unsupported native glyph padding');
    const mask = new OffscreenCanvas(width + padding * 2, height + padding * 2), drawing = mask.getContext('2d', { willReadFrequently: true });
    if (!drawing) throw new Error('Native glyph mask surface is unavailable');
    drawing.fontKerning = 'none'; drawing.textBaseline = 'alphabetic'; drawing.fillStyle = '#fff';
    // Keep original integer advances. Fit a local-font label only if it exceeds its box.
    const letters = Array.from(text);
    let size = style.size, total: number, ascent: number, descent: number, glyphs: number[];
    for (;;) {
      drawing.font = this.font(size, weight);
      total = ascent = descent = 0;
      glyphs = letters.map(letter => {
        const metric = drawing.measureText(letter), step = Math.round(metric.width);
        total += step;
        ascent = Math.max(ascent, metric.actualBoundingBoxAscent);
        descent = Math.max(descent, metric.actualBoundingBoxDescent);
        return step;
      });
      if (total <= width && (this.fontLease || ascent + descent <= height)) break;
      if (this.fontLease || size === 1) throw new Error('Native single-line text exceeds its original rectangle; overflow handling is required');
      size = Math.max(1, Math.min(size - 1, Math.floor(size * Math.min(width / Math.max(1, total), height / Math.max(1, ascent + descent)))));
    }
    const align = style.align ?? -1, valign = style.valign ?? 0;
    let x = padding + (align < 0 ? 0 : align > 0 ? width - total : Math.floor((width - total) / 2));
    const top = valign < 0 ? 0 : valign > 0 ? height - size : Math.floor((height - size) / 2);
    const nominal = top + this.baseline(size, weight);
    const baseline = padding + (this.fontLease ? nominal : Math.max(ascent, Math.min(height - descent, nominal)));
    for (const [index, letter] of letters.entries()) { drawing.fillText(letter, x, baseline); x += glyphs[index]; }
    const ink = nativeInk(drawing.getImageData(0, 0, mask.width, mask.height), style), tinted = new OffscreenCanvas(mask.width, mask.height), paint = tinted.getContext('2d');
    if (!paint) throw new Error('Native glyph ink surface is unavailable'); paint.putImageData(ink, 0, 0);
    const result = new OffscreenCanvas(width, height), output = result.getContext('2d'); if (!output) throw new Error('Native glyph output surface is unavailable');
    output.drawImage(tinted, -padding, -padding); return ImmutablePixels.copy(result);
  }
  /** Native CustomMessageLineLayer keeps ink on the line and foreground on its divider child. */
  async glyph(text: string, style: NativeTextStyle): Promise<NativeGlyphTile> {
    if (this.closed || !text || text.length > 4096 || /[\u0000-\u0008\u000a-\u001f\u007f]/u.test(text) || !Number.isInteger(style.size) || style.size < 1 || style.size > 256) throw new Error('Unsupported native message glyph');
    const weight = style.weight ?? 400; await this.ready(); this.fontLease?.fonts.assert(text, weight);
    if (this.closed) throw new Error('Native glyph preparation was closed');
    const padding = Math.max(style.edgeExtent, (style.shadowWidth ?? 0) + Math.max(Math.abs(style.shadowX ?? 0), Math.abs(style.shadowY ?? 0))) + 1;
    if (!Number.isInteger(padding) || padding < 1 || padding > 42) throw new Error('Unsupported native glyph padding');
    const measure = this.metrics.getContext('2d'); if (!measure) throw new Error('Native glyph metrics surface is unavailable');
    const font = this.font(style.size, weight); measure.font = font; measure.fontKerning = 'none'; measure.textBaseline = 'alphabetic';
    const baseline = this.baseline(style.size, weight), letters: { text: string; x: number }[] = [];
    let advance = 0, inkLeft = 0, inkRight = 0, ascent = 0, descent = 0;
    for (const character of text) {
      const metric = measure.measureText(character); letters.push({ text: character, x: advance });
      inkLeft = Math.min(inkLeft, advance - metric.actualBoundingBoxLeft); inkRight = Math.max(inkRight, advance + metric.actualBoundingBoxRight);
      ascent = Math.max(ascent, metric.actualBoundingBoxAscent); descent = Math.max(descent, metric.actualBoundingBoxDescent); advance += Math.round(metric.width);
    }
    const left = Math.floor(inkLeft) - padding, top = Math.floor(Math.min(0, baseline - ascent)) - padding;
    const width = Math.ceil(Math.max(advance, inkRight)) - left + padding, height = Math.ceil(Math.max(style.size, baseline + descent)) - top + padding;
    if (![advance, left, top, width, height].every(Number.isSafeInteger) || advance < 0 || width < 1 || height < 1 || width > 8192 || width * height > 1048576) throw new Error('Native message glyph tile exceeds budget');
    const mask = new OffscreenCanvas(width, height), drawing = mask.getContext('2d', { willReadFrequently: true }); if (!drawing) throw new Error('Native glyph mask surface is unavailable');
    drawing.font = font; drawing.fontKerning = 'none'; drawing.textBaseline = 'alphabetic'; drawing.fillStyle = '#fff';
    for (const letter of letters) drawing.fillText(letter.text, letter.x - left, baseline - top);
    const coverage = drawing.getImageData(0, 0, width, height); mask.width=mask.height=0;
    let background: ImmutablePixels | undefined, face: ImmutablePixels | undefined;
    try {
      // Native ink is already a straight-alpha pixel buffer; upload it once without round-tripping it through two canvases.
      background = new ImmutablePixels(nativeInk(coverage, style, false));
      face = new ImmutablePixels(nativeInk(coverage, { color: style.color, edgeColor: 0, edgeExtent: 0, edgeEmphasis: 0 }));
      if (this.closed) throw new Error('Native glyph preparation was closed');
      const inkPixels = background, facePixels = face;
      return { advance, left, top, background: inkPixels, face: facePixels, close() { inkPixels.close(); facePixels.close(); } };
    } catch (error) { background?.close(); face?.close(); throw error; }
  }
  close()       { if (!this.closed) { this.closed = true; this.fontLease?.release(); } }
}
