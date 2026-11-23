import type {NativeOp} from './native-op.ts';
export function sessionPause(context:AudioContext,op:NativeOp|undefined,retire:()=>void,stageAudioHeld?:()=>boolean){
  return async(stageHeld:boolean,suspendAudio=stageHeld)=>{
    const hide=()=>{op?.pause(true);retire();};
    if(stageHeld||document.hidden)hide();
    if(suspendAudio||document.hidden){await context.suspend();return stageHeld;}
    if(stageAudioHeld?.())return true;
    if(context.state!=='running'){await context.resume();if(context.state as string!=='running')throw Error('请通过用户操作重新解锁音频');}
    if(document.hidden){hide();await context.suspend();return stageHeld;}
    if(!stageHeld)op?.pause(false);return true;
  };
}
