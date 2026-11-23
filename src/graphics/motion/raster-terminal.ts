import {tailTerminal} from './mako-tail.ts';
import {makoFlowerLayout} from './mako-motion-profile.ts';
import type {MtnDocument} from '../mtn-catalog.ts';
import type {MtnProgram, MtnTrack} from '../mtn-program.ts';
import {waterArc,steam014,sd102Heart} from './raster-material.ts';

export function authoredFinalPose(document:MtnDocument,program:MtnProgram,track:MtnTrack,frames:readonly {time:number;type:number}[],steam:boolean,loop:()=>number):boolean {
  // This original looping SteamCH track supplies a final interpolation key,
  // not a blank. Its player wraps at 80 to 20; preserve the authored last pose.
  const steamEnd=document.name.toLowerCase()==='sd003.mtn'&&program.objectName==='SD003'&&program.motionName==='湯気CH'&&
    [30059,30720].includes(track.sourceRef)&&program.lastTime===80&&loop()===20&&
    frames.at(-1)?.time===80&&frames.at(-1)?.type===3;
  const kagomeEnd=document.name.toLowerCase()==='sd004.mtn'&&program.motionName==='kagome'&&
    [21929,22303,22360,23969,24707].includes(track.sourceRef)&&program.lastTime===150&&
    loop()===0&&frames.at(-1)?.time===150&&frames.at(-1)?.type===3;
  const starEnd=document.name.toLowerCase()==='sd005.mtn'&&program.motionName==='efCAkupa'&&[26238,26818].includes(track.sourceRef)&&program.lastTime===239&&loop()===120&&frames.at(-1)?.time===239&&frames.at(-1)?.type===3;
  const sd101End=document.name.toLowerCase()==='sd101.mtn'&&loop()===0&&(program.sourceRef===15916&&program.lastTime===360&&track.sourceRef===15967||program.sourceRef===16437&&program.lastTime===120&&[16497,17097,17701].includes(track.sourceRef));
  const authoredEnd=frames.at(-1)?.type===3&&frames.at(-1)?.time===program.lastTime&&
    (sd101End||sd102Heart(document,program,track)&&program.lastTime===120&&loop()===0||steam014(document,program,track)&&program.lastTime===80&&loop()===0||waterArc(document,program,track)&&program.lastTime===120&&loop()===45||steam&&program.lastTime===180&&[28703,28760].includes(track.sourceRef)||
    document.name.toLowerCase()==='sd007.mtn'&&program.motionName==='efDCheart'&&program.sourceRef===23248&&program.lastTime===120&&[23306,23897].includes(track.sourceRef)||
    document.name.toLowerCase()==='sd006.mtn'&&[31510,32527,28070,28796,29632,30649].includes(track.sourceRef)&&
    (program.motionName==='efnade丁寧'&&program.sourceRef===28017&&program.lastTime===100||program.motionName==='efnade出速'&&program.sourceRef===31454&&program.lastTime===113||program.motionName==='efnade出丁寧'&&program.sourceRef===29576&&program.lastTime===141));
  const steam103=document.name.toLowerCase()==='sd103.mtn'&&program.objectName==='SD103'&&(program.motionName==='efEEyuge'&&program.sourceRef===45797&&program.lastTime===60||program.motionName==='efEBuma'&&program.sourceRef===42824&&program.lastTime===20)&&loop()===0&&
    frames.at(-1)?.time===program.lastTime&&frames.at(-1)?.type===3;
  const makoAfterimage=document.name.toLowerCase()==='sd201.mtn'&&program.objectName==='char'&&program.motionName==='makoBC'&&[17057,17661,18303].includes(track.sourceRef)&&loop()===0&&frames.at(-1)?.time===60&&frames.at(-1)?.type===3;
  const makoTail=document.name.toLowerCase()==='sd202.mtn'&&program.objectName==='char'&&frames.at(-1)?.type===3&&frames.at(-1)?.time===program.lastTime&&tailTerminal(track.sourceRef,program.lastTime)&&loop()===0;
  const makoFlower=document.name.toLowerCase()==='sd203.mtn'&&program.sourceRef===46505&&track.sourceRef===47161&&frames.at(-1)?.type===3&&frames.at(-1)?.time===190&&loop()===90;
  const flowerKey=makoFlowerLayout(document.name,track.sourceRef)&&loop()===0&&frames.at(-1)?.type===3&&frames.at(-1)?.time===program.lastTime;
  return steamEnd||kagomeEnd||starEnd||authoredEnd||steam103||makoAfterimage||makoTail||makoFlower||flowerKey;
}
