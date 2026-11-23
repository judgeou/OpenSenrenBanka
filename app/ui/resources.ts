import { ImageCatalog } from '../../src/graphics/image-catalog.ts';
import { PimgCatalog } from '../../src/graphics/pimg-catalog.ts';
import { ScenarioCatalog } from '../../src/scenario/catalog.ts';

/** The real image interfaces consumed by the UI; full GraphicsResources also satisfies this contract. */
export interface NativeUiGraphics { readonly images: ImageCatalog; readonly pimg: PimgCatalog }
export interface NativeUiResources {
  readonly graphics: NativeUiGraphics; readonly scenarios: ScenarioCatalog; readonly backgroundId: string;
  close(): void;
}
/** Private self-contained package. No absolute work-tree links or original game program. */
export async function openNativeUiResources(root: URL): Promise<NativeUiResources> {
  if (!['http:', 'https:'].includes(root.protocol) || !root.pathname.endsWith('/')) throw new Error('请通过静态 HTTP(S) 部署打开私有呈现包。');
  const response = await fetch(new URL('catalog.json', root));
  if (!response.ok) throw new Error('私有 UI 包目录不可用');
  const catalog = await response.json();
  if (catalog?.format !== 'senren-ui-delivery-v1' || catalog.width !== 1920 || catalog.height !== 1080 || typeof catalog.backgroundId !== 'string' || !/^[0-9]+$/u.test(catalog.backgroundId)) throw new Error('Unsupported private UI package');
  const images = await ImageCatalog.open(new URL('images/manifest.json', root));
  try {
    const pimgImages = await ImageCatalog.open(new URL('pimg-images/manifest.json', root));
    try {
      const pimg = await PimgCatalog.open(new URL('pimg/models.json', root), pimgImages);
      const scenarios = await ScenarioCatalog.open(new URL('scenarios/', root));
      let closed = false;
      return { graphics: { images, pimg }, scenarios, backgroundId: catalog.backgroundId, close() {
        if (closed) return; closed = true;
        scenarios.clear(); pimg.clear(); images.close(); pimgImages.close();
      } };
    } catch (error) { pimgImages.close(); throw error; }
  } catch (error) { images.close(); throw error; }
}
