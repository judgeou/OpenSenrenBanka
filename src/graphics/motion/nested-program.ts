import { psbRecord, psbValue } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import type { MtnProgram, MtnTrack } from '../mtn-program.ts';
import type { MtnTexture } from '../mtn-textures.ts';
import { decodeLeafProgram, decodeRasterTrack, motionNumber, rasterPriority } from './leaf-program.ts';
import type { LeafProgram, LeafTrack } from './leaf-program.ts';
import { rasterTreeBounds } from './tree-bounds.ts';
import {motionCurve} from './curve.ts';
import type {MotionCurve} from './curve.ts';
import { sd002baLayout } from './sd002ba-layout.ts';
import { decodeMotionEmitters, emitterLeaves, authoredBubble } from './particle-program.ts';
import {makoCrossChild,makoNestedCharacter,makoNestedLoop} from './mako-motion-profile.ts';
import {tailPose,tailTracks} from './mako-tail.ts';
import {makoPlaced203,makoPose203} from './mako-placement.ts';
import {allowsMotionCue,motionCue} from './se-profiles.ts';
import {nestedSeRoot,nestedSeTimeline} from './nested-se-profile.ts';
import type {NestedSeTimeline} from './nested-se-profile.ts';
import type { NativeMotionActionProfile } from '../native-frame-stage.ts';

export interface ChildSlot { readonly time: number; readonly type: number; readonly pose?:readonly [number,number,number,number]; readonly positionCurve?:MotionCurve; readonly zoomCurve?:MotionCurve; readonly pivot?:readonly [number,number]; readonly orientation?:readonly [number,number,number]; readonly child?: LeafProgram; readonly tree?:MotionTreeProgram; readonly offset: number; readonly opacity: number }
export interface ChildTrack { readonly id: number; readonly parent: number | undefined; readonly frames: readonly ChildSlot[] }
export interface MotionTreeProgram {
  readonly actionProfile?: NativeMotionActionProfile;
  readonly nestedSe?:NestedSeTimeline;
  readonly raster: LeafProgram; readonly children: readonly ChildTrack[]; readonly order: readonly number[];
  readonly source: MtnProgram; readonly loopTime: number; readonly textures: readonly MtnTexture[];
  /** Whole-tree upper bound; every wrapper instance includes its largest child clip. */
  readonly renderItemUpperBound: number;
  readonly width: number; readonly height: number; readonly originX: number; readonly originY: number;
}
function get(document: MtnDocument, ref: number, name: string): PsbValue | undefined {
  const at = document.reader.property(ref, name); return at === undefined ? undefined : psbValue(document.reader, at);
}
const steam103=(d:MtnDocument,p:MtnProgram):boolean=>d.name.toLowerCase()==='sd103.mtn'&&p.objectName==='SD103'&&p.motionName==='efEEyuge'&&p.sourceRef===45797;
function no(message: string): never { throw new Error('Unsupported native nested raster motion: ' + message); }
function effectiveParent(document: MtnDocument, program: MtnProgram, track: MtnTrack): number | undefined {
  let parent = track.parent;
  // PlayerUpdateLayerEval: skip ancestors with inheritFlags bit 0x00400000.
  // The SD001EC type12 root has this bit; it is not inherited as an affine parent.
  while (parent !== undefined && (motionNumber(get(document, program.tracks[parent].sourceRef, 'inheritMask'), 'parent inheritMask') & 0x400000)) parent = program.tracks[parent].parent;
  return parent;
}
function childTrack(document: MtnDocument, program: MtnProgram, track: MtnTrack): ChildTrack {
  const field = (name: string) => get(document, track.sourceRef, name);
  const wrapper=program.objectName==='SD004'&&program.motionName==='SD004BA'&&program.sourceRef===7353&&track.sourceRef===8221;
  if ((!wrapper&&track.children.length) || motionNumber(field('type'), 'child type') !== 3 || motionNumber(field('inheritMask'), 'child inheritMask') !== 33556476) no('child topology/inheritance');
  for (const key of ['coordinate', 'meshCombine', 'meshTransform', 'groundCorrection', 'stencilType', 'motionIndependentLayerInherit']) if (motionNumber(field(key), key) !== 0) no('child ' + key);
  if (field('metadata') !== null || field('parameterize') !== null || motionNumber(field('exportSelf'), 'exportSelf') !== 1 || motionNumber(field('joinTarget'), 'joinTarget') !== 1) no('child parameter/export profile');
  const known = new Set(['children','coordinate','exportSelf','frameList','groundCorrection','inheritMask','joinTarget','label','meshCombine','meshDivision','meshTransform','metadata','motionIndependentLayerInherit','parameterize','stencilType','transformOrder','type']);
  for (const field of track.fields) if (!known.has(field.key)) no('child layer field ' + field.key);
  const transform = field('transformOrder');
  if (!Array.isArray(transform) || transform.length !== 4 || new Set(transform.map(value => motionNumber(value, 'child transform order'))).size !== 4 || transform.some(value => { const number = motionNumber(value, 'child transform order'); return !Number.isInteger(number) || number < 0 || number > 3; })) no('child transform order');
  const placed=document.name.toLowerCase()==='sd009.mtn'&&program.sourceRef===10414&&track.sourceRef===11291;
  const sd014=document.name.toLowerCase()==='sd014.mtn'&&[6433,11395,13961,15339,17277].includes(track.sourceRef);
  const sd102=document.name.toLowerCase()==='sd102.mtn'&&[9854,10748,12030].includes(track.sourceRef);
  const roop=document.name.toLowerCase()==='sd104.mtn'&&program.objectName==='SD104';
  const sd012=document.name.toLowerCase()==='sd012.mtn'&&program.objectName==='SD012';
  const makoDA=document.name.toLowerCase()==='sd201.mtn'&&[10909,12253,20208].includes(track.sourceRef);
  const tail=document.name.toLowerCase()==='sd202.mtn'&&program.objectName==='char'&&tailTracks.has(track.sourceRef);
  const tailWarp=tail&&track.sourceRef===16073,pose203=makoPlaced203(document.name,track.sourceRef);
  const pivot:ChildSlot['pivot']=makoDA?(track.sourceRef===20208?[112.5,0]:[570,-212.25]):tailWarp?[23.25,-193.5]:undefined;
  const posed=roop||sd014||sd102||sd012||makoDA||tail||pose203||document.name.toLowerCase()==='sd007.mtn'&&program.motionName==='SD007GJ'&&program.sourceRef===20502&&track.sourceRef===20685||placed;
  const frames: ChildSlot[] = track.frames.map(frame => {
    if (frame.type === 0) return { time: frame.time, type: 0, offset: 0, opacity: 1 };
    if (frame.contentRef === undefined) return no('child frame has no content');
    const content = psbRecord(psbValue(document.reader, frame.contentRef));
    for (const key of Object.keys(content)) if (!['mask','motion','src','ox','oy','opa'].includes(key)&&!(posed&&['coord','zx','zy'].includes(key))&&!((sd014||makoDA||pose203)&&key==='ccc')&&!(makoDA&&key==='zcc')&&!(tailWarp&&['angle','sx','sy'].includes(key))) no('child frame field ' + key);
    const mask = motionNumber(content.mask, 'child mask');
    if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0xffffffff || (mask & ~(0x80000 | 1 | 0x400 | (posed?0x62:0) | (sd014||makoDA||pose203?0x800:0) | (makoDA?0x2000:0) | (tailWarp?0x190:0))) || !(mask & 0x80000) || !(mask & 1) || motionNumber(content.ox, 'child ox') !== (pivot?.[0]??0) || motionNumber(content.oy, 'child oy') !== (pivot?.[1]??0)) no('child transform/mask profile');
    const control = psbRecord(content.motion);
    for (const key of Object.keys(control)) if (!['mask','timeOffset'].includes(key)) no('child motion control ' + key);
    if (motionNumber(control.mask, 'child control mask') !== 0) no('child flags/angle control');
    const offset = motionNumber(control.timeOffset, 'child timeOffset');
    if (typeof content.src !== 'string') return no('child source');
    const path = /^motion\/([^/]+)\/([^/]+)$/u.exec(content.src);
    if (!path) return no('child source path');
    if (path[1] !== program.objectName && !(roop&&path[1]==='roop')&&!makoCrossChild(document.name,program.objectName,path[1])) no('cross-object child Player');
    const childSource = document.motionProgram(path[1], path[2]);
    const nestedCue=nestedSeRoot(program.objectName,program.motionName);
    const eventfulChild=nestedCue&&nestedCue.rootRef===program.sourceRef&&nestedCue.childTrack===track.sourceRef&&nestedCue.timeline.ref===childSource.sourceRef&&offset===0;
    const subtree=(eventfulChild||makoNestedCharacter(document.name,path[1],childSource.sourceRef)||steam103(document,childSource)||sd012&&path[2]==='efAB3'&&childSource.sourceRef===45168||path[1]==='SD005'&&path[2]==='efCAkupa'&&childSource.sourceRef===26034||path[1]==='SD007'&&path[2]==='efDCheart'&&childSource.sourceRef===23248||path[1]==='SD101'&&[16437,18483].includes(childSource.sourceRef)||path[1]==='SD102'&&childSource.sourceRef===24730)?decodeMotionTree(document,path[1],path[2]):undefined;
    const bubble=path[1]==='SD004'&&['泡PAB','泡PBC','泡PDD'].includes(path[2]);
    const star=path[1]==='SD005'&&path[2]==='星PCA';
    const newEmitter=authoredBubble(document,childSource)||path[1]==='SD003'&&path[2]==='涙PED'||path[1]==='SD006'&&path[2]==='hanaP'||path[1]==='SD007'&&path[2]==='wasabg2'||path[1]==='SD010'&&[19596,21559,22891,23480].includes(childSource.sourceRef)||path[1]==='SD014'&&childSource.sourceRef===19127||path[1]==='SD101'&&[10889,12481].includes(childSource.sourceRef)||path[1]==='SD102'&&childSource.sourceRef===16514;
    const child = subtree ? {...subtree.raster,renderItemUpperBound:subtree.renderItemUpperBound} : ((newEmitter || star || bubble || path[1] === 'SD001' && path[2] === '汗PED' || path[1] === 'SD002' && path[2] === '涙PED') ? decodeMotionEmitters(document, childSource) : decodeLeafProgram(document, path[1], path[2]));
    let pose:ChildSlot['pose'],orientation:ChildSlot['orientation'];
    if(roop){
      const coord=content.coord;
      if(path[1]!=='roop'||frame.type!==2||mask!==524291||!Array.isArray(coord)||coord.length!==3||motionNumber(coord[2],'roop z')!==0)no('original roop child placement');
      const [x,y]=(coord as PsbValue[]).map(v=>motionNumber(v,'roop position'));
      if(Math.abs(x)>1024||Math.abs(y)>1024)no('roop child position domain');
      pose=[x,y,1,1];
    }else if(pose203){pose=makoPose203(track.sourceRef,frame.type,mask,content);
    }else if(tail){({pose,orientation}=tailPose(track.sourceRef,frame.type,mask,content));
    }else if(makoDA){
      const c=content.coord;
      if(frame.type!==3||![0x80003,0x82c63,0x80463].includes(mask)||!Array.isArray(c)||c.length!==3||Number(c[0])!==pivot![0]||![-224.25,pivot![1]].includes(Number(c[1]))||Number(c[2])!==0)no('SD201 jump pose');
      const sx=mask&0x60?motionNumber(content.zx,'SD201 zoom x'):1,sy=mask&0x60?motionNumber(content.zy,'SD201 zoom y'):1;
      if(sx<.08||sx>1||sy<.5||sy>1.12)no('SD201 jump scale');
      pose=[Number((c as PsbValue[])[0]),Number((c as PsbValue[])[1]),sx,sy];
    }else if(sd012&&(mask&0x62)){
      const c=content.coord;
      if(frame.type!==2||mask!==524291||!Array.isArray(c)||c.length!==3||Number(c[2])!==0)no('authored SD012 child translation');
      const [x,y]=(c as PsbValue[]).map(v=>motionNumber(v,'SD012 child translation'));
      if(x< -381||x>59.25||y< -240||y>48.75)no('authored SD012 child translation range');
      pose=[x,y,1,1];
    }else if(sd102){
      const c=content.coord;
      if(frame.type!==2||mask!==524291||!Array.isArray(c)||c.length!==3||Number(c[0])!==15.75||Number(c[1])!==0||Number(c[2])!==0)no('authored SD102 child placement');
      pose=[15.75,0,1,1];
    }else if(sd014){
      const c=content.coord;
      if(![2,3].includes(frame.type)||(mask!==524291&&mask!==526339)||!Array.isArray(c)||c.length!==3||Number(c[2])!==0)no('authored SD014 child position');
      const [x,y]=(c as PsbValue[]).map(v=>motionNumber(v,'child position'));
      if(x< -334||x> -315||y!==75.75||!!(mask&0x800)!==Object.hasOwn(content,'ccc'))no('authored child position limits');
      pose=[x,y,1,1];
    }else if(posed&&mask&0x62){const coord=content.coord;if(frame.type!==2||mask!==(placed?524291:524387)||!Array.isArray(coord)||coord.length!==3||motionNumber(coord[2],'child z')!==0)no('original jump pose');
      const [x,y]=(coord as PsbValue[]).map(v=>motionNumber(v,'child translation')),sx=placed?1:motionNumber(content.zx,'child scaleX'),sy=placed?1:motionNumber(content.zy,'child scaleY');
      if(Math.abs(x)>8||y < (placed?-44:-26)||y>3||sx<1||sx>1.11||sy<1||sy>1.21)no('original jump pose bounds');pose=[x,y,sx,sy];}
    return { time: frame.time, type: frame.type, child, tree:subtree, offset,pose,pivot,orientation, positionCurve:(sd014||makoDA||pose203)&&(mask&0x800)?motionCurve(content.ccc,makoDA):undefined, zoomCurve:makoDA&&(mask&0x2000)?motionCurve(content.zcc):undefined, opacity: mask & 0x400 ? Math.max(0, Math.min(255, motionNumber(content.opa, 'child opacity'))) / 255 : 1 };
  });
  if (frames.length < 2 || frames.length > 16384 || frames[0].time !== 0 || frames.at(-1)?.type !== 0 || frames.at(-1)!.time < program.lastTime) no('child terminal frame');
  const parent=program.objectName==='SD004'&&program.motionName==='SD004BA'&&track.sourceRef===8284&&track.parent===6?program.tracks[6].parent:effectiveParent(document,program,track);
  return { id: track.id, parent, frames };
}
/** Finite SD001EC-family decoder: zero-Z normal rasters, identity wrappers,
 * type12/stencil1 containers and a whole-tree <=32 item bound. Priority uses
 * the native reverse-table direction only inside this proven small-list profile.
 * No alpha-mask composite, mesh, child-angle mode or arbitrary recursion.
 */
export function decodeMotionTree(document: MtnDocument, object: string, motion: string, actionProfile?: NativeMotionActionProfile): MotionTreeProgram {
  if (actionProfile && !allowsMotionCue(actionProfile,motionCue(object,motion))) no('action profile identity');
  const source = document.motionProgram(object, motion);
  const types = source.tracks.map(track => motionNumber(get(document, track.sourceRef, 'type'), 'node type'));
  const nestedSe=nestedSeTimeline(document.name,object,motion,source.sourceRef);
  if(nestedSe&&(source.lastTime!==nestedSe.period||source.loopTime?.kind!=='integer'||source.loopTime.nativeValue!==0n||nestedSe.keys.some(k=>source.tracks[k.trackId]?.sourceRef!==k.trackRef||!source.tracks[k.trackId].frames.some(f=>f.time===k.time&&f.type===2&&f.sourceRef===k.frameSourceRef&&f.contentRef===k.contentSourceRef))))no('original nested SE identity/slots');
  if (!nestedSe&&!types.some(type => type === 3 || type === 12)) {
    const raster = decodeLeafProgram(document, object, motion);
    return { ...raster, raster, children: [], textures: textures([raster]) };
  }
  if (!source.tracks.length || source.tracks.length > 1024) no('hierarchy budget');
  const known = new Set(['lastTime','layer','loopTime','metadata','parameter','parameterize','priority','referenceModelFileList','referenceProjectFileList','tag','type','variable']);
  for (const item of source.fields) if (!known.has(item.key)) no('motion field ' + item.key);
  if (motionNumber(get(document, source.sourceRef, 'type'), 'motion type') !== 0 || get(document, source.sourceRef, 'metadata') !== null || get(document, source.sourceRef, 'parameterize') !== null) no('motion parameter/type profile');
  for (const key of ['parameter','referenceModelFileList','referenceProjectFileList','tag','variable']) { const list = get(document, source.sourceRef, key); if (!Array.isArray(list) || list.length) no('motion ' + key); }
  const loopTime=source.loopTime?.kind==='integer'?Number(source.loopTime.nativeValue):NaN;
  if(!nestedSe&&loopTime!==-1&&!makoNestedLoop(document.name,object,source.sourceRef,loopTime)&&!(document.name.toLowerCase()==='sd012.mtn'&&object==='SD012'&&motion==='efAB3'&&source.sourceRef===45168&&source.lastTime===20&&loopTime===0)&&!(steam103(document,source)&&loopTime===0)&&!(object==='SD005'&&motion==='efCAkupa'&&source.sourceRef===26034&&loopTime===120)&&!(object==='SD007'&&motion==='efDCheart'&&source.sourceRef===23248&&loopTime===30)&&!(object==='SD101'&&[16437,18483].includes(source.sourceRef)&&loopTime===0)&&!(object==='SD102'&&source.sourceRef===24730&&loopTime===0))no('looping parent with children');
  const tracks: LeafTrack[] = [], children: ChildTrack[] = [];
  for (const track of source.tracks) {
    const type = types[track.id];
    if (type === 3) children.push(childTrack(document, source, track));
    else if (type === 0 || type === 12 || type === 2 || type === 7 && document.name.toLowerCase()==='sd012.mtn' && [30753,33601,36449,39297].includes(track.sourceRef)) tracks.push({ ...decodeRasterTrack(document, source, track, type === 2 ? 'layout' : type === 7 ? 'clip' : type === 12), parent: effectiveParent(document, source, track) });
    else no('node type ' + type);
  }
  if (children.length > 32) no('child player budget');
  const rasterIds = new Set(tracks.map(track => track.id));
  for (const track of tracks) {
    if (track.parent !== undefined && !rasterIds.has(track.parent)) no('raster beneath a Motion wrapper');
    const direct=source.tracks[track.id].children;
    const gapOverlapsChild=direct.length&&track.frames.slice(0,-1).some((f,i)=>!('scaleX' in f)&&direct.some(id=>
      source.tracks[id].frames.slice(0,-1).some((slot,j)=>slot.type!==0&&slot.time<track.frames[i+1].time&&source.tracks[id].frames[j+1].time>f.time)));
    if (gapOverlapsChild && !(actionProfile && track.id === 5) && !(source.objectName==='SD004'&&source.motionName==='SD004BC'&&source.sourceRef===8967&&track.id===5)) no('inactive raster parent');
  }
  for (const child of children) if (child.parent !== undefined && !rasterIds.has(child.parent)) no('child transform parent');
  if (actionProfile&&motion==='SD002BA') sd002baLayout(document, source, tracks, children);
  const childPrograms = children.flatMap(track => track.frames.flatMap(frame => frame.child ? [frame.child] : []));
  // One Player exists per wrapper; the two timeline slots are NOT two render
  // instances. Max over its possible clips, sum across distinct wrappers, even
  // when those wrappers reference the same action. Include all parent nodes as
  // a conservative bound (including nondrawing wrappers and inactive tracks).
  const renderItemUpperBound = source.tracks.length + children.reduce((sum, track) =>
    sum + track.frames.reduce((largest, frame) => Math.max(largest, frame.child?.renderItemUpperBound ?? 0), 0), 0);
  const order = rasterPriority(document, source, renderItemUpperBound);
  const extent = rasterTreeBounds(tracks, children.flatMap(track => track.frames.flatMap(frame => frame.child ? [{ parent: track.parent, left:(frame.pose?.[0]??0)-frame.child.originX*(frame.pose?.[2]??1), top:(frame.pose?.[1]??0)-frame.child.originY*(frame.pose?.[3]??1), right:(frame.pose?.[0]??0)+(frame.child.width-frame.child.originX)*(frame.pose?.[2]??1), bottom:(frame.pose?.[1]??0)+(frame.child.height-frame.child.originY)*(frame.pose?.[3]??1) }] : [])));
  const raster: LeafProgram = { source, loopTime: -1, tracks, order: order.filter(id => rasterIds.has(id)), renderItemUpperBound: tracks.length, ...extent };
  const images=new Map(textures([raster,...childPrograms.flatMap(emitterLeaves)]).map(t=>[t.key,t]));
  for(const track of children)for(const frame of track.frames)for(const t of frame.tree?.textures??[])images.set(t.key,t);
  return { ...extent, source, loopTime, raster:{...raster,loopTime}, children, order, renderItemUpperBound, actionProfile, nestedSe, textures:[...images.values()] };
}
function textures(programs: readonly LeafProgram[]): readonly MtnTexture[] {
  const values = new Map<string, MtnTexture>();
  for (const program of programs) for (const track of program.tracks) for (const frame of track.frames) if ('texture' in frame) values.set(frame.texture.key, frame.texture);
  return [...values.values()];
}
