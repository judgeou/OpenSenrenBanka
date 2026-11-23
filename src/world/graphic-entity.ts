import { clonePsbValue, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { WorldEntity } from './entity-world.ts';
import type { EntityClassDefinition } from './class-catalog.ts';
import type { NativeProperties, PropertyTarget } from './native-properties.ts';
import { nativeBoolean, nativeNumber } from './native-values.ts';
export interface GraphicFrame { readonly key: string; readonly width: number; readonly height: number; captureState?(): PsbValue; release(): void }
export interface GraphicPresentation { readonly id: string; readonly name: string; readonly definition: EntityClassDefinition; readonly frame: GraphicFrame | undefined; readonly redraw: Readonly<{ [key: string]: PsbValue }> | undefined; readonly properties: Readonly<{ [key: string]: PsbValue }>; readonly link: PsbValue | undefined; readonly type: PsbValue | undefined; readonly visible: boolean }
export interface GraphicEntityPort {
  load(redraw: Readonly<{ [key: string]: PsbValue }>, definition: EntityClassDefinition, previous?: GraphicFrame, savedState?: PsbValue): Promise<GraphicFrame | undefined>;
  preparingWorldTransition?(): boolean;
  defaults(definition: EntityClassDefinition, frame: GraphicFrame | undefined): Readonly<{ [key: string]: PsbValue }>;
  publish(presentation: GraphicPresentation): void; remove(id: string): void; after?(id:string,parameters:Readonly<{[key:string]:PsbValue}>):Promise<void>;
  transition(id: string, previous: GraphicPresentation, next: GraphicPresentation, parameters: Readonly<{ [key: string]: PsbValue }>, hideAction: PsbValue | undefined, operation?: Readonly<{[key:string]:PsbValue}>): Promise<{ readonly finished: Promise<void> }>;
}
let nextGraphicEntity = 1;
const propertyNames = new Set(['xpos','ypos','zpos','offsetz','rotate','slantx','slanty','flipx','flipy','offsetx','offsety','rcenterx','rcentery','zcenterx','zcentery','cameraMode','absoluteBase','imagex','imagerotate','imagezoom','originx','originy','originz','left','top','imagey','order','centerx','centery','zoom','zoomx','zoomy','rotx','roty','rotz','opacity','visvalue','fade','level','leveloffset','visible','clipx','clipy','rastercycle','rasterlines','rastervalue','raster','lightColor','lightType','brightness','contrast','rightHandMode']);
/** Native graphical state, image leasing and two-pass actions. Camera, image selectors and effects are explicit renderer services. */
export class GraphicEntity implements WorldEntity, PropertyTarget {
  readonly id = 'graphic-entity-' + nextGraphicEntity++; name: string; readonly classSpec: PsbValue; readonly kind: 'layer' | 'dlayer';
  private readonly definition: EntityClassDefinition; private readonly port: GraphicEntityPort; private readonly actions: NativeProperties;
  private properties: { [key: string]: PsbValue } = Object.create(null); private frame: GraphicFrame | undefined;
  private redraw: { [key: string]: PsbValue } | undefined; private link: PsbValue | undefined; private type: PsbValue | undefined; private visible = false; private closed = false; private fault: Error | undefined; private retired = new Set<GraphicFrame>();
  constructor(name: string, definition: EntityClassDefinition, port: GraphicEntityPort, actions: NativeProperties) {
    if (definition.kind !== 'layer' && definition.kind !== 'dlayer') throw new Error('Non-graphic native class'); this.name = name; this.definition = definition; this.classSpec = definition.name; this.kind = definition.kind; this.port = port; this.actions = actions; actions.attach(this);
  }
  async initialize(): Promise<void> {
    this.actions.stop(this, true); this.properties = Object.create(null); Object.assign(this.properties, this.port.defaults(this.definition, this.frame));
    const init = this.definition.raw.initProps; if (init !== undefined && init !== null) Object.assign(this.properties, clonePsbValue(psbRecord(init))); this.publish();
  }
  async dispose(): Promise<void> { if (this.closed) return; this.closed = true; this.actions.detach(this); this.port.remove(this.id); this.frame?.release(); this.frame = undefined; for (const frame of this.retired) frame.release(); this.retired.clear(); }
  async rename(name: string): Promise<void> { this.name = name; this.publish(); }
  get sourceVisible(): boolean { return this.visible; }
  read(name: string): PsbValue | undefined {
    if (name === 'left') return this.properties.xpos ?? this.properties.left; if (name === 'top') return this.properties.ypos ?? this.properties.top;
    if (name === 'zoom') return this.properties.zoomx ?? this.properties.zoom ?? 100; if (name === 'visible') return nativeNumber(this.properties.visvalue,0)>0;
    if (!propertyNames.has(name) && !name.startsWith('$')) throw new Error('Unknown native graphic property: ' + name); return this.properties[name];
  }
  write(name: string, value: PsbValue): void {
    if (name === 'left') name = 'xpos'; else if (name === 'top') name = 'ypos';
    if (!propertyNames.has(name) && !name.startsWith('$')) throw new Error('Unimplemented native graphic property: ' + name);
    if (name === 'zoom') { this.properties.zoomx = value; this.properties.zoomy = value; } else if(name==='visible'){this.properties.visvalue=nativeBoolean(value)?100:0;delete this.properties.visible;}else this.properties[name] = value; this.publish();
  }
  private presentation(): GraphicPresentation { return { id: this.id, name: this.name, definition: this.definition, frame: this.frame, redraw: this.redraw, properties: { ...this.properties }, link: this.link, type: this.type, visible: this.visible }; }
  private publish(): void { if (!this.closed) this.port.publish(this.presentation()); }
  async update(parameters: Readonly<{ [key: string]: PsbValue }>, restoring = false): Promise<void> {
    if (this.closed) throw new Error('Graphic entity is closed'); if (restoring) this.fault = undefined; else if (this.fault) throw this.fault; const previous = this.presentation(), previousFrame = this.frame;
    if (parameters.redraw !== undefined && parameters.redraw !== null) {
      const redraw = psbRecord(parameters.redraw), frame = await this.port.load(redraw, this.definition, this.frame);
      if (this.closed) { frame?.release(); throw new Error('Graphic entity closed during image load'); }
      this.redraw = clonePsbValue(redraw) as { [key: string]: PsbValue }; this.frame = frame;
    }
    if (parameters.link !== undefined) this.link = clonePsbValue(parameters.link); if (parameters.type !== undefined) this.type = clonePsbValue(parameters.type);
    if (parameters.showmode !== undefined && parameters.showmode !== null) {
      this.visible = (nativeNumber(parameters.showmode) & 1) !== 0;
      // Original objUpdate -> update -> initTarget sets a newly shown target visible=1.
      // A separate object transition alone initializes it hidden and lets its visvalue program reveal it.
      // Apply before scalar/animated SCN properties, which can explicitly override visibility.
      if (this.visible && !previous.visible && (restoring || parameters.trans === undefined || parameters.trans === null || this.port.preparingWorldTransition?.())) this.properties.visvalue = 100;
    }
    this.actions.before(this, parameters.action); this.publish();
    if (!restoring && parameters.trans !== undefined && parameters.trans !== null) {
      let transition: { readonly finished: Promise<void> };
      try { transition = await this.port.transition(this.id, previous, this.presentation(), psbRecord(parameters.trans), parameters.hideact, parameters); }
      catch (error) { if (previousFrame && previousFrame !== this.frame) previousFrame.release(); this.fault = error instanceof Error ? error : new Error(String(error)); throw this.fault; }
      if (previousFrame && previousFrame !== this.frame) { this.retired.add(previousFrame);
        void transition.finished.then(() => { if (this.retired.delete(previousFrame)) previousFrame.release(); }, error => { this.fault = error instanceof Error ? error : new Error(String(error)); if (this.retired.delete(previousFrame)) previousFrame.release(); });
      } else void transition.finished.catch(error => { this.fault = error instanceof Error ? error : new Error(String(error)); });
    } else if (previousFrame && previousFrame !== this.frame) previousFrame.release();
  }
  async after(parameters: Readonly<{ [key: string]: PsbValue }>): Promise<void> { this.actions.after(this, parameters.action); await this.port.after?.(this.id,parameters); this.publish(); }
  async capture(): Promise<PsbValue> {
    if (this.closed) throw new Error('Graphic entity is closed'); if (this.fault) throw this.fault;
    return { schemaVersion: 1n, propertyId: this.id, properties: clonePsbValue(this.properties), redraw: this.redraw ? clonePsbValue(this.redraw) : null, frameState: this.frame?.captureState ? clonePsbValue(this.frame.captureState()) : null, link: this.link === undefined ? null : clonePsbValue(this.link), type: this.type === undefined ? null : clonePsbValue(this.type), visible: this.visible };
  }
  async restore(value: PsbValue): Promise<void> {
    const state = psbRecord(value); if (state.schemaVersion !== 1n) { await this.update(state, true); await this.after(state); return; }
    if (typeof state.propertyId === 'string') this.actions.bindSavedTarget(state.propertyId, this);
    if (this.closed) throw new Error('Graphic entity is closed'); this.fault = undefined;
    const old = this.frame, redraw = state.redraw === null ? undefined : psbRecord(state.redraw), properties = clonePsbValue(psbRecord(state.properties)) as { [key: string]: PsbValue };
    const frame = redraw ? await this.port.load(redraw, this.definition, undefined, state.frameState === null || state.frameState === undefined ? undefined : clonePsbValue(state.frameState)) : undefined;
    if (this.closed) { frame?.release(); throw new Error('Graphic entity closed during restore'); } this.redraw = redraw; this.frame = frame; this.properties = properties; this.link = state.link; this.type = state.type; this.visible = state.visible === true; this.publish(); if (old && old !== this.frame) old.release();
  }
}
