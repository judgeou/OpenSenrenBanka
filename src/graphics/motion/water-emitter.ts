import {psbRecord,psbValue} from '../../formats/psb-value.ts';
import type {PsbValue} from '../../formats/psb-value.ts';
import type {MtnDocument} from '../mtn-catalog.ts';
import type {MtnProgram} from '../mtn-program.ts';
import {decodeLeafProgram,decodeRasterTrack,motionNumber,rasterPriority} from './leaf-program.ts';
import type {LeafProgram} from './leaf-program.ts';
import type {Emitter,EmitterProgram} from './particle-program.ts';
import {rasterTreeBounds} from './tree-bounds.ts';

const programs = new Map([[19596,[60,2]], [21559,[20,2]], [22891,[20,2]], [23480,[40,3]]]);
const falloff=0.800000011920929;
export const waterEmitter = (p:MtnProgram):boolean => p.objectName==='SD010' && programs.has(p.sourceRef);
const fail = (detail:string):never => {throw Error('Unsupported original water particle profile: '+detail);};
const equal=(a:PsbValue|undefined,b:number):boolean=>a===b||(Number.isSafeInteger(b)&&a===BigInt(b));
const fields = (row:object, keys:readonly string[]):boolean=>Object.keys(row).length===keys.length&&keys.every(k=>Object.hasOwn(row,k));

export function decodeWaterEmitter(d:MtnDocument,p:MtnProgram):EmitterProgram {
  const read=(r:number,k:string):PsbValue|undefined=>{const ref=d.reader.property(r,k);return ref===undefined?undefined:psbValue(d.reader,ref);};
  const spec=programs.get(p.sourceRef);
  if(!waterEmitter(p)||d.name.toLowerCase()!=='sd010.mtn'||!spec||p.lastTime!==spec[0]||p.tracks.length!==spec[1]||!equal(read(p.sourceRef,'loopTime'),0)||!equal(read(p.sourceRef,'type'),0))fail('motion identity');
  const emitters=new Map<number,Emitter>(), raster:LeafProgram['tracks'][number][]=[];
  let radius=0,upper=0;
  for(const t of p.tracks){
    if(!equal(read(t.sourceRef,'type'),4)){raster.push(decodeRasterTrack(d,p,t));upper++;continue;}
    const r=psbRecord(psbValue(d.reader,t.sourceRef));
    const fixed={coordinate:0,exportSelf:1,groundCorrection:0,inheritMask:33556476,joinTarget:1,meshCombine:0,meshDivision:10,meshTransform:0,particle:1,particleAccelRatio:falloff,particleApplyZoomToVelocity:0,particleDeleteOutsideScreen:0,particleFlyDirection:0,particleInheritAngle:0,particleInheritOpacity:2,particleInheritVelocity:0,particleMaxNum:20,particleTriVolume:0,type:4};
    if(t.parent!==undefined||t.children.length||!fields(r,[...Object.keys(fixed),'children','frameList','label','metadata','parameterize','particleMotionList','transformOrder'])||r.metadata!==null||r.parameterize!==null||Object.entries(fixed).some(([k,v])=>!equal(r[k],v))||!Array.isArray(r.transformOrder)||r.transformOrder.map(String).join(',')!=='0,3,2,1')fail('emitter fields');
    const first=t.sourceRef===19649, active=first?30:p.lastTime, f=t.frames[0];
    if(t.frames.length!==(first?3:2)||f.type!==2||f.time!==0||f.contentRef===undefined||t.frames.slice(1).some((v,i)=>v.type!==0||v.time!==(first&&i===0?30:p.lastTime)||v.contentRef!==undefined&&psbValue(d.reader,v.contentRef)!==null))fail('emitter lifetime');
    const c=psbRecord(psbValue(d.reader,f.contentRef!)), params=psbRecord(c.prt);
    if(!fields(c,['src','mask','ox','oy','coord','zx','zy','prt','angle'])||c.src!=='particle/ellipse'||!equal(c.mask,1048691)||!equal(c.ox,0)||!equal(c.oy,0)||!Array.isArray(c.coord)||c.coord.length!==3||!equal(c.coord[2],0))fail('shape');
    const motionList=r.particleMotionList, expected=first?['_mizu1']:p.sourceRef===19596?['_mizu2','_mizu3','_mizu2s','_mizu3s']:['_mizu2','_mizu3'];
    if(!Array.isArray(motionList)||motionList.length!==expected.length||motionList.some((s,i)=>s!=='motion/SD010/'+expected[i]))fail('leaf identity');
    const choices=expected.map(name=>decodeLeafProgram(d,'SD010',name));
    if(choices.some(x=>x.loopTime!==-1))fail('leaf lifetime');
    const authored=first?{mask:55,range:10,trigger:1,fmin:.20000000298023224,fmax:1.2000000476837158,vmin:.125,vmax:.625,zmin:.800000011920929,zmax:1.2000000476837158}:{mask:54,range:90,fmin:3,fmax:6,vmin:1.25,vmax:1.875,zmin:.5,zmax:1};
    if(!fields(params,Object.keys(authored))||Object.entries(authored).some(([k,v])=>!equal(params[k],v)))fail('source rate');
    const [x,y,z]=(c.coord as PsbValue[]).map(v=>motionNumber(v,'water coordinate'));
    const sx=motionNumber(c.zx,'water scale x'),sy=motionNumber(c.zy,'water scale y'),heading=motionNumber(c.angle,'water angle');
    if(sx!==2.671875||sy!==2.671875||heading!==(first?13.36082649230957:75))fail('ellipse size or heading');
    const zoom=[authored.zmin,authored.zmax] as const;
    const burst={count:[authored.fmin,authored.fmax] as const,velocity:[authored.vmin,authored.vmax] as const,cadence:authored.range,limit:20,heading,retention:falloff,fractional:first,period:p.lastTime,until:active};
    emitters.set(t.id,{x,y,z,sx,sy,angle:[0,0],zoom,burst,choices});
    // These leaves have layout parents but only raster slots enter the draw list.
    // Bound simultaneous live particles from the authored burst windows and leaf lifetimes.
    const age=Math.max(...choices.map(q=>q.source.lastTime));
    const phases=Array.from({length:Math.ceil(active/burst.cadence)},(_,i)=>i*burst.cadence);
    const overlapping=Math.max(...phases.map(end=>{
      let n=0;
      for(let cycle=0;cycle*burst.period<=age+burst.period;cycle++){
        for(const phase of phases){const delta=end+cycle*burst.period-phase;if(delta>=0&&delta<age)n++;}
      }
      return n;
    }));
    const drawn=Math.max(...choices.map(q=>q.tracks.filter(t=>t.frames.some(f=>'texture' in f)).length));
    upper+=Math.min(burst.limit,overlapping*Math.ceil(authored.fmax))*drawn;
    radius=Math.max(radius,Math.hypot(x,y)+16*Math.max(sx,sy)+16*authored.vmax/(1-falloff)+zoom[1]*Math.max(...choices.map(q=>Math.hypot(q.width,q.height))));
  }
  if(!emitters.size)fail('missing emitter');
  const a=raster.length?rasterTreeBounds(raster):undefined;
  const e=Math.max(Math.ceil(radius)+1,a?.originX??0,a?.originY??0,a?a.width-a.originX:0,a?a.height-a.originY:0);
  return {source:p,loopTime:0,tracks:raster,order:rasterPriority(d,p,upper),renderItemUpperBound:upper,originX:e,originY:e,width:2*e,height:2*e,emitters};
}
