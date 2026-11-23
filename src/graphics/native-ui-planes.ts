import { WebGlStage } from './webgl-stage.ts';
import type { StageQuad, StageTexture } from './webgl-stage.ts';
import type { NativeUiOrder } from './native-ui-order.ts';

export type NativeUiPage = 'fore' | 'back';
/** Original Chinese configuration without a global -d3dmode override. */
export const NATIVE_UI_COMPOSITION_PROFILE = 'kag-layer-nond3d-v1' as const;
export type NativeUiRoot = 'fore.base' | 'back.base' | 'uibase';
export interface NativeUiPublication {
  /** Session-local monotonically increasing identity; restoring also publishes a new generation. */
  readonly generation: number;
  /** Selected by the original page command, never inferred by the compositor/transition. */
  readonly page: NativeUiPage;
}
export interface NativeUiPlane {
  /** Required original parent root. uibase never enters a base transition attachment. */
  readonly root: NativeUiRoot;
  /** Stable within this source and page, including a hidden adapter with no pixels. */
  readonly id: string;
  /** Pixel identity, independent of pose/opacity. Never reuse for different pixels, even after restore. */
  readonly revision: number;
  /** Already-rasterized native UI, NOT a DOM screenshot. Immutable until the page lease is released. */
  readonly source?: TexImageSource;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Native virtual-surface pixels, not CSS coordinates. No implicit stretching to viewport. */
  readonly left: number;
  readonly top: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly opacity: number;
  readonly visible: boolean;
  /** Surface-space x,y,width,height; viewport intersection is performed by the existing Stage. */
  readonly clipRectangle?: readonly [number, number, number, number];
  readonly order: NativeUiOrder;
}
export interface NativeUiPageLease {
  readonly page: NativeUiPage;
  readonly generation: number;
  /** Complete page, including invisible adapters, so visibility does not change original sort slots. */
  readonly planes: readonly NativeUiPlane[];
  /** Idempotent. Releases CPU pixel references, not logical UI state. */
  release(): void;
}
/**
 * Application-owned pure-data double pages + actual native glyph/image rasterization.
 * All mutation/publication happens in NativeSessionDriver's existing queue.
 *
 * publication() returns the current atomic (generation,page). prepare(page,now) only
 * prepares assets/pixels for that committed generation; it MUST NOT switch pages,
 * advance reveal time or publish. acquire pins immutable descriptors and pixels.
 * Both pages belong to one publication generation; acquire must echo it. Readers
 * may retain a lease across a later publish; never mutate/recycle its canvases.
 *
 * Page copy/swap/selection is performed ONLY by the application after finding the
 * corresponding original command. beginWorld/finishWorld/transition completion do
 * not swap pages. Capture/restore both logical pages in the application snapshot;
 * do not serialize Canvas/GL objects. On restore, rebuild pixels then publish once.
 *
 * Restore boundary: await graphics.beginBatch(); restore UI data/assets BEFORE
 * world.restore() (which calls graphics.restore/prepare); restore other state;
 * finally await graphics.endBatch(). Keep this outer batch around any nested world
 * batch and prepare both pages before committing the publication. No frame/begin/
 * capture may observe a half-published UI/world. Failed restores must stay blocked
 * at the application level, not resume a partially reconstructed scene.
 */
export interface NativeUiSource {
  /** Fixed mode, not selected implicitly by the WebGL backend or a plane name. */
  readonly compositionProfile: typeof NATIVE_UI_COMPOSITION_PROFILE;
  publication(): NativeUiPublication;
  prepare(page: NativeUiPage, now: number): Promise<void>;
  acquire(page: NativeUiPage, now: number): NativeUiPageLease;
}
interface Cached { readonly revision: number; readonly width: number; readonly height: number; readonly texture: StageTexture; refs:number }
export interface NativeUiPaintLease {
  readonly page: NativeUiPage;
  readonly planes: readonly NativeUiPlane[];
  readonly quads: ReadonlyMap<string, StageQuad>;
  release(): void;
}
export function nativeUiProfile(source: NativeUiSource): void {
  if (source.compositionProfile !== NATIVE_UI_COMPOSITION_PROFILE) throw new Error('Unsupported or missing native UI composition profile');
}
function validPublication(value: NativeUiPublication): void {
  if (!Number.isSafeInteger(value.generation) || value.generation < 0 || (value.page !== 'fore' && value.page !== 'back')) throw new Error('Invalid native UI publication');
}
function same(a: NativeUiPublication, b: NativeUiPublication): boolean { return a.generation === b.generation && a.page === b.page; }
/** Shared Stage texture ownership; no rendering loop, logical state, page swap or DOM capture. */
export class NativeUiPlanes {
  private readonly pages = new Map<NativeUiPage, Map<string, {source:TexImageSource; key:string; raster:Cached}>>();
  private readonly shared=new WeakMap<TexImageSource,Map<string,Cached>>();
  private drop(entry:{source:TexImageSource;key:string;raster:Cached}):void{
    if(--entry.raster.refs===0){this.shared.get(entry.source)?.delete(entry.key);this.stage.release(entry.raster.texture);}
  }
  private closed = false;
  private leased = false;
  private readonly adapterRoots = new Map<string, NativeUiRoot>();
  constructor(private readonly stage: WebGlStage, private readonly source: NativeUiSource, private readonly byteBudget = 64 * 1024 * 1024) { nativeUiProfile(source); }
  async prepare(now: number): Promise<NativeUiPublication> {
    if (this.closed || !Number.isFinite(now)) throw new Error('Native UI preparation is unavailable');
    nativeUiProfile(this.source);
    const value = this.source.publication(); validPublication(value);
    // Copy primitive identity: an application cannot mutate the reference while awaiting assets.
    const publication = { page: value.page, generation: value.generation };
    await this.source.prepare(publication.page, now);
    nativeUiProfile(this.source);
    const after = this.source.publication(); validPublication(after);
    if (this.closed || !same(publication, after)) throw new Error('Native UI changed outside the session publication boundary');
    return publication;
  }
  /** Pure publication check used after a sound-only callback await. */
  preflight(publication: NativeUiPublication): void {
    if (this.closed || this.leased) throw new Error('Native UI publication is not at an idle boundary');
    nativeUiProfile(this.source); validPublication(publication);
    const current = this.source.publication(); validPublication(current);
    if (!same(publication, current)) throw new Error('Native UI publication changed during a staged frame');
  }
  /** Copy only descriptors, then release CPU pixels immediately. No upload or GL lease. */
  describe(publication: NativeUiPublication, now: number): readonly NativeUiPlane[] {
    this.preflight(publication);
    const lease = this.source.acquire(publication.page, now);
    try {
      if (lease.page !== publication.page || lease.generation !== publication.generation || lease.planes.length > 4096) throw new Error('Native UI descriptor publication mismatch');
      const planes = lease.planes.map(plane => ({ ...plane, source: undefined, order: { ...plane.order }, clipRectangle: plane.clipRectangle ? [...plane.clipRectangle] as [number, number, number, number] : undefined }));
      this.preflight(publication); return planes;
    } finally { lease.release(); }
  }
  acquire(publication: NativeUiPublication, now: number, width: number, height: number): NativeUiPaintLease {
    if (this.closed || this.leased) throw new Error('Native UI texture access is closed or already leased');
    nativeUiProfile(this.source); validPublication(publication);
    if (!same(publication, this.source.publication())) throw new Error('Native UI prepared publication is stale');
    const lease = this.source.acquire(publication.page, now);
    this.leased = true;
    let released = false;
    const release = () => { if (!released) { released = true; this.leased = false; lease.release(); } };
    try {
      if (lease.generation !== publication.generation || lease.page !== publication.page || !same(publication, this.source.publication())) throw new Error('Native UI lease publication mismatch');
      if (lease.planes.length > 4096) throw new Error('Native UI plane budget exceeded');
      const seen = new Set<string>(); let bytes = 0;
      for (const plane of lease.planes) {
        if (plane.root !== 'fore.base' && plane.root !== 'back.base' && plane.root !== 'uibase') throw new Error('Unsupported or missing native UI parent root');
        if (!plane.id || seen.has(plane.id) || !Number.isSafeInteger(plane.revision) || plane.revision < 0) throw new Error('Invalid native UI pixel identity');
        seen.add(plane.id);
        if (![plane.pixelWidth, plane.pixelHeight].every(value => Number.isSafeInteger(value) && value > 0) || ![plane.left, plane.top, plane.scaleX, plane.scaleY, plane.opacity].every(Number.isFinite) || plane.opacity < 0 || plane.opacity > 1 || typeof plane.visible !== 'boolean') throw new Error('Invalid native UI geometry');
        if (plane.clipRectangle && (!plane.clipRectangle.every(Number.isFinite) || plane.clipRectangle[2] < 0 || plane.clipRectangle[3] < 0)) throw new Error('Invalid native UI clip');
        if (plane.visible && !plane.source) throw new Error('Visible native UI plane has no pixels');
        if (plane.source) bytes += plane.pixelWidth * plane.pixelHeight * 4;
      }
      if (!Number.isSafeInteger(bytes) || bytes > this.byteBudget) throw new Error('Native UI page texture budget exceeded');
      const roots = new Map(this.adapterRoots);
      for (const plane of lease.planes) if (plane.order.kind === 'adapter') {
        const id = plane.order.adapterId, root = roots.get(id);
        if (!id || root !== undefined && root !== plane.root) throw new Error('Native UI adapter identity changed parent root');
        roots.set(id, plane.root);
      }
      for (const [id, root] of roots) this.adapterRoots.set(id, root);
      let cache = this.pages.get(lease.page);
      if (!cache) { cache = new Map(); this.pages.set(lease.page, cache); }
      // The same immutable glyph may occur multiple times and on both pages. Retain a single texture for those uses.
      const desired=new Map(lease.planes.map(p=>[p.id,p]));
      for(const [id,entry] of cache){
        const p=desired.get(id);
        if(!p||p.source!==entry.source||entry.key!==p.revision+'/'+p.pixelWidth+'/'+p.pixelHeight){this.drop(entry);cache.delete(id);}
      }
      const quads=new Map<string,StageQuad>();
      for(const plane of lease.planes){
        const source=plane.source;if(!source)continue;
        let entry=cache.get(plane.id);
        if(!entry){
          const key=plane.revision+'/'+plane.pixelWidth+'/'+plane.pixelHeight;
          let byVersion=this.shared.get(source);if(!byVersion){byVersion=new Map();this.shared.set(source,byVersion);}
          let raster=byVersion.get(key);
          if(!raster){raster={revision:plane.revision,width:plane.pixelWidth,height:plane.pixelHeight,texture:this.stage.upload(source,plane.pixelWidth,plane.pixelHeight),refs:0};byVersion.set(key,raster);}
          raster.refs++;entry={source,key,raster};cache.set(plane.id,entry);
        }
        const cached=entry.raster;
        const matrix = new Float32Array([2 * plane.scaleX / width, 0, 0, 0, 0, -2 * plane.scaleY / height, 0, 0, 0, 0, 1, 0, 2 * plane.left / width - 1, 1 - 2 * plane.top / height, 0, 1]);
        quads.set(plane.id, { texture: cached.texture, matrix, opacity: plane.opacity, visible: plane.visible, order: 0, blend: 'normal', clipRectangle: plane.clipRectangle });
      }
      return { page: lease.page, planes: lease.planes, quads, release };
    } catch (error) { release(); throw error; }
  }
  close(): void {
    if (this.closed) return; this.closed = true;
    for (const page of this.pages.values()) for (const cached of page.values()) this.drop(cached);
    this.pages.clear(); this.adapterRoots.clear();
  }
}
