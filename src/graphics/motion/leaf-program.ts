import {motionCue} from './se-profiles.ts';
import { psbRecord, psbValue } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import type { MtnProgram, MtnTrack } from '../mtn-program.ts';
import type { MtnTexture } from '../mtn-textures.ts';
import { motionCurve } from './curve.ts';
import type { MotionCurve } from './curve.ts';
import { rasterTreeBounds } from './tree-bounds.ts';
import { positionPath } from './position-path.ts';
import {identityMeshTrack, identityMeshFrame, meshBit} from './identity-mesh.ts';
import {additiveRaster, waterLayout, sd102White, nativeTitleLayout} from './raster-material.ts';
import {makoFlowerLayout,makoIndependentAlpha,makoMultiply} from './mako-motion-profile.ts';
import {authoredFinalPose} from './raster-terminal.ts';
import {nestedSeTimeline} from './nested-se-profile.ts';
import type { PositionPath } from './position-path.ts';

export interface LeafSlot {
  readonly src: string; readonly texture: MtnTexture; readonly time: number; readonly type: number;
  readonly x: number; readonly y: number; readonly ox: number; readonly oy: number; readonly angle: number;
  readonly scaleX: number; readonly scaleY: number; readonly blend?:'add'|'native-multiply'; readonly skewX?:number; readonly skewY?:number; readonly skewCurve?:MotionCurve; readonly opacity: number;
  readonly flipX: boolean; readonly flipY: boolean;
  readonly positionPath?: PositionPath;
  readonly positionCurve?: MotionCurve; readonly angleCurve?: MotionCurve; readonly zoomCurve?: MotionCurve;
}
export type LayoutSlot = Omit<LeafSlot, 'texture'> & { readonly layout: true };
export type LeafPoseSlot = LeafSlot | LayoutSlot;
export interface LeafTrack {
  readonly id: number; readonly parent: number | undefined; readonly independentAlpha?:true; readonly transformOrder: readonly number[];
  readonly clipAncestor?: number; readonly clipRectangle?: boolean;
  readonly frames: readonly (LeafPoseSlot | { readonly time: number; readonly type: 0 })[];
}
export interface LeafProgram {
  readonly source: MtnProgram; readonly loopTime: number; readonly tracks: readonly LeafTrack[]; readonly order: readonly number[];
  /** Static conservative upper bound, including inactive raster tracks. Not a sampled count. */
  readonly renderItemUpperBound: number;
  readonly width: number; readonly height: number; readonly originX: number; readonly originY: number;
}
export function motionNumber(value: PsbValue | undefined, name: string): number {
  const number = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid MTN number: ' + name);
  return number;
}
function field(document: MtnDocument, ref: number, name: string): PsbValue | undefined {
  const at = document.reader.property(ref, name); return at === undefined ? undefined : psbValue(document.reader, at);
}
function fail(document: MtnDocument, program: MtnProgram, detail: string): never {
  throw new Error('Unsupported MTN ' + document.name + ':' + program.objectName + '/' + program.motionName + ': ' + detail);
}
/** Raster tree profile used by SD001AA. No layout flattening, guessed inheritance,
 * curve-to-linear fallback, particle/mask/mesh skipping or r10 unsigned scalars.
 */
export function decodeLeafProgram(document: MtnDocument, objectName: string, motionName: string): LeafProgram {
  const program = document.motionProgram(objectName, motionName);
  if (!program.tracks.length || program.tracks.length > 1024) fail(document, program, 'raster hierarchy budget');
  const known = new Set(['lastTime', 'layer', 'loopTime', 'metadata', 'parameter', 'parameterize', 'priority', 'referenceModelFileList', 'referenceProjectFileList', 'tag', 'type', 'variable']);
  for (const item of program.fields) if (!known.has(item.key)) fail(document, program, 'motion field ' + item.key);
  if (motionNumber(field(document, program.sourceRef, 'type'), 'motion type') !== 0 || field(document, program.sourceRef, 'metadata') !== null) fail(document, program, 'motion type/metadata');
  if (program.loopTime?.kind !== 'integer' && program.loopTime?.kind !== 'real') fail(document, program, 'loopTime scalar');
  const loopTime = program.loopTime.kind === 'integer' ? Number(program.loopTime.nativeValue) : program.loopTime.value;
  if (!Number.isSafeInteger(loopTime) || loopTime < -1 || loopTime >= 0 && loopTime >= program.lastTime) fail(document, program, 'degenerate loop profile');
  for (const name of ['parameter', 'referenceModelFileList', 'referenceProjectFileList', 'tag', 'variable']) {
    const value = field(document, program.sourceRef, name);
    if (!Array.isArray(value) || value.length) fail(document, program, name);
  }
  if (field(document, program.sourceRef, 'parameterize') !== null) fail(document, program, 'parameterize');
  const bb=document.name.toLowerCase()==='sd002.mtn' && objectName==='SD002' && motionName==='SD002BB';
  if(bb&&(program.tracks.length!==7||program.tracks[5].label!=='mask'||program.tracks[5].parent!==0||program.tracks[5].children.join(',')!=='6'||program.tracks[6].label!=='ef'||program.tracks[6].parent!==5)) fail(document,program,'unexpected type-7 clip topology');
  const tracks = program.tracks.map(track => {
    const kagomeLayout=document.name.toLowerCase()==='sd004.mtn'&&program.motionName==='kagome'&&program.sourceRef===21805&&track.sourceRef===22303;
    const steamLayout=document.name.toLowerCase()==='sd007.mtn'&&program.motionName==='efyuge'&&program.sourceRef===28652&&track.sourceRef===28703;
    const hanaLayout=document.name.toLowerCase()==='sd006.mtn'&&/^_hana[1-4]$/.test(program.motionName)&&[17721,18281,18841,19401].includes(track.sourceRef);
    const decoded=decodeRasterTrack(document,program,track,bb&&track.id===5?'clip':kagomeLayout||steamLayout||hanaLayout||makoFlowerLayout(document.name,track.sourceRef)||waterLayout(document,program,track)||nativeTitleLayout(document,program,track)?'layout':false);
    // 0x400000 on the shape makes its descendants use the preceding graphic
    // parent for their poses, while still inheriting this node as a clip ancestor.
    return bb&&track.id===6 ? {...decoded,parent:program.tracks[5].parent,clipAncestor:5} : decoded;
  });
  // This profile's parents are continuously active. Blank-parent descendant
  // inheritance needs its own native state machine, not a universal hide rule.
  for (const track of tracks) {
    if(track.clipRectangle)continue;
    const children=program.tracks[track.id].children;
    if(!children.length)continue;
    const titleLayout=nativeTitleLayout(document,program,program.tracks[track.id]);
    if(track.frames.slice(0,-1).some((frame,i)=>!('scaleX' in frame)&&(!titleLayout||children.some(id=>
      tracks[id].frames.slice(0,-1).some((child,j)=>'scaleX' in child&&child.time<track.frames[i+1].time&&tracks[id].frames[j+1].time>frame.time)))))
      fail(document,program,'inactive parent inheritance');
  }
  // Every accepted type0 track emits at most one quad. Count hidden/inactive
  // tracks too; no timeline sampling is needed to prove the small-list limit.
  const renderItemUpperBound = tracks.length;
  const order = rasterPriority(document, program, renderItemUpperBound);
  return { source: program, loopTime, tracks, order, renderItemUpperBound, ...rasterTreeBounds(tracks) };
}
export function decodeRasterTrack(document: MtnDocument, program: MtnProgram, track: MtnTrack, kind: boolean | 'layout' | 'clip' = false): LeafTrack {
  const container = kind === true, layout = kind === 'layout', clip = kind==='clip';
  const get = (name: string) => field(document, track.sourceRef, name), unsupported = (reason: string): never => fail(document, program, track.label + ': ' + reason);
  const sd002 = program.objectName === 'SD002' && program.motionName === 'SD002BA' && [5, 7].includes(track.id);
  const sd001 = program.objectName === 'SD001' && ['SD001GD', 'SD001HD'].includes(program.motionName);
  const sd003aa=document.name.toLowerCase()==='sd003.mtn'&&program.objectName==='SD003'&&program.motionName==='SD003AA'&&track.id===1&&track.sourceRef===5384;
  const seCue=motionCue(program.objectName,program.motionName);
  const cueTrack=seCue&&document.name.toLowerCase()===seCue.model.toLowerCase()&&track.id===seCue.trackId&&track.sourceRef===seCue.trackRef;
  const nested=nestedSeTimeline(document.name,program.objectName,program.motionName,program.sourceRef);
  const nestedKeys=nested?.keys.filter(k=>k.trackId===track.id&&k.trackRef===track.sourceRef)??[];
  const soundLayout=cueTrack||nestedKeys.length>0;
  const steam=document.name.toLowerCase()==='sd007.mtn'&&program.motionName==='efyuge'&&program.sourceRef===28652;
  const sd003Path=document.name.toLowerCase()==='sd003.mtn'&&(program.motionName==='SD003DA'&&program.sourceRef===15451&&track.sourceRef===15631||program.motionName==='efchallo'&&program.sourceRef===21604&&[22063,22738,23397,24094,24722].includes(track.sourceRef));
  if (layout && !makoFlowerLayout(document.name,track.sourceRef) && !nativeTitleLayout(document,program,track) && !waterLayout(document,program,track) && !(document.name.toLowerCase()==='sd006.mtn'&&/^_hana[1-4]$/.test(program.motionName)&&[17721,18281,18841,19401].includes(track.sourceRef)) && !(steam&&track.sourceRef===28703) && !soundLayout && !sd002 && !sd001 && !sd003aa && !(document.name.toLowerCase()==='sd004.mtn'&&program.motionName==='kagome'&&track.sourceRef===22303)) unsupported('layout outside the proven profiles');
  if (track.frames.length > 16384 || track.parent !== undefined && track.parent >= track.id) unsupported('frame/parent topology');
  const flatMesh=identityMeshTrack(track,get);
  for (const name of ['coordinate','meshCombine','groundCorrection',...(flatMesh?[]:['meshTransform'])]) if (motionNumber(get(name),name)!==0) unsupported(name);
  if (motionNumber(get('type'), 'type') !== (layout ? 2 : clip ? 7 : container ? 12 : 0) || ((layout || clip) && get('stencilType') === undefined ? 0 : motionNumber(get('stencilType'), 'stencilType')) !== (container ? 1 : 0)) unsupported('node/stencil profile');
  const independentAlpha=makoIndependentAlpha(document.name,track.sourceRef);
  if (motionNumber(get('inheritMask'), 'inheritMask') !== (container ? 37750780 : clip ? 37750380 : independentAlpha ? 33555452 : 33556476)) unsupported('partial inheritance flags');
  if (container) { const masks = get('stencilCompositeMaskLayerList'); if (!Array.isArray(masks) || masks.length) unsupported('composite mask references'); }
  if (motionNumber(get('exportSelf'), 'exportSelf') !== 1 || get('parameterize') !== null || get('metadata') !== null || motionNumber(get('joinTarget'), 'joinTarget') !== 1) unsupported('export/parameterize/metadata/joinTarget');
  const known = new Set(['children', 'coordinate', 'exportSelf', 'frameList', 'groundCorrection', 'inheritMask', 'joinTarget', 'label', 'meshCombine', 'meshDivision', 'meshTransform', 'metadata', 'objTriPriority', 'parameterize', 'stencilType', 'transformOrder', 'type',...(flatMesh?['meshSyncChildMask']:[])]);
  if (container) known.add('stencilCompositeMaskLayerList');
  for (const item of track.fields) if (!known.has(item.key)) unsupported('layer field ' + item.key);
  const rawOrder = get('transformOrder');
  if (!Array.isArray(rawOrder) || rawOrder.length !== 4) unsupported('transform order');
  const transformOrder = (rawOrder as PsbValue[]).map(value => motionNumber(value, 'transform order'));
  if (new Set(transformOrder).size !== 4 || transformOrder.some(value => !Number.isInteger(value) || value < 0 || value > 3)) unsupported('transform order permutation');
  const frames = track.frames.map<LeafTrack['frames'][number]>(frame => {
    if (frame.type === 0) { if (frame.contentRef !== undefined && psbValue(document.reader, frame.contentRef) !== null) unsupported('nonempty blank slot'); return { time: frame.time, type: 0 as const }; }
    if (frame.contentRef === undefined) return unsupported('active slot content');
    const content = psbRecord(psbValue(document.reader, frame.contentRef));
    const hasPath = !layout && !container && !clip && frame.type === 3 && Object.hasOwn(content, 'cp');
    const batchSkew=document.name.toLowerCase()==='sd004.mtn'&&program.motionName==='SD004BC'&&track.sourceRef===9370;
    const supported = new Set(['mask', 'src', 'ox', 'oy', 'coord', 'fx', 'fy', 'angle', 'zx', 'zy', 'opa', 'bm', 'ccc', 'acc', 'zcc']);
    if (layout && soundLayout) supported.add('act');
    if (hasPath) supported.add('cp');
    if(flatMesh){if(!identityMeshFrame(content))unsupported('mesh deformation');supported.add('mesh');}
    const sd009=document.name.toLowerCase()==='sd009.mtn'&&[14322,15858].includes(program.sourceRef);
    const steamSkew=sd009||steam&&track.sourceRef===28760||document.name.toLowerCase()==='sd003.mtn'&&program.sourceRef===21604&&(sd003Path||track.sourceRef===26817);
    if(batchSkew||steamSkew){supported.add('sx');supported.add('sy');}
    if(steamSkew)supported.add('scc');
    if((document.name.toLowerCase()==='sd012.mtn'&&program.sourceRef===48189&&track.sourceRef===48692||sd102White(document,program,track)||document.name.toLowerCase()==='sd003.mtn'&&program.sourceRef===21604&&[25395,25677,25963,26249,26535,26817].includes(track.sourceRef))&&content.color===4294967295n)supported.add('color');
    for (const key of Object.keys(content)) if (!supported.has(key)) unsupported('frame field ' + key);
    const mask = motionNumber(content.mask, 'mask'), allowed = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x400 | 0x800 | 0x1000 | 0x2000 | 0x20000 | (layout ? 0x40000 : hasPath ? 0x10000 : 0) | (batchSkew||steamSkew?0x180:0) | (steamSkew?0x4000:0) | (supported.has('color')?0x200:0) | (flatMesh?meshBit:0);
    if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0xffffffff || ((mask >>> 0) & ~allowed) !== 0) unsupported('frame mask ' + mask);
    if (hasPath && !(mask & 0x10000)) unsupported('position path mask');
    const blend=mask&0x20000?motionNumber(content.bm,'bm'):0;
    const multiply=blend===19&&makoMultiply(document.name,track.sourceRef);
    if(blend!==0&&!multiply&&!(blend===20&&additiveRaster(document,program,track)))unsupported('blend mode');
    if (typeof content.src !== 'string') unsupported('source identity');
    const source = content.src as string, match = /^src\/(.+)\/([^/]+)$/u.exec(source);
    const candidates = match ? document.textures.filter(texture => texture.sourceName === match[1] && texture.iconName === match[2]) : [];
    if (layout) {
      if (source !== 'layout' || ('act' in content) !== !!(mask & 0x40000) || mask & 0x40000 && !(cueTrack&&frame.time===seCue.times[1]&&content.act===seCue.action||nestedKeys.some(k=>frame.time===k.time&&frame.sourceRef===k.frameSourceRef&&frame.contentRef===k.contentSourceRef&&content.act===k.action))) unsupported('layout/action profile');
    } else if (clip) {
      if (source!=='clip'||frame.type!==2||![97,99].includes(mask)||Object.keys(content).some(key=>!['mask','src','ox','oy','coord','zx','zy'].includes(key))) unsupported('type-7 clip data');
    } else if (candidates.length !== 1) unsupported('source mapping ' + source);
    const coord = mask & 2 ? content.coord : [0, 0, 0];
    if (!Array.isArray(coord) || coord.length !== 3 || motionNumber(coord[2], 'coord.z') !== 0) unsupported('3D coordinate');
    const xyz = coord as PsbValue[], curve = (key: string, bit: number): MotionCurve | undefined => {
      if (!(mask & bit)) return;
      try { return motionCurve(content[key]); } catch (error) { return unsupported(key + ': ' + String(error)); }
    };
    const flip = (name: string, bit: number): boolean => {
      if (!(mask & bit)) return false;
      const flag = motionNumber(content[name], name); if (flag !== 0 && flag !== 1) unsupported('reflection flag ' + name);
      return flag === 1;
    };
    const pose = { time: frame.time, type: frame.type, src: source,
      flipX: flip('fx', 0x4), flipY: flip('fy', 0x8),
      x: motionNumber(xyz[0], 'coord.x'), y: motionNumber(xyz[1], 'coord.y'),
      ox: mask & 1 ? motionNumber(content.ox, 'ox') : 0, oy: mask & 1 ? motionNumber(content.oy, 'oy') : 0,
      angle: mask & 0x10 ? motionNumber(content.angle, 'angle') : 0,
      scaleX: mask & 0x60 && content.zx !== undefined ? motionNumber(content.zx, 'zx') : 1,
      scaleY: mask & 0x60 && content.zy !== undefined ? motionNumber(content.zy, 'zy') : 1,
      ...(blend===20&&{blend:'add' as const}),...(multiply&&{blend:'native-multiply' as const}),...((batchSkew||steamSkew)&&{skewCurve:curve('scc',0x4000),skewX:mask&0x80?motionNumber(content.sx,'sx'):0,skewY:mask&0x100?motionNumber(content.sy,'sy'):0}),
    opacity: mask & 0x400 ? Math.max(0, Math.min(255, motionNumber(content.opa, 'opa'))) / 255 : 1,
      positionPath: hasPath ? positionPath(content.cp,sd003Path?'sd003-da':program.motionName==='kagome'&&track.sourceRef===22360) : undefined, positionCurve: curve('ccc', 0x800), angleCurve: curve('acc', 0x1000), zoomCurve: curve('zcc', 0x2000) };
    return layout || clip ? { ...pose, layout: true as const } : { ...pose, texture: candidates[0] };
  });
  const finalPose=authoredFinalPose(document,program,track,frames,steam,()=>motionNumber(field(document,program.sourceRef,'loopTime'),'authored loop time'));
  if (frames.length < 2 || !finalPose && frames.at(-1)?.type !== 0 || frames.at(-1)!.time < program.lastTime) unsupported('terminal frame layout');
  return { id: track.id, parent: track.parent, transformOrder, frames, ...(independentAlpha&&{independentAlpha:true as const}), ...(clip&&{clipRectangle:true}) };
}
/** Only after the caller has rejected nonzero Z, non-normal blend, bit4,
 * independent child targets, mesh/particle and dynamic controls. Native draw
 * reads content[N-i-1]; its <=32 insertion sort preserves equal-key order.
 * See native-priority-tail.md. The bound MUST cover every nested child too.
 */
export function rasterPriority(document: MtnDocument, program: MtnProgram, renderItemUpperBound: number): readonly number[] {
  const name=document.name.toLowerCase();
  const sourceBudget=name==='sd204.mtn'&&program.sourceRef===9441?72:name==='sd204.mtn'&&program.sourceRef===15339?76:name==='sd204.mtn'&&program.sourceRef===5808?77:name==='sd005.mtn'&&['SD005CA','efCAkupa','星PCA'].includes(program.motionName)?1024:
    name==='sd006.mtn'&&['SD006BD','SD006BD2','hanaP'].includes(program.motionName)?256:
    name==='sd007.mtn'&&['SD007GJ','wasabg2'].includes(program.motionName)?64:32;
  if (!Number.isSafeInteger(renderItemUpperBound) || renderItemUpperBound < program.tracks.length || renderItemUpperBound > sourceBudget) fail(document, program, 'whole-tree render-item upper bound exceeds native small-list profile');
  const priority = field(document, program.sourceRef, 'priority');
  if (!Array.isArray(priority) || priority.length !== 2) fail(document, program, 'animated priority');
  const first = psbRecord(priority[0]), end = psbRecord(priority[1]);
  if (motionNumber(first.time, 'priority.time') !== 0 || motionNumber(first.type, 'priority.type') !== 1 || motionNumber(end.type, 'priority.end.type') !== 1 || motionNumber(end.time, 'priority.end') !== program.lastTime || end.content !== null || !Array.isArray(first.content)) fail(document, program, 'priority layout');
  const indices = first.content.map(item => motionNumber(item, 'priority id'));
  if (indices.length !== program.tracks.length || new Set(indices).size !== indices.length || indices.some(id => !Number.isInteger(id) || id < 0 || id >= program.tracks.length)) fail(document, program, 'priority permutation');
  return indices.reverse();
}
