import type { MtnTexture } from './mtn-textures.ts';

// Win PSB texture storage reference: GARbro ArcPSB.cs (MIT; licenses/GARbro-PSB-MIT.txt).
// Kirikiri icon resources may supply an explicit BGRA palette and byte indices.
export function decodeWinTexture(info: MtnTexture, input: Uint8Array, palette?: Uint8Array): Uint8Array {
  const count = info.width * info.height;
  if (!Number.isSafeInteger(count) || count < 1 || count > 64 * 1024 * 1024) throw new Error('MTN pixel budget exceeded');
  const pixelSize = palette === undefined ? 4 : 1;
  if (palette && (palette.length !== 1024 || !['RL', 'RGBA8'].includes(info.format))) throw new Error('Unsupported MTN palette format');
  let source = input, bpp: number;
  if (info.format === 'RL') {
    source = new Uint8Array(count * pixelSize); let src = 0, dst = 0;
    while (dst < source.length) {
      if (src >= input.length) throw new Error('Truncated MTN RL control');
      const control = input[src++], repeat = (control & 128) !== 0, pixels = repeat ? (control & 127) + 3 : control + 1;
      const bytes = pixels * pixelSize;
      if (bytes > source.length - dst || (repeat ? pixelSize : bytes) > input.length - src) throw new Error('MTN RL span exceeds texture');
      if (repeat) {
        for (let i = 0; i < pixels; i++) source.set(input.subarray(src, src + pixelSize), dst + i * pixelSize);
        src += pixelSize;
      } else { source.set(input.subarray(src, src + bytes), dst); src += bytes; }
      dst += bytes;
    }
    bpp = pixelSize;
  } else if (info.format === 'RGBA8') bpp = pixelSize;
  else if (info.format === 'L8') bpp = 1;
  else if (info.format === 'A8L8' || info.format === 'RGBA4444') bpp = 2;
  else throw new Error('Unsupported Win MTN texture format: ' + info.format);
  const stride = (info.format === 'RL' ? info.width : info.fullWidth) * bpp;
  if ((info.height - 1) * stride + info.width * bpp > source.length) throw new Error('MTN texture data is truncated');
  const rgba = new Uint8Array(count * 4);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const src = y * stride + x * bpp, dst = (y * info.width + x) * 4;
    if (palette) {
      const color = source[src] * 4; rgba[dst] = palette[color + 2]; rgba[dst + 1] = palette[color + 1];
      rgba[dst + 2] = palette[color]; rgba[dst + 3] = palette[color + 3];
    } else if (bpp === 4) { rgba[dst] = source[src + 2]; rgba[dst + 1] = source[src + 1]; rgba[dst + 2] = source[src]; rgba[dst + 3] = source[src + 3]; }
    else if (info.format === 'RGBA4444') {
      const word = source[src] | (source[src + 1] << 8); rgba[dst] = ((word >>> 8) & 15) * 17;
      rgba[dst + 1] = ((word >>> 4) & 15) * 17; rgba[dst + 2] = (word & 15) * 17; rgba[dst + 3] = (word >>> 12) * 17;
    } else { rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = source[src]; rgba[dst + 3] = bpp === 2 ? source[src + 1] : 255; }
  }
  return rgba;
}
