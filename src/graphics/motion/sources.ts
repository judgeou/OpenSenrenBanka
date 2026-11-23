import type { PsbValue } from '../../formats/psb-value.ts';
import {MotionGrayscale} from './grayscale.ts';
import type { MtnCatalog } from '../mtn-catalog.ts';
import type { NativeImageRequest } from '../image-request.ts';
import type { PreparedGraphicFrame } from '../prepared-frames.ts';
import { NativeTargetPool } from '../native-target-pool.ts';
import { WebGlStage } from '../webgl-stage.ts';
import type { StageTexture } from '../webgl-stage.ts';
import {MotionAtlasLeases} from './atlas-leases.ts';
import type {MotionAtlasLease} from './atlas-leases.ts';
import { decodeMotionTree } from './nested-program.ts';
import { ChildPlayers } from './child-player.ts';
import { psbRecord } from '../../formats/psb-value.ts';
import { MotionDefinitions } from './definitions.ts';
import type { MotionFrame, MotionSampleLease } from './motion-frame.ts';
import type { MotionActionOutbox, NativeMotionActionPort } from './action-events.ts';
import {allowsMotionCue,rootMotionCue} from './se-profiles.ts';
import {NestedSeCursor} from './nested-se-cursor.ts';
import type {NestedSeKey} from './nested-se-profile.ts';
import { Sd002baActionCursor } from './sd002ba-action-cursor.ts';
import type { NativeMotionActionProfile } from '../native-frame-stage.ts';

import { RasterPlayback } from './raster-playback.ts';
import { AffinePlayback } from './affine-playback.ts';
import { motionIdentity } from './instance-state.ts';
import type { BorrowedMotion } from './instance-state.ts';
const normalize = (name: string): string => name.replaceAll('\\', '/').toLowerCase();
let nextInstance = 1;
/** Concrete source owned by openNativeGraphics. No application-provided MTN callback.
 * The SD001AA raster-tree profile accepts full inheritance and single cubic curves;
 * event-free loops use original source frames; the finite SD001EC nested raster
 * profile uses native reverse priority with a whole-tree <=32 render-item bound.
 * Nonzero Z, special blend, particle/bit4 composite/mesh/parameterized profiles fail explicitly.
 * Default AffineSourceMotion draw calls explicit progressBeforeDraw; GPU sample,
 * save and borrowed snapshots never progress. Unsupported content is rejected
 * before allocating any GPU texture.
 */
export class MotionSources {
  private readonly pool: NativeTargetPool;
  private readonly atlas: MotionAtlasLeases;
  private readonly instances = new Set<() => void>();
  private readonly borrowed = new WeakMap<MotionFrame, (now: number, explicitForce: boolean) => BorrowedMotion>();
  private closed = false;
  private readonly definitions: MotionDefinitions;
  private grayscale: MotionGrayscale|undefined;
  constructor(private readonly stage: WebGlStage, private readonly catalog: MtnCatalog | undefined, private readonly now: () => number, definitions?: string, private readonly actionBinding?: { readonly profile?: NativeMotionActionProfile; readonly outbox: MotionActionOutbox }) {
    if (catalog && definitions === undefined) throw new Error('Original envinit motionDefinitions are required for MTN alias resolution');
    // These are reusable, inactive local render targets; held transition targets keep their leases.
    this.pool = new NativeTargetPool(stage, 24 * 1024 * 1024);
    this.atlas=new MotionAtlasLeases(stage);
    this.definitions = new MotionDefinitions(definitions);
  }
  picture(storage:string):string {const choices=this.definitions.pictureAlternatives(storage);return choices.length?choices[Math.floor(Math.random()*choices.length)]:storage;}
  matches(storage: string): boolean {
    if (/[.]mtn$/iu.test(storage) || this.definitions.has(storage)) return true;
    const key = normalize(storage);
    return this.catalog?.entries.some(entry => {
      const full = normalize(entry.name), base = full.slice(full.lastIndexOf('/') + 1);
      return [full, base, full.replace(/[.]mtn$/u, ''), base.replace(/[.]mtn$/u, '')].includes(key);
    }) ?? false;
  }
  async load(request: NativeImageRequest, scale: number, saved?: PsbValue, previous?: PreparedGraphicFrame): Promise<PreparedGraphicFrame> {
    if (this.closed) throw new Error('MTN source service is closed');
    if (!this.catalog) throw new Error('Prepared MTN catalog is required');
    if (scale !== 1) throw new Error('Unsupported MTN source resolution variant: ' + scale);
    const now = this.time(), borrow = previous?.motion ? this.borrowed.get(previous.motion) : undefined;
    if (saved === undefined && previous?.motion && !borrow) throw new Error('Previous MTN instance belongs to another source runtime');
    const resolved = this.definitions.resolve(request);
    const oldAction=previous?.motion?.actions;
    const model=normalize(resolved.file).split('/').at(-1);
    const retireEvent=saved===undefined&&(oldAction?.profile==='sd002ba-se001-v1'&&model==='sd002.mtn'&&resolved.options.chara==='SD002'&&resolved.options.motion==='SD002BB'||
      oldAction?.profile==='sd003bd-se003-v1'&&model==='sd003.mtn'&&resolved.options.chara==='SD003'&&resolved.options.motion==='SD003CE'||
      oldAction?.profile==='sd101aa-child-se-v1'&&model==='sd101.mtn'&&resolved.options.chara==='SD101'&&resolved.options.motion==='SD101BB2');
    if(retireEvent&&oldAction?.outbox.peek())throw new Error('Cannot retire an unacknowledged native SE');
    // The old BA image was captured at the world transition; BB starts with its
    // own cursor. Only ordinary replacements may borrow a previous pure pose.
    const {motion:requestedMotion, flags}=resolved.options;
    const explicitForce=typeof requestedMotion==='string'&&requestedMotion.length>0&&(flags==null||flags===1||flags===1n||flags==='1');
    const before = saved===undefined&&!retireEvent ? borrow?.(now,explicitForce) : undefined;
    const document = await this.catalog.load(resolved.file), identity = motionIdentity(document, resolved.options, saved, before, this.actionBinding?.profile);
    const cue=rootMotionCue(identity.object,identity.motion);
    const nestedCue=cue&&'timeline' in cue?cue:undefined;
    const eventful=!!cue;
    if(cue) {
      if(!allowsMotionCue(this.actionBinding?.profile,cue))throw new Error('Native motion SE consumer/profile is not installed');
      // Original entrances: AA → BA (001), AC → BD (002), AA → BD (009),
      // and CG → CH (002). The sampled previous pose is not the new event cursor.
      const from=nestedCue?[]:cue.motion==='SD002BA'?['SD002AA']:cue.motion==='SD003BD'?['SD003AC','SD003AA']:['SD003CG'];
      const fresh=before?.model===document.name&&before.object===cue.object&&from.includes(before.motion)&&!oldAction;
      if(identity.continued||!nestedCue&&previous?.motion&&!fresh) throw new Error('Eventful source borrow/Chain/replacement is not implemented');
      this.actionBinding!.outbox.preflight(1);
    } else if (identity.actionState !== undefined) throw new Error('Event state on an event-free motion');
    const program = decodeMotionTree(document, identity.object, identity.motion, eventful&&!nestedCue ? this.actionBinding!.profile : undefined);
    const sourceId = eventful ? this.actionBinding!.outbox.sources.reserve(identity.sourceId) : undefined;
    if(nestedCue&&(document.name.toLowerCase()!==nestedCue.model.toLowerCase()||program.source.sourceRef!==nestedCue.rootRef||!program.children.some(t=>t.frames.some(f=>f.tree?.nestedSe===nestedCue.timeline))))throw Error('Nested SE root lacks its authored child track');
    const cursor = nestedCue ? new NestedSeCursor(nestedCue,sourceId!,this.actionBinding!.outbox,identity.actionState) : eventful ? new Sd002baActionCursor(document, program.source, sourceId!, this.actionBinding!.outbox, identity.actionState) : undefined;
    cursor?.validatePlayback(identity.playback, identity.playback.evaluated);
    if (identity.profile && (identity.profile.lastTime !== program.source.lastTime || identity.profile.loopTime !== program.loopTime)) throw new Error('Saved MTN playback profile differs from the source');
    const playback = new RasterPlayback({ lastTime: program.source.lastTime, loopTime: program.loopTime }, now, identity.playback);
    const childState = saved !== undefined ? psbRecord(saved).children : identity.continued ? before?.children : undefined;
    if (saved !== undefined && childState === undefined) throw new Error('Saved MTN has no layer evaluation state');
    if (childState !== undefined) {
      const row = psbRecord(childState);
      if (row.initialized !== identity.playback.evaluated || row.lastCounter !== identity.playback.counterFrames || row.lastFrame !== identity.playback.evalFrame) throw new Error('Saved/borrowed root and layer evaluation boundaries disagree');
    }
    const children = new ChildPlayers(program, identity.playback.counterFrames, childState);
    const affine = new AffinePlayback(playback, () => children.anyPlaying(), now, identity.affine);
    const evaluate = (frame: number, counter: number, scaledDelta: number) => children.update(frame, counter, scaledDelta);
    const update = (at: number): void => {
      if (!cursor) { playback.advance(at, evaluate); return; }
      this.actionBinding!.outbox.preflightUse(); cursor.preflight('root-progress');
      const prior = playback.capture(at); cursor.validatePlayback(prior, prior.evaluated);
      // Child update includes the ordinary finite post-update geometry boundary.
      // Append only after that completed invocation, never from sample/capture.
      if(cursor instanceof NestedSeCursor){
        const due:NestedSeKey[]=[];
        if(playback.advance(at,(f,c,d)=>children.update(f,c,d,undefined,keys=>due.push(...keys))))cursor.commitProgress(prior,playback.capture(at),at,due);
      }else if (playback.advance(at, evaluate)) cursor.commitProgress(prior, playback.capture(at), at);
    };
    const textures = new Map<string, StageTexture>();
    const atlasLeases:MotionAtlasLease[]=[];
    let released = false, registered = false;
    const release = (): void => { if (released) return; released = true; this.instances.delete(release); if (registered) this.actionBinding!.outbox.sources.remove(sourceId!); for (const lease of atlasLeases.splice(0)) lease.release(); textures.clear(); };
    try {
      const uniqueTextures = new Map(program.textures.map(texture => [texture.key, texture] as const));
      if ([...uniqueTextures.values()].reduce((sum, texture) => sum + texture.width * texture.height * 4, 0) > 64 * 1024 * 1024) throw new Error('MTN source texture budget exceeded');
      // Do not hold every decoded input while creating its GPU counterpart.
      // The retiring picture still leases exactly the textures it can sample.
      for(const [key,tex] of uniqueTextures){
        const lease=await this.atlas.acquire(document,key,tex.width,tex.height);
        if(released||this.closed){lease.release();throw new Error('MTN source service closed during texture load');}
        atlasLeases.push(lease);textures.set(key,lease.texture);
      }
      if (this.closed) throw new Error('MTN source service closed during load');
      const assertLive = (): void => { if (released || this.closed) throw new Error('MTN instance is released'); };
      const actions: NativeMotionActionPort | undefined = cursor ? {
        profile: cursor.profile, sourceId: sourceId!, playSerial: 1, outbox: this.actionBinding!.outbox,
        preflight: ownerId => { assertLive(); this.actionBinding!.outbox.preflightUse(); cursor.preflight(ownerId); const state = playback.capture(this.time()); cursor.validatePlayback(state, state.evaluated); },
        completedActions: () => { assertLive(); this.actionBinding!.outbox.preflightUse(); return cursor.completedActions(); },
        ack: deliveryId => { assertLive(); cursor.ack(deliveryId); },
        retire: () => {
          assertLive(); if (!registered) return;
          const box=this.actionBinding!.outbox;
          if (box.peek()) throw new Error('Cannot retire a source with pending motion work');
          box.sources.remove(sourceId!); registered=false;
        }
      } : undefined;
      const motion: MotionFrame = {
        get actions(){return registered?actions:undefined;},
        isFlip: () => { assertLive(); return affine.isFlip(); },
        updateFlip: (at, speed) => { assertLive(); if (cursor) { this.actionBinding!.outbox.preflightUse(); cursor.preflight('root-flip'); if (speed !== 0 && speed !== 1) throw new Error('Eventful affine layer speed must be 0/1'); } affine.updateFlip(at, speed); },
        waiting: kind => {
          assertLive();
          if (kind === 'movie') return affine.movieWaiting();
          if (kind === 'sync') return program.loopTime < 0 && playback.playing;
          throw new Error('Unknown native MTN wait kind');
        },
        preflightControl: operation => {
          assertLive(); if (cursor) throw new Error('Eventful motion control is not implemented'); playback.preflightControl(operation, this.time());
          // Check only finite data; never call update/progress/leaf sampling here.
          for (const track of program.children) for (const slot of track.frames) {
            if (!slot.child) continue;
            if (slot.child.source.lastTime > Number.MAX_SAFE_INTEGER - 1 || Math.abs(slot.offset) > Number.MAX_SAFE_INTEGER - program.source.lastTime - 1) throw new Error('MTN child control offset exceeds finite range');
          }
          const savedChildren = psbRecord(children.capture());
          for (const item of savedChildren.nodes as PsbValue[]) {
            const child = psbRecord(item).child;
            if (child !== null && Number(psbRecord(psbRecord(child).counter).counterFrames) > Number.MAX_SAFE_INTEGER - 1) throw new Error('MTN child control counter exceeds finite range');
          }
        },
        control: operation => { assertLive(); if (cursor) throw new Error('Eventful motion control is not implemented'); playback.control(operation, this.time(), evaluate); },
        progressBeforeDraw: at => {
          if (released || this.closed) throw new Error('MTN instance is released');
          if (!cursor||registered) update(at);
        }, sample: (now: number, grayscale=false): MotionSampleLease => {
        if (released || this.closed) throw new Error('MTN instance is released');
        if (cursor&&registered) { this.actionBinding!.outbox.preflightUse(); cursor.capture(); } // A retired transition image owns no cursor.
        playback.frame(now); // Validate the read time; sampling never runs progress/updateLayers.
        const quads = children.quads(textures), target = this.pool.acquire(program.width, program.height);
        try { this.stage.render(quads, program.width, program.height, [0, 0, 0, 0], target.target); }
        catch (error) { target.release(); throw error; }
        if(!grayscale)return { texture: target.target.texture, release: () => target.release() };
        try {
          const gray=this.pool.acquire(program.width,program.height);
          try { (this.grayscale??=new MotionGrayscale(this.stage)).apply(target.target.texture,gray.target); }
          catch(error) { gray.release();throw error; }
          return {texture:gray.target.texture,release:()=>gray.release()};
        } finally { target.release(); }
      } };
      this.borrowed.set(motion, (at, explicitForce) => {
        if (released || this.closed) throw new Error('Cannot borrow a released MTN instance');
        // Force may preserve the pure Player/affine timing but never acquires the old
        // nested cue cursor. Publication retires that cursor after the replacement is ready.
        if (cursor && (!explicitForce || !(cursor instanceof NestedSeCursor) || this.actionBinding!.outbox.peek())) throw new Error('Cannot borrow or continue a live eventful motion cursor');
        return { model: document.name, object: identity.object, motion: identity.motion, state: playback.capture(at), affine: affine.capture(at), children: children.capture() };
      });
      if (cursor) { this.actionBinding!.outbox.sources.register(sourceId!, () => { assertLive(); return cursor.capture(); }, saved !== undefined); registered = true; }
      // 009 can capture another old world on this same logical tick. Prepare only
      // the newly created BD's zero-pose; do not advance time or deliver SE here.
      if(saved===undefined&&cue?.motion==='SD003BD'&&before?.motion==='SD003AA'){
        update(now);
        const state=playback.capture(now);
        if(state.counterFrames!==0||state.evalFrame!==0||this.actionBinding!.outbox.peek())throw Error('BD has no clean initial pose');
      }
      this.instances.add(release);
      return { key: 'motion-instance:' + nextInstance++, width: program.width, height: program.height,
        motion, pixelScale: 1, pageWidth: program.width, pageHeight: program.height, offsetX: 0, offsetY: 0,
        nativeSource: { type: 2, opacity: 255, resolutionx: 100, resolutiony: 100, afx: program.originX, afy: program.originY },
        captureState: () => {
          if (released) throw new Error('Cannot save a released MTN instance');
          if (cursor) this.actionBinding!.outbox.preflightUse(); // Export requires a paired, settled collector; registry restore still reads cursor directly.
          const state = playback.capture(this.time());
          cursor?.validatePlayback(state, state.evaluated);
          return { schemaVersion: 1n, backend: cursor ? 'native-mtn-raster-tree-v9' : 'native-mtn-raster-tree-v8', model: document.name, object: identity.object, motion: identity.motion,
            ...(cursor ? { actionProfile: cursor.profile, geometryProfile: cue!.geometry, sourceId: sourceId!, actions: cursor.capture() } : {}),
            ...state, affine: { ...affine.capture(this.time()) }, lastTime: program.source.lastTime, loopTime: program.loopTime, children: children.capture() };
        }, release };
    } catch (error) { release(); throw error; }
  }
  private time(): number { const value = this.now(); if (!Number.isFinite(value) || value < 0) throw new Error('Invalid MTN logical clock'); return value; }
  close(): void { if (this.closed) return; this.closed = true; for (const release of [...this.instances]) release(); this.atlas.close(); this.grayscale?.close(); this.pool.close(); }
}
