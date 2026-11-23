import type { Psb2Reader } from '../formats/psb2/reader.ts';
import type { PsbNode } from '../formats/psb2/types.ts';

export interface MtnTexture {
  readonly key: string; readonly sourceName: string; readonly iconName?: string; readonly format: string;
  readonly width: number; readonly height: number; readonly fullWidth: number; readonly fullHeight: number;
  readonly originX: number; readonly originY: number; readonly pixelIndex: number; readonly paletteIndex?: number;
  readonly sourceRef: number;
}
function property(reader: Psb2Reader, ref: number, key: string): PsbNode | undefined {
  const at = reader.property(ref, key); return at === undefined ? undefined : reader.node(at);
}
function integer(reader: Psb2Reader, ref: number, key: string, fallback?: number): number {
  const node = property(reader, ref, key);
  if (node === undefined || node.kind === 'null') { if (fallback !== undefined) return fallback; throw new Error('Missing MTN ' + key); }
  const value = node.kind === 'integer' ? Number(node.value) : node.kind === 'real' ? node.value : NaN;
  if (!Number.isSafeInteger(value) || value < -32768 || value > 32768) throw new Error('Invalid MTN ' + key);
  return value;
}
function text(reader: Psb2Reader, ref: number, key: string, fallback?: string): string {
  const node = property(reader, ref, key);
  if (node === undefined || node.kind === 'null') { if (fallback !== undefined) return fallback; throw new Error('Missing MTN ' + key); }
  if (node.kind !== 'string') throw new Error('Invalid MTN ' + key); return node.value;
}
export function mtnTextures(reader: Psb2Reader): MtnTexture[] {
  const source = property(reader, reader.header.root, 'source');
  if (source?.kind !== 'object') throw new Error('MTN source dictionary is missing');
  const textures: MtnTexture[] = [];
  function add(sourceName: string, ref: number, iconName?: string) {
    const pixels = property(reader, ref, 'pixel');
    if (pixels?.kind !== 'resource') throw new Error('MTN pixel field is not a resource');
    const palette = property(reader, ref, 'pal');
    if (palette && palette.kind !== 'null' && palette.kind !== 'resource') throw new Error('Invalid MTN palette field');
    const fullWidth = integer(reader, ref, 'width'), fullHeight = integer(reader, ref, 'height');
    const width = iconName === undefined ? integer(reader, ref, 'truncated_width', fullWidth) : fullWidth;
    const height = iconName === undefined ? integer(reader, ref, 'truncated_height', fullHeight) : fullHeight;
    if (width < 1 || height < 1 || fullWidth < width || fullHeight < height) throw new Error('Invalid MTN texture extent');
    textures.push({ key: iconName === undefined ? sourceName : sourceName + '#' + iconName, sourceName, iconName,
      sourceRef: ref, format: text(reader, ref, iconName === undefined ? 'type' : 'compress', 'RGBA8'),
      width, height, fullWidth, fullHeight, originX: integer(reader, ref, 'originX', 0), originY: integer(reader, ref, 'originY', 0),
      pixelIndex: pixels.index, paletteIndex: palette?.kind === 'resource' ? palette.index : undefined });
  }
  for (const entry of source.entries) {
    const item = reader.node(entry.valueOffset); if (item.kind !== 'object') throw new Error('Invalid MTN source member');
    const texture = property(reader, item.offset, 'texture'), icons = property(reader, item.offset, 'icon');
    if (texture?.kind === 'object') add(entry.key, texture.offset);
    else if (icons?.kind === 'object') for (const icon of icons.entries) add(entry.key, icon.valueOffset, icon.key);
    else throw new Error('Unknown MTN source shape: ' + entry.key);
  }
  return textures;
}
