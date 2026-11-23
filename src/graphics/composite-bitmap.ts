const composed = new WeakSet<ImageBitmap>();

/** Adopt the premultiplied backing bitmap of an authored 2D composition.
 * The canvas is scratch only. Never keep both its rendering context and a pixel lease. */
export function takeCompositeBitmap(canvas:OffscreenCanvas):ImageBitmap {
  try {
    const bitmap=canvas.transferToImageBitmap();
    composed.add(bitmap);
    return bitmap;
  } finally { canvas.width=0; }
}
export function isCompositeBitmap(bitmap:ImageBitmap):boolean { return composed.has(bitmap); }
