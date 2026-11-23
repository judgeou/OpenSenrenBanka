import type {PreparedGraphicFrame} from './prepared-frames.ts';
type FrameDescriptor=Omit<PreparedGraphicFrame,'source'|'preparePixels'|'release'>;

/** Resolve exact stand metadata independently of its pixels. One owner may be
 * shared by an old and new presentation; each requested variant stays immutable
 * until that owner is retired, and unused variants never borrow a bitmap. */
export function deferredStandFrame(info:FrameDescriptor,load:()=>Promise<PreparedGraphicFrame>):PreparedGraphicFrame {
  let held:PreparedGraphicFrame|undefined,pending:Promise<void>|undefined,released=false;
  return {...info,
    get source(){return held?.source;},
    async preparePixels(){
      if(released)throw Error('Retired stand pixels cannot be prepared');
      if(held)return;
      pending??=load().then(frame=>{
        if(released||!frame.source||frame.key!==info.key||frame.width!==info.width||frame.height!==info.height){
          frame.release();throw Error('Stand pixel lease no longer matches its owner');
        }
        held=frame;
      }).finally(()=>{pending=undefined;});
      return pending;
    },
    release(){if(!released){released=true;held?.release();held=undefined;}}
  };
}
