
import type { NativeInkStyle } from './message-types.ts';
/** Fixed-point native character blur, from the pinned TVPChBlurCopy/fast_int_hypot semantics.
 * Uses actual glyph coverage, never Canvas strokeText/CSS text-shadow. */
function blurred(alpha: Uint8Array, width: number, height: number, radius: number, level: number): Uint8Array {
  const result = new Uint8Array(alpha.length);
  if (radius === 0) { if (level === 255) return alpha.slice(); for (let i = 0; i < alpha.length; i++) result[i] = Math.min(255, alpha[i] * level >>> 8); return result; }
  const kernel: { x: number; y: number; weight: number }[] = []; let sum = 0;
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    const a = Math.max(Math.abs(x), Math.abs(y)), b = Math.min(Math.abs(x), Math.abs(y)), t = b + (b >> 1);
    const distance = a - (a >> 5) - (a >> 7) + (t >> 2) + (t >> 6);
    if (distance <= radius) { const weight = radius - distance + 1; kernel.push({ x, y, weight }); sum += weight; }
  }
  const scale = Math.floor(262144 / sum);
  for (const tap of kernel) {
    const weight = tap.weight * scale * level >> 8;
    for (let y = Math.max(0, -tap.y); y < Math.min(height, height - tap.y); y++) for (let x = Math.max(0, -tap.x); x < Math.min(width, width - tap.x); x++) {
      const source = alpha[y * width + x]; if (!source) continue;
      const target = (y + tap.y) * width + x + tap.x;
      result[target] = Math.min(255, result[target] + (source * weight >> 18));
    }
  }
  return result;
}
function over(target: Uint8ClampedArray, at: number, color: number, opacity: number): void {
  if (!opacity) return;
  const old = target[at + 3], keep = old * (255 - opacity) / 255, alpha = opacity + keep;
  for (let channel = 0; channel < 3; channel++) { const component = color >>> (16 - channel * 8) & 255; target[at + channel] = Math.round((component * opacity + target[at + channel] * keep) / alpha); }
  target[at + 3] = Math.round(alpha);
}
export function nativeInk(mask: ImageData, ink: NativeInkStyle, drawFace = true): ImageData {
  const { width, height } = mask;
  if (!Number.isSafeInteger(width * height) || width * height > 16777216 || !Number.isInteger(ink.edgeExtent) || ink.edgeExtent < 0 || ink.edgeExtent > 8 || !Number.isInteger(ink.edgeEmphasis) || ink.edgeEmphasis < 0 || ink.edgeEmphasis > 8192) throw new Error('Unsupported native glyph ink geometry');
  const alpha = new Uint8Array(width * height); for (let i = 0; i < alpha.length; i++) alpha[i] = mask.data[i * 4 + 3];
  const result = new Uint8ClampedArray(mask.data.length);
  if (ink.shadowLevel) {
    const radius = ink.shadowWidth ?? 0, level = ink.shadowLevel, offsetX = ink.shadowX ?? 0, offsetY = ink.shadowY ?? 0;
    if (![radius, level, offsetX, offsetY].every(Number.isInteger) || radius < 0 || radius > 8 || level < 0 || level > 8192 || Math.abs(offsetX) > 32 || Math.abs(offsetY) > 32) throw new Error('Unsupported native glyph shadow');
    const shadow = blurred(alpha, width, height, radius, level);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const xx = x + offsetX, yy = y + offsetY; if (xx >= 0 && yy >= 0 && xx < width && yy < height) over(result, (yy * width + xx) * 4, ink.shadowColor ?? 0, shadow[y * width + x]); }
  }
  if (ink.edgeEmphasis) {
    const edge = blurred(alpha, width, height, ink.edgeExtent, ink.edgeEmphasis);
    for (let i = 0; i < alpha.length; i++) over(result, i * 4, ink.edgeColor, edge[i]);
  }
  if (drawFace) for (let i = 0; i < alpha.length; i++) over(result, i * 4, ink.color, alpha[i]);
  return new ImageData(result, width, height);
}
