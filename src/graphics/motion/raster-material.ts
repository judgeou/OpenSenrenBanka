import type {MtnDocument} from '../mtn-catalog.ts';
import type {MtnProgram, MtnTrack} from '../mtn-program.ts';

export function nativeTitleLayout(document:MtnDocument,program:MtnProgram,track:MtnTrack):boolean {
  if(document.name.toLowerCase()!=='title_bg.mtn'||program.objectName!=='title_bg'||program.motionName!=='char_move')return false;
  const type=document.reader.property(track.sourceRef,'type');
  if(type===undefined)return false;
  const node=document.reader.node(type);
  return node.kind==='integer'&&node.nativeValue===2n;
}

export function additiveRaster(document: MtnDocument, program: MtnProgram, track: MtnTrack): boolean {
  if(document.name.toLowerCase()==='sd012.mtn'&&program.sourceRef===48189&&track.sourceRef===48692)return true;
    if(document.name.toLowerCase()==='sd010.mtn'&&program.sourceRef===22149&&track.sourceRef===22569)return true;
  if(sd102White(document,program,track))return true;
  return document.name.toLowerCase()==='sd005.mtn'&&program.motionName==='_hosi'&&track.sourceRef===24961||
      document.name.toLowerCase()==='sd007.mtn'&&(program.motionName==='efDCheart2'&&program.sourceRef===24733&&[24786,25193].includes(track.sourceRef)||program.motionName==='starsplash'&&track.sourceRef===29576)||
      document.name.toLowerCase()==='sd003.mtn'&&program.motionName==='efchallo'&&program.sourceRef===21604&&[25395,25677,25963,26249,26535,26817].includes(track.sourceRef);
}

export const waterLayout=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>d.name.toLowerCase()==='sd010.mtn'&&/^_mizu[1-3]s?$/u.test(p.motionName)&&[15619,15676,16578,17332,18113,18868].includes(t.sourceRef);
export const waterArc=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>d.name.toLowerCase()==='sd010.mtn'&&p.sourceRef===20563&&p.motionName==='efBC'&&t.sourceRef===20616;
export const steam014=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>d.name.toLowerCase()==='sd014.mtn'&&p.sourceRef===20824&&[20882,21497,22095].includes(t.sourceRef);
export const sd102White=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>d.name.toLowerCase()==='sd102.mtn'&&p.sourceRef===19457&&t.sourceRef===20197;
export const sd102Heart=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>d.name.toLowerCase()==='sd102.mtn'&&p.sourceRef===17595&&[17648,18537].includes(t.sourceRef);
export const sd014Arc=(d:MtnDocument,p:MtnProgram,t:MtnTrack):boolean=>steam014(d,p,t)||d.name.toLowerCase()==='sd014.mtn'&&p.sourceRef===16381&&t.sourceRef===16562;
