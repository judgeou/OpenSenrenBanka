import {psbRecord} from '../../formats/psb-value.ts';
import type {PsbValue} from '../../formats/psb-value.ts';
import type {LeafProgram} from './leaf-program.ts';
import {leafItems} from './leaf-sampler.ts';
import type {RasterSurface,Transform} from './leaf-sampler.ts';
import type {StageQuad,StageTexture} from '../webgl-stage.ts';
import {freshCounter,progressCounter,readCounter,validateCounter} from './native-counter.ts';
import type {NativeCounterState} from './native-counter.ts';
import type {Emitter,EmitterProgram} from './particle-program.ts';
export {decodeMotionEmitters,emitterLeaves,isEmitterProgram} from './particle-program.ts';
function fail(detail:string):never{throw Error('Unsupported original SD particle profile: '+detail);}

interface Particle { readonly clip: LeafProgram; readonly x: number; readonly y: number; readonly angle: number; readonly zoom: number; counter: NativeCounterState }
interface Star extends Omit<Particle,'x'|'y'>{x:number;y:number;vx:number;vy:number;readonly opacity:number}
const counterFor = (clip: LeafProgram) => ({lastTime: clip.source.lastTime, loopTime: clip.loopTime});
const finite = (value: PsbValue | undefined, unit: string): number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000 ? value : fail('saved ' + unit);
/** One owner per particle sub-Player, local PRNG seed/counter and immutable spawn transformation. */
export class Sd001Particles {
  private seed: number;
  private readonly alive = new Map<number, Particle>();
  private streaks=new Map<number,Star[]>();
  constructor(private readonly program: EmitterProgram, saved?: PsbValue) {
    this.seed = Math.floor(Math.random() * 4294967295) + 1;
    if (saved !== undefined) this.restore(saved);
  }
  private random(): number { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s >>> 0; return this.seed / 4294967296; }
  tick(previous: NativeCounterState, next: NativeCounterState, parent: Transform): void {
    const triggered = previous.layerGate || previous.counterFrames + next.scaledDeltaFrames >= this.program.source.lastTime;
    for (const id of this.program.order) {
      const e = this.program.emitters.get(id);if(!e)continue;
      if(e.burst){this.stars(id,e,e.burst,previous,next,parent);continue;}
      const age=e.triggerKeys ? this.triggerAge(e.triggerKeys,previous,next) : triggered ? next.scaledDeltaFrames : undefined;
      if (age !== undefined) {
        // Trigger 1 consumes a count sample (min=max=1), chooses a motion, and transforms
        // a uniform 16px disk through the emitter's scale. Speed/velocity are zero in this profile.
        this.random(); const clip = e.choices[Math.floor(this.random() * e.choices.length)];
        const theta = this.random() * 2 * Math.PI, radius = Math.sqrt(this.random()) * 16;
        const dx=Math.cos(theta)*radius*e.sx,dy=Math.sin(theta)*radius*e.sy;
        const a=(e.ellipseAngle??0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
        const px=e.x+c*dx-s*dy,py=e.y+s*dx+c*dy;
        const angle = (e.angle[0] + (e.angle[1] - e.angle[0]) * this.random()) * Math.PI / 180;
        const zoom = e.zoom[0] + (e.zoom[1] - e.zoom[0]) * this.random();
        const x = parent.x + parent.a * px + parent.c * py, y = parent.y + parent.b * px + parent.d * py;
        this.alive.set(id, {clip, x, y, angle, zoom, counter: freshCounter()});
      }
      const item = this.alive.get(id);
      if (!item) continue;
      if (!item.counter.playing) { this.alive.delete(id); continue; }
      item.counter = { ...progressCounter(counterFor(item.clip), item.counter, age ?? next.scaledDeltaFrames, true), layerGate: false };
    }
  }
  private triggerAge(keys:readonly number[],previous:NativeCounterState,next:NativeCounterState):number|undefined {
    const start=previous.counterFrames,end=start+next.scaledDeltaFrames,period=this.program.source.lastTime;
    let latest=-Infinity;
    for(const key of keys){
      const occurrence=key+Math.floor((end-key)/period)*period;
      if(occurrence>start||previous.layerGate&&occurrence===start)latest=Math.max(latest,occurrence);
    }
    return latest===-Infinity?undefined:end-latest;
  }
  private stars(id:number,e:Emitter,b:NonNullable<Emitter['burst']>,previous:NativeCounterState,next:NativeCounterState,parent:Transform):void{
    const pool=this.streaks.get(id)??[],delta=next.scaledDeltaFrames;
    function move(p:Star,frames:number):void{
      p.counter={...progressCounter(counterFor(p.clip),p.counter,frames,true),layerGate:false};
      const factor=b.retention===undefined?1:Math.pow(b.retention,frames),run=b.retention===undefined?frames:(1-factor)/(1-b.retention);
      p.x+=run*p.vx;p.y+=run*p.vy;p.vx*=factor;p.vy*=factor;
    }
    for(const p of pool)move(p,delta);
    const inside=(p:Star)=>!b.viewport||Math.abs(p.x)<=b.viewport[0]&&Math.abs(p.y)<=b.viewport[1];
    const live=pool.filter(p=>p.counter.playing&&inside(p));
    const spawn=(age:number)=>{
      const rate=b.count[0]+this.random()*(b.count[1]-b.count[0]+(b.fractional?0:1));
      const count=Math.floor(rate)+(b.fractional&&this.random()<rate%1?1:0);
      for(let i=0;i<count&&live.length<b.limit;i++){
        const phase=this.random()*2*Math.PI,r=Math.sqrt(this.random())*16,h=(b.heading??0)*Math.PI/180,dx=Math.cos(phase)*e.sx*r-(b.ox??0),dy=Math.sin(phase)*e.sy*r-(b.oy??0);
        const px=e.x+Math.cos(h)*dx-Math.sin(h)*dy,py=e.y+Math.sin(h)*dx+Math.cos(h)*dy;
        const angle=(e.angle[0]+this.random()*(e.angle[1]-e.angle[0]))*Math.PI/180,zoom=e.zoom[0]+this.random()*(e.zoom[1]-e.zoom[0]);
        const speed=16*(b.velocity[0]+this.random()*(b.velocity[1]-b.velocity[0])),heading=this.random()*2*Math.PI+h,v0=Math.cos(heading)*speed,v1=Math.sin(heading)*speed;
        const p={clip:e.choices[e.choices.length===1?0:Math.floor(this.random()*e.choices.length)],x:parent.x+parent.a*px+parent.c*py,y:parent.y+parent.b*px+parent.d*py,vx:parent.a*v0+parent.c*v1,vy:parent.b*v0+parent.d*v1,angle,zoom,opacity:parent.opacity,counter:freshCounter()};
        move(p,age);if(p.counter.playing&&inside(p))live.push(p);
      }
    };
    if(b.period!==undefined){
      const begin=previous.counterFrames,end=begin+delta,window=b.until??b.period,maxAge=Math.max(...e.choices.map(c=>c.source.lastTime));
      const phase=begin%b.period;
      if(previous.layerGate&&phase<window&&phase%b.cadence===0&&delta<maxAge)spawn(delta);
      // Anchor to the native player phase; discard already expired emissions.
      for(let origin=Math.floor(Math.max(begin,end-maxAge)/b.period)*b.period;origin<=end;origin+=b.period){
        for(let f=0;f<window&&origin+f<=end;f+=b.cadence){const t=origin+f;if(t>begin&&end-t<maxAge)spawn(end-t);}
      }
    }else{
      if(previous.layerGate)spawn(delta);
      for(let t=b.cadence-(b.fractional?previous.counterFrames%b.cadence:previous.counterFrames);t<=delta&&t>=0;t+=b.cadence)if(delta-t<e.choices[0].source.lastTime)spawn(delta-t);
    }
    this.streaks.set(id,live);
  }
  quads(textures: ReadonlyMap<string, StageTexture>, surface: RasterSurface, opacity: number, frame=0, root?:Transform): { depth: number; quad: StageQuad }[] {
    const own=this.program.tracks.length?leafItems(this.program,textures,frame,root,surface):undefined;
    return this.program.order.flatMap(id => {
      const e=this.program.emitters.get(id);
      if(!e){const quad=own?.get(id);return quad?[{depth:0,quad}]:[];}
      if(e.burst)return (this.streaks.get(id)??[]).flatMap(p=>{
        const c=Math.cos(p.angle)*p.zoom,s=Math.sin(p.angle)*p.zoom;
        return [...leafItems(p.clip,textures,p.counter.evalFrame,{a:c,b:s,c:-s,d:c,x:p.x,y:p.y,opacity:p.opacity},surface).values()].map(quad=>({depth:e.z,quad}));
      });
      const item = this.alive.get(id); if (!item || opacity <= 0) return [];
      const cos = Math.cos(item.angle) * item.zoom, sin = Math.sin(item.angle) * item.zoom;
      const transform = {a: cos, b: sin, c: -sin, d: cos, x: item.x, y: item.y, opacity};
      return [...leafItems(item.clip, textures, item.counter.evalFrame, transform, surface).values()].map(quad => ({ depth: this.program.emitters.get(id)!.z, quad }));
    });
  }
  capture(): PsbValue { return {seed: this.seed, ...(this.streaks.size?{streaks:[...this.streaks].map(([id,pool])=>({id,pool:pool.map(({clip,counter,...p}):PsbValue=>{const snapshot={...p,counter:{...counter}};return this.program.emitters.get(id)!.choices.length>1?{...snapshot,motion:clip.source.motionName}:snapshot;})}))}:{}),alive: [...this.alive].map(([id, item]) => ({id, motion: item.clip.source.motionName, x: item.x, y: item.y, angle: item.angle, zoom: item.zoom, counter: {...item.counter}}))}; }
  private restore(value: PsbValue): void {
    const row = psbRecord(value), seed = row.seed;
    if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 1 || seed > 4294967295 || !Array.isArray(row.alive) || row.alive.length > this.program.emitters.size) fail('saved emitter cursor');
    this.seed = seed;
    if(row.streaks!==undefined){
      if(!Array.isArray(row.streaks)||row.streaks.length>this.program.emitters.size)fail('saved star emitter count');
      for(const v of row.streaks){const r=psbRecord(v),id=finite(r.id,'star emitter'),e=this.program.emitters.get(id);
        if(!e?.burst||this.streaks.has(id)||!Array.isArray(r.pool)||r.pool.length>e.burst.limit)fail('saved star batch');
        const list=r.pool.map(v=>{const p=psbRecord(v),clip=e.choices.length===1?e.choices[0]:e.choices.find(c=>c.source.motionName===p.motion);if(!clip)fail('saved rate clip');const counter=readCounter(p.counter);validateCounter(counterFor(clip),counter);
          const opacity=finite(p.opacity,'star opacity'),zoom=finite(p.zoom,'star zoom'),angle=finite(p.angle,'star angle');
          if(!counter.playing||counter.layerGate||counter.progressGate||opacity<0||opacity>1||zoom<e.zoom[0]||zoom>e.zoom[1]||angle<e.angle[0]*Math.PI/180||angle>e.angle[1]*Math.PI/180)fail('saved star phase');
          return {clip,counter,opacity,zoom,angle,x:finite(p.x,'star x'),y:finite(p.y,'star y'),vx:finite(p.vx,'star vx'),vy:finite(p.vy,'star vy')};});this.streaks.set(id,list);
      }
    }
    for (const value of row.alive) {
      const item = psbRecord(value), id = finite(item.id, 'emitter identity'), emitter = this.program.emitters.get(id), clip = emitter?.choices.find(clip => clip.source.motionName === item.motion);
      if (!emitter || !clip || this.alive.has(id)) fail('saved particle identity');
      const counter = readCounter(item.counter); validateCounter(counterFor(clip), counter);
      const x = finite(item.x, 'x'), y = finite(item.y, 'y'), angle = finite(item.angle, 'angle'), zoom = finite(item.zoom, 'zoom');
      if (counter.layerGate || counter.progressGate || angle < 0 || angle > 2 * Math.PI || zoom < emitter.zoom[0] || zoom > emitter.zoom[1]) fail('saved particle phase');
      this.alive.set(id, {clip, x, y, angle, zoom, counter});
    }
  }
}
