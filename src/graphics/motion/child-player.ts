import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { StageQuad, StageTexture } from '../webgl-stage.ts';
import type { LeafProgram } from './leaf-program.ts';
import type { ChildTrack, MotionTreeProgram } from './nested-program.ts';
import { identity, inherit, leafItems, leafStates,motionLocal } from './leaf-sampler.ts';
import type { Transform } from './leaf-sampler.ts';
import {motionEase} from './curve.ts';
import {crossedNestedSe} from './nested-se-cursor.ts';
import type {NestedSeKey} from './nested-se-profile.ts';
import { assignCounter, counterNumber, freshCounter, progressCounter, readCounter, validateCounter } from './native-counter.ts';
import type { NativeCounterState } from './native-counter.ts';
import { sourceBounds, boundsValue, readSourceBounds } from './source-bounds.ts';
import type { BoundsClip, SourceBounds } from './source-bounds.ts';
import { isEmitterProgram, Sd001Particles } from './sd001-emitters.ts';
interface Clip { program: LeafProgram; state: NativeCounterState; particles?: Sd001Particles; tree?:ChildPlayers }
interface Node { activeSlot: number; slots: [number, number]; playedIndex: number; child: Clip | undefined; root: Transform }
function number(value: PsbValue | undefined, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid saved child Player ' + label);
  return value;
}
const profile = (program: LeafProgram) => ({ lastTime: program.source.lastTime, loopTime: program.loopTime });
/** Native 0x10031F30: persistent dual slots, same-name early return, child offset
 * assignment to counter/eval and BOTH gates, then progress(parent+0x1B8) followed
 * by child updateLayers. No separate timeline.currentTime or second scheduler.
 */
export class ChildPlayers {
  private readonly nodes = new Map<number, Node>();
  private lastCounter: number;
  private lastFrame = 0;
  private root:Transform=identity;
  private initialized = false;
  private postBounds: SourceBounds | undefined;
  constructor(readonly program: MotionTreeProgram, counter: number, saved?: PsbValue) {
    this.lastCounter = counterNumber(counter, 'parent counter');
    for (const track of program.children) this.nodes.set(track.id, { activeSlot: 0, slots: [0, 1], playedIndex: -1, child: undefined, root: identity });
    if (saved !== undefined) this.restore(saved);
  }
  update(frame: number, counter: number, parentScaledDelta: number, root:Transform=identity, emit?: (keys:readonly NestedSeKey[])=>void): void {
    this.root=root;
    counterNumber(counter, 'parent counter'); counterNumber(frame, 'parent evaluation'); counterNumber(parentScaledDelta, 'parent scaled delta');
    if (frame > this.program.source.lastTime) throw new Error('Parent evaluation exceeds native lastTime');
    // Counter/frame can decrease at a native loop. Never gate by elapsed
    // difference; the raw scaled delta is independently supplied for this step.
    const parents = leafStates(this.program.raster, frame,root).states;
    for (const track of this.program.children) {
      const node = this.nodes.get(track.id)!;
      this.select(track, node, frame);
      const index = node.slots[node.activeSlot], active = track.frames[index], other = track.frames[node.slots[node.activeSlot ^ 1]];
      if (!active?.child) { node.child = undefined; node.playedIndex = index; continue; }
      if (node.playedIndex !== index) {
        // Root public play and this child path both reach 0x1004D380's
        // same-motion guard. flags=0 does not replay an unchanged motion.
        if (!node.child || node.child.program.source.sourceRef !== active.child.source.sourceRef) {
          node.child = { program: active.child, state: freshCounter(), particles: isEmitterProgram(active.child) ? new Sd001Particles(active.child) : undefined, tree:active.tree?new ChildPlayers(active.tree,0):undefined };
        }
        const child = node.child;
        if (child.state.playing && child.state.layerGate) {
          // Native 0x10032262..0x100322C1: parent counter, not unwrapped time.
          child.state = assignCounter(profile(child.program), child.state, counter - active.time + active.offset);
        }
        node.playedIndex = index;
      }
      const child = node.child!;
      const prior = child.state, next = progressCounter(profile(child.program), prior, parentScaledDelta, true);
      // Decoder accepts only default child speed=1 and one leaf level. The
      // child outer update evaluates this very counter/eval, then clears +0x98.
      child.state = { ...next, layerGate: false };
      const parent = track.parent === undefined ? root : parents.get(track.parent);
      let opacity = active.opacity;
      if (active.type === 3 && other?.child && other.time > active.time) {
        const ratio = Math.max(0, Math.min(1, (frame - active.time) / (other.time - active.time)));
        opacity = Math.floor(active.opacity * 255 + (other.opacity - active.opacity) * 255 * ratio + 0.5) / 255;
      }
      node.root = parent ? { ...parent, opacity: Math.trunc(Math.round(parent.opacity * 255) * Math.round(opacity * 255) / 255) / 255 } : { ...identity, opacity: 0 };
      if(parent&&active.pose){let [x,y,sx,sy]=active.pose,[angle,skewX,skewY]=active.orientation??[0,0,0];
        if(active.type===3&&other?.pose&&other.child&&other.time>active.time){
          const ratio=Math.max(0,Math.min(1,(frame-active.time)/(other.time-active.time)));
          const r=motionEase(active.positionCurve,ratio),zoom=motionEase(active.zoomCurve,ratio);
          x+=(other.pose[0]-x)*r;y+=(other.pose[1]-y)*r;sx+=(other.pose[2]-sx)*zoom;sy+=(other.pose[3]-sy)*zoom;
          const next=other.orientation??[0,0,0];angle+=(next[0]-angle)*ratio;skewX+=(next[1]-skewX)*ratio;skewY+=(next[2]-skewY)*ratio;
        }
        const local=motionLocal({x,y,scaleX:sx,scaleY:sy,angle,skewX,skewY,opacity,flipX:false,flipY:false},[0,3,2,1]);
        const [px,py]=active.pivot??[0,0];
        node.root=inherit(parent,{...local,x:local.x-local.a*px-local.c*py,y:local.y-local.b*px-local.d*py});
      }
      child.particles?.tick(prior, next, node.root);
      if(child.tree?.program.nestedSe&&emit)emit(crossedNestedSe(child.tree.program.nestedSe,prior,next));
      child.tree?.update(next.evalFrame,next.counterFrames,next.scaledDeltaFrames,node.root,emit);
    }
    this.lastCounter = counter; this.lastFrame = frame; this.initialized = true;
    if (this.program.actionProfile) this.postBounds = sourceBounds(this.program.raster, frame, this.boundClips());
  }
  private select(track: ChildTrack, node: Node, frame: number): void {
    const last = track.frames.length - 2;
    while (node.slots[node.activeSlot] < last && frame >= track.frames[node.slots[node.activeSlot ^ 1]].time) {
      node.activeSlot ^= 1;
      node.slots[node.activeSlot ^ 1] = node.slots[node.activeSlot] + 1;
    }
    while (node.slots[node.activeSlot] > 0 && frame < track.frames[node.slots[node.activeSlot]].time) {
      const previous = node.slots[node.activeSlot] - 1;
      node.activeSlot ^= 1; node.slots[node.activeSlot] = previous;
    }
  }
  private boundClips(): BoundsClip[] {
    const result: BoundsClip[] = [];
    for (const [owner, node] of this.nodes) if (node.child) result.push({ owner, program: node.child.program, frame: node.child.state.evalFrame, root: node.root });
    return result;
  }
  quads(textures: ReadonlyMap<string, StageTexture>,surface=this.program): StageQuad[] {
    if (!this.initialized) throw new Error('MTN sampling requires its first logical progress/update boundary');
    const own = leafItems(this.program.raster, textures, this.lastFrame,this.root,surface), output: { depth: number; quad: StageQuad }[] = [];
    for (const id of this.program.order) {
      const node = this.nodes.get(id);
      if (node?.child?.particles) output.push(...node.child.particles.quads(textures, surface,node.root.opacity,node.child.state.evalFrame,node.root));
      else if(node?.child?.tree)for(const quad of node.child.tree.quads(textures,surface))output.push({depth:0,quad});
      else if (node?.child) {
        for (const quad of leafItems(node.child.program, textures, node.child.state.evalFrame, node.root, surface).values()) output.push({ depth: 0, quad });
      } else { const quad = own.get(id); if (quad) output.push({ depth: 0, quad }); }
    }
    // The original small-list insertion pass sorts accumulated depth ascending,
    // preserving reverse-priority collection order at equal depth.
    return output.sort((a, b) => a.depth - b.depth).map(({ quad }, order) => ({ ...quad, order }));
  }
  anyPlaying(): boolean { for (const node of this.nodes.values()) if (node.child?.state.playing) return true; return false; }
  capture(): PsbValue {
    return { initialized: this.initialized, ...(this.root!==identity?{parentPose:[this.root.a,this.root.b,this.root.c,this.root.d,this.root.x,this.root.y,this.root.opacity]}:{}),lastCounter: this.lastCounter, lastFrame: this.lastFrame,
      ...(this.program.actionProfile ? { bounds: this.postBounds ? boundsValue(this.postBounds) : null } : {}),
      nodes: [...this.nodes].map(([id, node]) => ({ id, activeSlot: node.activeSlot, slots: [...node.slots], playedIndex: node.playedIndex,
        root: [node.root.a,node.root.b,node.root.c,node.root.d,node.root.x,node.root.y,node.root.opacity],
        child: node.child ? { object: node.child.program.source.objectName, motion: node.child.program.source.motionName, counter: { ...node.child.state }, ...(node.child.particles ? { particles: node.child.particles.capture() } : {}),...(node.child.tree?{tree:node.child.tree.capture()}:{}) } : null })) };
  }
  private restore(value: PsbValue): void {
    const row = psbRecord(value);
    if (typeof row.initialized !== 'boolean' || !Array.isArray(row.nodes) || row.nodes.length !== this.nodes.size) throw new Error('Incomplete saved child Player registry');
    const savedCounter = counterNumber(row.lastCounter, 'saved parent counter'), frame = counterNumber(row.lastFrame, 'saved parent evaluation');
    if (savedCounter !== this.lastCounter || frame > this.program.source.lastTime) throw new Error('Invalid saved parent counter/evaluation');
    if(row.parentPose!==undefined){if(!Array.isArray(row.parentPose)||row.parentPose.length!==7)throw Error('Invalid saved subtree transform');const [a,b,c,d,x,y,opacity]=row.parentPose.map(v=>number(v,'subtree transform'));if(opacity<0||opacity>1)throw Error('Invalid saved subtree opacity');this.root={a,b,c,d,x,y,opacity};}
    const seen = new Set<number>();
    for (const item of row.nodes) {
      const saved = psbRecord(item), id = number(saved.id, 'owner'), track = this.program.children.find(value => value.id === id), node = this.nodes.get(id);
      if (!track || !node || seen.has(id) || (saved.activeSlot !== 0 && saved.activeSlot !== 1) || !Array.isArray(saved.slots) || saved.slots.length !== 2 || !Array.isArray(saved.root) || saved.root.length !== 7) throw new Error('Invalid saved child slots');
      seen.add(id);
      const slots = saved.slots.map(value => number(value, 'slot'));
      if (slots.some(value => !Number.isInteger(value) || value < 0 || value >= track.frames.length)) throw new Error('Saved child slot is absent');
      const active = saved.activeSlot, index = slots[active], next = slots[active ^ 1];
      if (index > track.frames.length - 2 || next !== index + 1) throw new Error('Invalid saved dual-slot adjacency');
      const played = number(saved.playedIndex, 'played index');
      if (row.initialized ? played !== index : played !== -1 || active !== 0 || slots[0] !== 0 || slots[1] !== 1 || saved.child !== null) throw new Error('Saved child play cursor mismatch');
      if (row.initialized && (frame < track.frames[index].time || next <= track.frames.length - 2 && frame >= track.frames[next].time)) throw new Error('Saved child slots disagree with parent evaluation');
      const root = saved.root.map(value => number(value, 'root'));
      if (root[6] < 0 || root[6] > 1) throw new Error('Invalid saved child opacity');
      if (this.program.actionProfile) {
        if (root.slice(0, 6).some((value, at) => value !== [1, 0, 0, 1, 0, 0][at])) throw new Error('Saved SD002BA child root differs from the guarded identity base');
        const activeFrame = track.frames[index], other = track.frames[next];
        if (row.initialized && activeFrame.child) {
          let opacity = activeFrame.opacity;
          if (activeFrame.type === 3 && other?.child && other.time > activeFrame.time) opacity = Math.floor(opacity * 255 + (other.opacity - opacity) * 255 * Math.max(0, Math.min(1, (frame - activeFrame.time) / (other.time - activeFrame.time))) + 0.5) / 255;
          if (root[6] !== opacity) throw new Error('Saved SD002BA child opacity differs from its actual slot');
        }
      }
      node.activeSlot = active; node.slots = [slots[0],slots[1]]; node.playedIndex = played;
      node.root = { a:root[0],b:root[1],c:root[2],d:root[3],x:root[4],y:root[5],opacity:root[6] };
      if (saved.child !== null) {
        const child = psbRecord(saved.child), program = track.frames[index].child;
        if (!program || child.object !== program.source.objectName || child.motion !== program.source.motionName) throw new Error('Saved child identity mismatch');
        const state = readCounter(child.counter); validateCounter(profile(program), state);
        if (state.layerGate || state.progressGate) throw new Error('Saved child layers did not finish their native progress/update boundary');
        if (isEmitterProgram(program)) {
          if (child.particles === undefined) throw new Error('Saved SD001 emitter state is missing');
          node.child = { program, state, particles: new Sd001Particles(program, child.particles) };
        } else {
          if (child.particles !== undefined) throw new Error('Unexpected saved emitter on a raster child');
          const tree=track.frames[index].tree;
        if(!!tree!==(child.tree!==undefined))throw Error('Saved nested Player identity differs');
        node.child = { program, state,tree:tree?new ChildPlayers(tree,state.counterFrames,child.tree):undefined };
        }
      } else { if (row.initialized && track.frames[index].child) throw new Error('Saved active child is missing'); node.child = undefined; }
    }
    this.lastFrame = frame; this.initialized = row.initialized;
    if (this.program.actionProfile) {
      if (!this.initialized) { if (row.bounds !== null) throw new Error('Unevaluated MTN source has post-update bounds'); }
      else this.postBounds = readSourceBounds(row.bounds, this.program.raster, frame, this.boundClips(), this.program.renderItemUpperBound);
    }
  }
}
