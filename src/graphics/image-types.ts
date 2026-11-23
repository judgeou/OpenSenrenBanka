export interface ImageSourceTag { readonly keyHex: string; readonly valueHex: string; readonly key: string; readonly value: string }
export interface PreparedImage {
  readonly id: string; readonly name: string; readonly file: string; readonly sha256: string; readonly bytes: number;
  readonly width: number; readonly height: number; readonly offsetX: number; readonly offsetY: number;
  readonly sourceOffsetX: number; readonly sourceOffsetY: number; readonly pixelFormat: string;
  readonly sourceTags: readonly ImageSourceTag[]; readonly aliases?: readonly string[];
}
export interface ImageLease { readonly bitmap: ImageBitmap; readonly metadata: PreparedImage; release(): void }
import type {ResourcePrefetch} from '../runtime/resource-prefetch.ts';
export interface ImageCatalogOptions {
  readonly prefetch?:ResourcePrefetch; readonly decodedPixelBudget?: number }
