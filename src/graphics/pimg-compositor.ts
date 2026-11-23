import type { PimgDocument } from './pimg-catalog.ts';
import { pimgLayout } from './pimg-layout.ts';
import type { PimgLayer, PimgLayout } from './pimg-layout.ts';

export interface PimgSelection {
  readonly layers: readonly number[];
  readonly stacking: 'front-first' | 'back-first';
  /** Text-backed PSD keeps raster paint order flat; folder rows may be appended after every raster. */
  readonly rasterOrder?: 'native-flat';
  readonly ignoreStoredVisibility?: boolean;
  readonly overrides?: ReadonlyMap<number, { readonly visible?: boolean; readonly opacity?: number }>;
}

/** Normal PIMG raster/group composition. Other runtime layer effects have separate renderers. */
export class PimgCompositor {
  readonly layout: PimgLayout;
  private readonly document: Pick<PimgDocument,'acquireImage'>;
  constructor(document: Pick<PimgDocument,'acquireImage'> & Partial<Pick<PimgDocument,'reader'>>, layout?: PimgLayout) {
    if (!layout && !document.reader) throw new Error('Missing composite image layout'); this.document = document; this.layout = layout ?? pimgLayout(document.reader!);
  }

  async compose(selection: PimgSelection): Promise<OffscreenCanvas> {
    const selected = new Set<number>(), necessary = new Set<number>();
    const descendants = (id: number) => {
      if (selected.has(id)) return; selected.add(id);
      for (const child of this.layout.children.get(id) ?? []) descendants(child);
    };
    for (const id of selection.layers) {
      if (!this.layout.byId.has(id)) throw new Error('Unknown selected PIMG layer');
      descendants(id); let layer = this.layout.byId.get(id);
      while (layer) { necessary.add(layer.id); layer = layer.parentId === undefined ? undefined : this.layout.byId.get(layer.parentId); }
    }
    for (const id of selected) necessary.add(id);
    const canvas = new OffscreenCanvas(this.layout.width, this.layout.height);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('PIMG 2D canvas is unavailable');
    const ordered = (ids: readonly number[]) => selection.stacking === 'front-first' ? [...ids].reverse() : [...ids];
    const draw = async (layer: PimgLayer, destination: OffscreenCanvasRenderingContext2D): Promise<void> => {
      if (!necessary.has(layer.id)) return;
      const override = selection.overrides?.get(layer.id);
      const visible = override?.visible ?? (selection.ignoreStoredVisibility ? true : layer.visible);
      if (!visible) return;
      const opacity = override?.opacity ?? layer.opacity;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 255) throw new Error('Invalid PIMG opacity override');
      const blend: GlobalCompositeOperation = layer.drawType === 2 || layer.drawType === 13 ? 'source-over' : layer.drawType === 16 ? 'multiply' : (() => { throw new Error('Unsupported native raster draw type: ' + layer.drawType); })();
      if (layer.layerType === 2) {
        if (opacity === 255) {
          for (const id of ordered(this.layout.children.get(layer.id) ?? [])) await draw(this.layout.byId.get(id)!, destination);
        } else {
          const group = new OffscreenCanvas(this.layout.width, this.layout.height), groupContext = group.getContext('2d', { alpha: true });
          try {
            if (!groupContext) throw new Error('PIMG group canvas is unavailable');
            for (const id of ordered(this.layout.children.get(layer.id) ?? [])) await draw(this.layout.byId.get(id)!, groupContext);
            destination.save(); try { destination.globalAlpha = opacity / 255; destination.globalCompositeOperation = 'source-over'; destination.drawImage(group, 0, 0); } finally { destination.restore(); }
          } finally { group.width = 0; }
        }
      } else if (selected.has(layer.id) && layer.imageName) {
        const lease = await this.document.acquireImage(layer.imageName);
        try {
          destination.save();
          try { destination.globalAlpha = opacity / 255; destination.globalCompositeOperation = blend; destination.drawImage(lease.bitmap, layer.left, layer.top); }
          finally { destination.restore(); }
        } finally { lease.release(); }
      }
    };
    try {
      if (selection.rasterOrder === 'native-flat') {
        for (const id of ordered(this.layout.layers.filter(layer => layer.layerType === 0).map(layer => layer.id))) await draw(this.layout.byId.get(id)!, context);
      } else for (const id of ordered(this.layout.roots)) await draw(this.layout.byId.get(id)!, context);
      return canvas;
    } catch (error) { canvas.width = 0; throw error; }
  }
}
