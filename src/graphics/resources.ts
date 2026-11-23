import { ImageCatalog } from './image-catalog.ts';
import { PimgCatalog } from './pimg-catalog.ts';
import { MtnCatalog } from './mtn-catalog.ts';
import type { ImageCatalogOptions } from './image-types.ts';

/** Prepared graphics only. The scene compositor and motion timeline own drawing. */
export class GraphicsResources {
  readonly images: ImageCatalog; readonly pimgImages: ImageCatalog; readonly pimg: PimgCatalog;
  readonly mtnImages?: ImageCatalog; readonly mtn?: MtnCatalog;
  private constructor(images: ImageCatalog, pimgImages: ImageCatalog, pimg: PimgCatalog, mtnImages?: ImageCatalog, mtn?: MtnCatalog) {
    this.images = images; this.pimgImages = pimgImages; this.pimg = pimg; this.mtnImages = mtnImages; this.mtn = mtn;
  }
  static async open(url: string | URL, options: ImageCatalogOptions = {}, signal?: AbortSignal): Promise<GraphicsResources> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Graphics descriptor HTTP ' + response.status);
    const descriptor = await response.json();
    if (descriptor?.schemaVersion !== 1 || descriptor?.format !== 'senren-web-graphics-v1') throw new Error('Unsupported graphics descriptor');
    const base = new URL('.', response.url || String(url));
    function location(value: unknown): URL {
      if (typeof value !== 'string' || !value) throw new Error('Missing graphics dataset URL');
      const target = new URL(value, base);
      if (target.origin !== base.origin) throw new Error('Graphics datasets must share an origin');
      return target;
    }
    const images = await ImageCatalog.open(location(descriptor.regularImages?.url), options, signal);
    try {
      const pimgImages = await ImageCatalog.open(location(descriptor.pimgImages?.url), options, signal);
      try {
        const pimg = await PimgCatalog.open(location(descriptor.pimgModels?.url), pimgImages, signal);
        if (!descriptor.mtnImages && !descriptor.mtnModels) return new GraphicsResources(images, pimgImages, pimg);
        const mtnImages = await ImageCatalog.open(location(descriptor.mtnImages?.url), options, signal);
        try {
          const mtn = await MtnCatalog.open(location(descriptor.mtnModels?.url), mtnImages, signal);
          return new GraphicsResources(images, pimgImages, pimg, mtnImages, mtn);
        } catch (error) { mtnImages.close(); throw error; }
      } catch (error) { pimgImages.close(); throw error; }
    } catch (error) { images.close(); throw error; }
  }
  close(): void { this.images.close(); this.pimgImages.close(); this.pimg.clear(); this.mtnImages?.close(); this.mtn?.clear(); }
}
