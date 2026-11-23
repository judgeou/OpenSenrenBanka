import type { PreparedGraphicFrame } from './prepared-frames.ts';
/** Draw descriptors pin the exact immutable full/half child, not mutable pixels. */
export function standFrameVariants(frames: readonly PreparedGraphicFrame[]): PreparedGraphicFrame {
  if (!frames.length) throw new Error('Stand variants are empty'); const sorted = [...frames].sort((a, b) => b.pixelScale - a.pixelScale);
  let selected = frames[0], closed = false;
  const current = () => { if (closed) throw new Error('Stand variant owner is closed'); return selected; };
  return {
    get key() { return current().key; }, get width() { return current().width; }, get height() { return current().height; },
    get source() { return current().source; }, get motion() { return current().motion; }, get nativeSource() { return current().nativeSource; },
    get pixelScale() { return current().pixelScale; }, get pageWidth() { return current().pageWidth; }, get pageHeight() { return current().pageHeight; },
    get offsetX() { return current().offsetX; }, get offsetY() { return current().offsetY; }, get stand() { return current().stand; },
    get redraw() { return current().redraw; }, get sourceFile() { return current().sourceFile; }, get visibility() { return current().visibility; },
    resolvedFrame: current,
    ...(frames.some(f=>f.preparePixels)&&{preparePixels:()=>current().preparePixels!()}),
    selectScale(scale: number): boolean {
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid stand projection scale'); current();
      const next = sorted.find((_, index) => index === sorted.length - 1 || scale > sorted[index + 1].pixelScale)!;
      if (next === selected) return false; selected = next; return true;
    },
    captureState: () => current().captureState(),
    release() { if (closed) return; closed = true; for (const frame of frames) frame.release(); }
  };
}
