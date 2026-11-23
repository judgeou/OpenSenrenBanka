import { psbRecord, psbValue } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import type { MtnProgram } from '../mtn-program.ts';
import { decodeLeafProgram, decodeRasterTrack, motionNumber, rasterPriority } from './leaf-program.ts';
import type { LeafProgram } from './leaf-program.ts';
import {rasterTreeBounds} from './tree-bounds.ts';
import {decodeWaterEmitter,waterEmitter} from './water-emitter.ts';
export interface Emitter { readonly x: number; readonly y: number; readonly z: number; readonly sx: number; readonly sy: number; readonly angle: readonly [number, number]; readonly zoom: readonly [number, number]; readonly burst?:{readonly count:readonly [number,number];readonly velocity:readonly [number,number];readonly cadence:number;readonly viewport?:readonly [number,number];readonly limit:number;readonly heading?:number;readonly retention?:number;readonly fractional?:boolean;readonly ox?:number;readonly oy?:number;readonly period?:number;readonly until?:number}; readonly choices: readonly LeafProgram[]; readonly triggerKeys?: readonly number[]; readonly ellipseAngle?: number }
export interface EmitterProgram extends LeafProgram { readonly emitters: ReadonlyMap<number, Emitter> }
function fail(detail: string): never { throw new Error('Unsupported original SD particle profile: ' + detail); }
export function isEmitterProgram(program: LeafProgram): program is EmitterProgram { return 'emitters' in program; }
export function authoredBubble(document:MtnDocument, program:MtnProgram): 'crowd'|'steam'|'roop'|'sd012'|'sd202'|'sd203'|'sd203fi'|'sd204heart'|undefined {
  const model=document.name.toLowerCase(), {objectName:object,motionName:motion,sourceRef:ref}=program;
  if(model==='sd103.mtn'&&object==='SD103') {
    if(motion==='efDBawaP'&&ref===40590)return 'crowd';
    if(motion==='efEEawaP'&&ref===43424)return 'steam';
  }
  if(model==='sd204.mtn'&&object==='char204'&&motion==='efHtP'&&ref===9441)return 'sd204heart';
  if(model==='sd203.mtn'&&object==='char203'){if(motion==='efEHawa'&&ref===31912)return 'sd203';if(motion==='efEHawaFI'&&ref===33012)return 'sd203fi';}
  if(model==='sd202.mtn'&&object==='char'&&motion==='efAwa'&&ref===9143)return 'sd202';
  if(model==='sd012.mtn'&&object==='SD012'&&motion==='あわわP'&&ref===54350)return 'sd012';
  if(model==='sd104.mtn'&&object==='roop'&&motion==='efKEawa'&&ref===61478)return 'roop';
}
/** Finite SD001 count-1 ellipse emitter. No frequency, forces, collision, 3D orientation, nested arbitrary MTN or unknown material. */
export function decodeMotionEmitters(document: MtnDocument, program: MtnProgram): EmitterProgram {
  if(waterEmitter(program))return decodeWaterEmitter(document,program);
  const model = document.name.toLowerCase();
  const sweat = model==='sd001.mtn' && program.objectName==='SD001' && program.motionName==='汗PED';
  const tears = model==='sd002.mtn' && program.objectName==='SD002' && program.motionName==='涙PED';
  const bubble=model==='sd004.mtn'&&program.objectName==='SD004'&&[25831,26433,27033].includes(program.sourceRef)&&['泡PAB','泡PBC','泡PDD'].includes(program.motionName);
  const star=model==='sd005.mtn'&&program.objectName==='SD005'&&program.sourceRef===34779&&program.motionName==='星PCA';
  const tears3=model==='sd003.mtn'&&program.objectName==='SD003'&&program.motionName==='涙PED'&&program.sourceRef===28641;
  const hana=model==='sd006.mtn'&&program.objectName==='SD006'&&program.motionName==='hanaP'&&program.sourceRef===34903;
  const point=model==='sd007.mtn'&&program.objectName==='SD007'&&program.motionName==='wasabg2'&&program.sourceRef===29833;
  const foam=model==='sd014.mtn'&&program.objectName==='SD014'&&program.sourceRef===19127&&program.motionName==='efAAP';
  const pillow=model==='sd101.mtn'&&program.objectName==='SD101'&&(program.sourceRef===10889&&program.motionName==='efAAP'||program.sourceRef===12481&&program.motionName==='efBCP');
  const pillowB=pillow&&program.sourceRef===12481;
  const sweat102=model==='sd102.mtn'&&program.objectName==='SD102'&&program.sourceRef===16514&&program.motionName==='efAJP';
  const authored = authoredBubble(document,program);
  const heart=authored==='sd204heart';
  const choicesCount=heart?6:authored ? ['roop','sd203','sd203fi'].includes(authored)?3:['sd012','sd202'].includes(authored)?2:7 : star||point?1:hana?4:bubble||foam||pillowB||sweat102?2:3;
  if ((!sweat && !tears && !tears3 && !bubble && !star && !hana && !point && !foam && !pillow && !sweat102 && !authored) || program.lastTime !== (heart?60:authored==='steam'?20:hana?120:10) || program.loopTime?.kind !== 'integer' || program.loopTime.nativeValue !== 0n || program.tracks.length !== (authored ? ['crowd','sd012','sd202'].includes(authored)?5:authored==='steam'?6:authored==='sd203'?4:3 : hana||tears3?5:star||point?2:foam?3:sweat102?4:pillow&&!pillowB?6:choicesCount)) fail('clip identity');
  const value = (ref: number, field: string): PsbValue | undefined => { const at = document.reader.property(ref, field); return at === undefined ? undefined : psbValue(document.reader, at); };
  const motionFields = new Set(['lastTime','layer','loopTime','metadata','parameter','parameterize','priority','referenceModelFileList','referenceProjectFileList','tag','type','variable']);
  if (program.fields.some(row => !motionFields.has(row.key)) || value(program.sourceRef, 'type') !== 0n || value(program.sourceRef, 'metadata') !== null || value(program.sourceRef, 'parameterize') !== null) fail('motion fields');
  for (const key of ['parameter','referenceModelFileList','referenceProjectFileList','tag','variable']) {
    const list = value(program.sourceRef, key); if (!Array.isArray(list) || list.length) fail('motion ' + key);
  }
  const emitters = new Map<number, Emitter>(), tracks:LeafProgram['tracks'][number][]=[]; let radius = 0, renderItemUpperBound = 0;
  const fixed = { coordinate: 0n, exportSelf: 1n, groundCorrection: 0n, inheritMask: point?33555996n:33556476n, joinTarget: 1n, meshCombine: 0n, meshTransform: 0n, metadata: null, parameterize: null, particle: point?0n:1n, particleAccelRatio: hana||heart?0.699999988079071:1n, particleApplyZoomToVelocity: 0n, particleDeleteOutsideScreen: heart?1n:0n, particleFlyDirection: 0n, particleInheritAngle: 0n, particleInheritOpacity: star||heart?2n:1n, particleInheritVelocity: 0n, particleMaxNum: star?128n:hana||point||heart?20n:1n, particleTriVolume: 0n, type: 4n };
  const allowed = new Set([...Object.keys(fixed), 'children','frameList','label','meshDivision','particleMotionList','transformOrder']);
  const clips = new Map<string, LeafProgram>();
  for (const track of program.tracks) {
    if(point&&track.sourceRef===29887||authored==='steam'&&track.id===0){tracks.push(decodeRasterTrack(document,program,track));renderItemUpperBound++;continue;}
    if (track.parent !== undefined || track.children.length || track.fields.some(row => !allowed.has(row.key))) fail('emitter topology');
    for (const [name, match] of Object.entries(fixed)) if (value(track.sourceRef, name) !== (heart&&name==='particleMaxNum'&&track.sourceRef===10070?32n:match) && !(typeof match === 'bigint' && value(track.sourceRef, name) === Number(heart&&name==='particleMaxNum'&&track.sourceRef===10070?32n:match))) fail('emitter ' + name);
    const list = value(track.sourceRef, 'particleMotionList'), order = value(track.sourceRef, 'transformOrder');
    if (!Array.isArray(order) || order.map(String).join(',') !== '0,3,2,1' || !Array.isArray(list) || list.length !== choicesCount) fail('emitter transform/motion list');
    const choices = list.map(item => {
      const match = typeof item === 'string' && (sweat ? /^motion[/]SD001[/](_ase[123])$/u : star ? /^motion[/]SD005[/](_hosi)$/u : bubble ? /^motion[/]SD004[/](_awa[1-6])$/u : authored ? heart ? /^motion[/]char204[/](_ht[12][sl]?)$/u : authored==='roop' ? /^motion[/]roop[/](_awa[1-3])$/u : authored==='sd012' ? /^motion[/]SD012[/](_awa[12])$/u : authored==='sd202' ? /^motion[/]char[/](_awa[12])$/u : ['sd203','sd203fi'].includes(authored)?/^motion[/]char203[/](_awa[123])$/u : /^motion[/]SD103[/](_awa[1-7])$/u : sweat102 ? /^motion[/]SD102[/](_awa[12])$/u : pillow ? (pillowB ? /^motion[/]SD101[/](_awa[45])$/u : /^motion[/]SD101[/](_awa[123])$/u) : foam ? /^motion[/]SD014[/](_awa[12])$/u : hana ? /^motion[/]SD006[/](_hana[1-4])$/u : point ? /^motion[/]SD007[/](starsplash)$/u : tears3 ? /^motion[/]SD003[/](_nami[123])$/u : /^motion[/]SD002[/](_nami[123])$/u).exec(item);
      if (!match) return fail('child motion storage');
      const name = match[1]; let clip = clips.get(name);
      if (!clip) { clip = decodeLeafProgram(document, program.objectName, name); clips.set(name, clip); }
      if (clip.loopTime !== -1 || clip.tracks.length !== (star||hana?2:1)) fail('particle leaf shape'); return clip;
    });
    if (new Set(choices).size !== choicesCount) fail('duplicate particle clip');
    const [frame] = track.frames, end=track.frames.at(-1)!;
    if (track.frames.length !== (authored==='steam'?3:2) || frame.time !== 0 || frame.type !== 2 || frame.contentRef === undefined || end.type !== 0 || end.time !== program.lastTime+(heart?1:0) || end.contentRef !== undefined && psbValue(document.reader, end.contentRef) !== null) fail('emitter frame layout');
    const content = psbRecord(psbValue(document.reader, frame.contentRef)), row = psbRecord(content.prt), coord = point?[0n,0n,0n]:content.coord;
    const ellipseAngle=authored&&Object.hasOwn(content,'angle') ? motionNumber(content.angle,'ellipse rotation') : undefined;
    if(ellipseAngle!==undefined&&(ellipseAngle<0||ellipseAngle>=360))fail('ellipse angle domain');
    const keys = authored ? track.frames.slice(0,-1).map(f=>f.time) : undefined;
    if(authored==='steam') {
      const middle=track.frames[1], encode=(val:PsbValue)=>JSON.stringify(val,(_key,v)=>typeof v==='bigint'?{int:String(v)}:v);
      if(middle.type!==2||middle.time!==10||middle.contentRef===undefined||encode(psbValue(document.reader,middle.contentRef))!==encode(content))fail('staggered bubble keys');
    }
    if (content.src !== (point?'particle/point':'particle/ellipse') || content.mask !== (point?1048577n:star||hana||ellipseAngle!==undefined?1048691n:1048675n) || (!hana&&(content.ox!==0n||content.oy!==0n) || hana&&(Math.abs(motionNumber(content.ox,'pivot x'))>4||Math.abs(motionNumber(content.oy,'pivot y'))>8)) || !Array.isArray(coord) || coord.length !== 3 || Object.keys(content).some(key => !['src','mask','ox','oy','coord','zx','zy','prt',...(star||hana||ellipseAngle!==undefined?['angle']:[])].includes(key))) fail('ellipse source');
    if(heart){
      if(row.mask!==62n||row.range!==10n||Number(row.fmin)!==(track.sourceRef===10070?0:1)||Number(row.fmax)!==2||row.vmin!==.625||row.vmax!==1.25||ellipseAngle!==270||Object.keys(row).some(k=>!['mask','range','fmin','fmax','vmin','vmax','amin','amax','zmin','zmax'].includes(k)))fail('authored heart burst');
    }else if(star){
      if(row.mask!==62n||row.range!==10n||row.fmin!==7||row.fmax!==10||row.vmin!==.0625||row.vmax!==.1875||Object.keys(row).some(k=>!['mask','range','fmin','fmax','vmin','vmax','amin','amax','zmin','zmax'].includes(k)))fail('authored star burst');
    }else if(hana){
      if(row.mask!==62n||row.range!==30n||row.fmin!==.20000000298023224||row.fmax!==1.2000000476837158||row.vmin!==.5||row.vmax!==2.25||Object.keys(row).some(k=>!['mask','range','fmin','fmax','vmin','vmax','amin','amax','zmin','zmax'].includes(k)))fail('authored hana rate');
    }else if(point){
      if(row.mask!==3n||row.trigger!==1n||motionNumber(row.fmin,'point min')!==1||motionNumber(row.fmax,'point max')!==2||Object.keys(row).length!==4||Object.keys(content).some(k=>!['src','mask','ox','oy','prt'].includes(k)))fail('authored point burst');
    }else if (row.mask !== 27n || row.trigger !== 1n || motionNumber(row.fmin, 'count min') !== 1 || motionNumber(row.fmax, 'count max') !== 1 || Object.keys(row).some(key => !['mask','trigger','fmin','fmax','amin','amax','zmin','zmax'].includes(key))) fail('single-count trigger');
    const [x,y,z] = coord.map(item => motionNumber(item, 'emitter position')), sx = point?0:motionNumber(content.zx, 'emitter scale'), sy = point?0:motionNumber(content.zy, 'emitter scale');
    const angle = [point?0:motionNumber(row.amin, 'emitter angle'), point?0:motionNumber(row.amax, 'emitter angle')] as const;
    const zoom = [point?1:motionNumber(row.zmin, 'emitter zoom'), point?1:motionNumber(row.zmax, 'emitter zoom')] as const;
    if (z !== (sweat||bubble||star||tears3?5.25:0) || !point&&(sx<=0||sy<=0) || angle[0] !== (heart?-5:0) || angle[1] !== (heart?5:point?0:hana?180:star?90:360) || (heart ? zoom[0]!==(track.sourceRef===9496?.30000001192092896:.20000000298023224)||zoom[1]!==1.399999976158142 : authored&&authored!=='sd012' ? ![.5,.699999988079071].includes(zoom[0])||![.800000011920929,1,1.100000023841858].includes(zoom[1]) : zoom[0] !== (hana?.699999988079071:star?.5:1) || zoom[1] < 1 || zoom[1] > 2)) fail('emitter range');
    const burst=heart?{count:[Number(row.fmin),2] as const,velocity:[.625,1.25] as const,cadence:10,limit:track.sourceRef===10070?32:20,heading:270,retention:.699999988079071,viewport:[640,360] as const}:star?{count:[7,10] as const,velocity:[.0625,.1875] as const,cadence:10,limit:128}:point?{count:[1,2] as const,velocity:[0,0] as const,cadence:10,limit:20}:hana?{count:[.20000000298023224,1.2000000476837158] as const,velocity:[.5,2.25] as const,cadence:30,limit:20,heading:motionNumber(content.angle,'source emitter heading'),retention:.699999988079071,fractional:true,ox:motionNumber(content.ox,'pivot x'),oy:motionNumber(content.oy,'pivot y')}:undefined;
    emitters.set(track.id, { x,y,z,sx,sy,angle,zoom,choices,burst,triggerKeys:keys,ellipseAngle });
    renderItemUpperBound += (burst?.limit??1)*Math.max(...choices.map(clip => clip.renderItemUpperBound));
    radius = Math.max(radius, Math.hypot(x, y) + 16 * Math.max(sx, sy) + (hana||heart?125:0) + zoom[1] * Math.max(...choices.map(clip => Math.hypot(clip.width, clip.height))));
  }
  const base=tracks.length?rasterTreeBounds(tracks):undefined;
  const extent = Math.max(Math.ceil(radius)+1,base?.originX??0,base?.originY??0,base?base.width-base.originX:0,base?base.height-base.originY:0);
  return { source: program, loopTime: 0, tracks, order: rasterPriority(document, program, Math.max(renderItemUpperBound, program.tracks.length)), renderItemUpperBound, originX: extent, originY: extent, width: 2 * extent, height: 2 * extent, emitters };
}
export function emitterLeaves(program: LeafProgram): readonly LeafProgram[] { return isEmitterProgram(program) ? [...new Set([program,...[...program.emitters.values()].flatMap(row => row.choices)])] : [program]; }
