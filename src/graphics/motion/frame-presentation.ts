import type { GraphicPresentation } from '../../world/graphic-entity.ts';
import { nativeNumber } from '../../world/native-values.ts';
import type { NativeGraphicsServices } from '../native-graphics.ts';
import { nativeUiOrder } from '../native-ui-order.ts';
import { nativeSurfaceMatrix } from '../native-layer-painter.ts';
import type { NativePaintLease, NativePreparedLayer } from '../native-layer-painter.ts';
import type { NativeUiPublication, NativeUiPaintLease, NativeUiPlane } from '../native-ui-planes.ts';
import type { NativeTargetLease } from '../native-target-pool.ts';
import type { NativePreparedTransition } from '../native-transition-dispatcher.ts';
import type { StageQuad } from '../webgl-stage.ts';
import type { NativeStagedScene } from './frame-ticket.ts';
import { directTransitions } from '../../runtime/playback-optimizations.ts';

function order(services: NativeGraphicsServices, planes: readonly NativeUiPlane[], page: 'fore' | 'back') {
  const views = services.spatial.ordered();
  const ordered = nativeUiOrder(views.map(view => ({ id: view.id, orderzpos: services.spatial.project(view.id).orderDepth, absoluteBase: nativeNumber(view.properties.absoluteBase, nativeNumber(view.definition.raw.absoluteBase, 0)) })), planes, page);
  return { ordered, byId: new Map(views.map(view => [view.id, view])) };
}
/** No texture acquire/raster/render; same ordered base and drawable gate as paint. */
export function prepareNativeScene(services: NativeGraphicsServices, publication: NativeUiPublication | undefined, now: number): NativeStagedScene {
  const planes = publication ? services.ui!.describe(publication, now) : [];
  const { ordered, byId } = order(services, planes, publication?.page ?? 'fore');
  const layers = new Map<string, NativePreparedLayer | undefined>(), drawables: NativePreparedLayer[] = [];
  let index = 0;
  for (const layer of ordered.base) {
    const at = index++; if (layer.kind !== 'world') continue;
    const view = byId.get(layer.id)!;
    const draw = services.painter.prepareDraw(view, services.spatial, now, services.width, services.height, at);
    layers.set(layer.id, draw); if (draw) drawables.push(draw);
  }
  return { layers, ordered: drawables };
}
export function nativeUiLease(services: NativeGraphicsServices, publication: NativeUiPublication | undefined, now: number): NativeUiPaintLease | undefined {
  if (!services.ui) return;
  if (!publication) throw new Error('Native UI publication is not prepared');
  return services.ui.acquire(publication, now, services.width, services.height);
}
export async function prepareSceneAssets(services:NativeGraphicsServices,views:Iterable<GraphicPresentation>,now:number):Promise<NativeUiPublication|undefined>{
  const publication=await services.ui?.prepare(now),pending=[...views];
  await Promise.all(pending.map(view=>services.painter.prepare(view)));
  for(const view of pending)if(view.frame&&(view.frame as import('../prepared-frames.ts').PreparedGraphicFrame).preparePixels)
    await services.painter.prepareStand(view,services.spatial,services.width,services.height);
  return publication;
}

/** Leases never cross an app await. Old scenes progress in paint; staged scenes
 * use precisely the stored descriptors and cannot progress a second time. */
export function paintNativeScene(services: NativeGraphicsServices, target: NativeTargetLease | undefined, now: number, ui: NativeUiPaintLease | undefined, staged?: NativeStagedScene): StageQuad[] {
  const quads: StageQuad[] = [], overlay: StageQuad[] = [];
  const {stage,width,height}=services;
  let fresh=true;
  const flush=()=>{if(fresh||quads.length)stage.render(quads,width,height,fresh?[0,0,0,1]:null,target?.target);fresh=false;quads.length=0;};
  const finish=services.painter.beginPaint();let painted=false;
  try {
    const { ordered, byId } = order(services, ui?.planes ?? [], ui?.page ?? 'fore');
    let index = 0;
    for (const layer of ordered.base) {
      const at = index++;
      if (layer.kind === 'ui') { const quad = ui?.quads.get(layer.plane.id); if (quad) quads.push({ ...quad, order: at }); continue; }
      const view: GraphicPresentation = byId.get(layer.id)!;
      let paint: NativePaintLease | undefined;
      if (staged) {
        if (!staged.layers.has(layer.id)) throw new Error('Staged scene world order changed');
        const draw = staged.layers.get(layer.id);
        if (draw && (draw.presentation !== view || draw.order !== at)) throw new Error('Staged scene descriptor/order changed');
        if (draw) paint = services.painter.paintPrepared(draw);
        else services.painter.paintSkipped(view, now);
      } else paint = services.painter.paint(view, services.spatial, now, services.width, services.height, at);
      if (paint) {
        // Each projected clip/raster layer owns its temporary surface only until composed.
        try{quads.push(paint.quad);flush();}finally{paint.release();}
      }
    }
    for (const layer of ordered.uibase) { const quad = ui?.quads.get(layer.plane.id); if (quad) overlay.push({ ...quad, order: overlay.length + 1 }); }
    flush();painted=true;return overlay;
  } finally {finish(painted);}
}
export interface NativeFrameScreen { readonly before: NativeTargetLease | undefined; readonly plan: NativePreparedTransition | undefined; readonly displayOnly?: boolean }
export function presentNativeFrame(services: NativeGraphicsServices, now: number, publication: NativeUiPublication | undefined, screen: NativeFrameScreen | undefined, completeScreen: () => void, staged?: NativeStagedScene): void {
  const current = screen?.plan ? services.pool.acquire(services.width, services.height) : undefined;
  let output: NativeTargetLease | undefined, ui: NativeUiPaintLease | undefined;
  try {
    ui = nativeUiLease(services, publication, now);
    const overlay = paintNativeScene(services, current, now, ui, staged);
    if(!current){if(overlay.length)services.stage.render(overlay,services.width,services.height,null);return;}
    const { stage, transitions, width, height } = services, plan = screen!.plan!;
    if (!screen?.before) throw new Error('Timed transition lost its old surface');
    const gl = stage.context(), method = plan.spec.method;
    const direct = directTransitions && screen.displayOnly && plan.opaque &&
      (method === 'crossfade' || method === 'universal' || method === 'mosaic') &&
      gl.drawingBufferWidth === width && gl.drawingBufferHeight === height;
    const before = screen.before.target.texture, after = current.target.texture;
    let complete: boolean;
    if (direct) {
      complete = transitions.render(plan, now, before, after, { width, height });
      if (overlay.length) stage.render(overlay, width, height, null);
    } else {
      output = services.pool.acquire(width, height);
      complete = transitions.render(plan, now, before, after, output.target);
      stage.render([{ texture: output.target.texture, matrix: nativeSurfaceMatrix(width, height), opacity: 1, visible: true, order: 0, blend: 'normal', opaque: true }, ...overlay], width, height);
    }
    if (complete) { transitions.finishAfterPaint(plan); completeScreen(); }
  } finally { try { output?.release(); current?.release(); } finally { ui?.release(); } }
}
