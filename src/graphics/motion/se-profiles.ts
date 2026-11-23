import {nestedSeRoot,nestedSeRoots} from './nested-se-profile.ts';
import type {NestedSeRoot} from './nested-se-profile.ts';
/** Three original finite SE tracks. Offsets identify the authored PSB slots, not script text numbers. */
export const motionCues=[
  {profile:'sd002ba-se001-v1',model:'SD002.mtn',object:'SD002',motion:'SD002BA',rootRef:5682,trackId:7,trackRef:7351,frameSourceRef:7415,contentSourceRef:7428,action:'se001',times:[0,60,61,90],lastTime:90,loopTime:-1,geometry:'sd002ba-layout-bounds-v1'},
  {profile:'sd003bd-se003-v1',model:'SD003.mtn',object:'SD003',motion:'SD003BD',rootRef:8364,trackId:8,trackRef:10587,frameSourceRef:10651,contentSourceRef:10664,action:'se003',times:[0,47,48,59],lastTime:59,loopTime:-1,geometry:'sd003-se-layout-bounds-v1'},
  {profile:'sd003ch-se004-v1',model:'SD003.mtn',object:'SD003',motion:'SD003CH',rootRef:13945,trackId:6,trackRef:15211,frameSourceRef:15275,contentSourceRef:15288,action:'se004',times:[0,25,26,45],lastTime:45,loopTime:-1,geometry:'sd003-se-layout-bounds-v1'},
] as const;
export type MotionCue = (typeof motionCues)[number];
export type RootMotionCue=MotionCue|NestedSeRoot;
export type MotionCueId=RootMotionCue['profile'];
export const rootMotionCues:readonly RootMotionCue[]=[...motionCues,...nestedSeRoots];
export function rootMotionCue(object:unknown,motion:unknown):RootMotionCue|undefined{return motionCue(object,motion)??nestedSeRoot(object,motion);}
export function motionCue(object:unknown,motion:unknown):MotionCue|undefined {return motionCues.find(row=>row.object===object&&row.motion===motion);}
export function allowsMotionCue<T extends RootMotionCue>(profile:unknown,cue:T|undefined):cue is T {
  return !!cue&&(profile==='r66-motion-se-v1'||profile==='sd002ba-se001-v1'&&cue.profile===profile);
}
