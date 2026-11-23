import type {NativeSession} from '../native-session-types.ts';
import type {ReplayPlan} from '../../src/runtime/live-scene-history.ts';
import type {NativeSessionOptions} from '../native-session-options.ts';

export interface ReplaySurface {area:HTMLDivElement;canvas:HTMLCanvasElement;overlay:HTMLElement}
export interface StagedReplay extends ReplaySurface {session:NativeSession;activate():void}
export async function stageBacklogReplay(viewport:HTMLElement,previous:HTMLCanvasElement,previousOverlay:HTMLElement,plan:ReplayPlan,
    prepare:(surface:ReplaySurface,context:AudioContext,options:NativeSessionOptions)=>Promise<NativeSession>):Promise<StagedReplay>{
  if(document.hidden)throw Error('请在可见的游戏画面内回跳');
  const area=document.createElement('div'),canvas=previous.cloneNode(false) as HTMLCanvasElement,overlay=previousOverlay.cloneNode(false) as HTMLElement;
  area.className='pc-replay-surface pc-replay-staging';area.inert=true;canvas.id='';overlay.id='';
  overlay.classList.remove('native-pixel-ui','pc-message-hidden');area.append(canvas,overlay);viewport.append(area);
  const context=new AudioContext(),gain=context.createGain();gain.gain.value=0;gain.connect(context.destination);
  let session:NativeSession|undefined,held=true;
  try{
    await context.resume();await context.suspend();
    session=await prepare({area,canvas,overlay},context,{sceneHistory:plan.journal,audioOutput:gain,stageAudioHeld:()=>held});
    if(session.identity!==plan.identity||!session.restoreHistory)throw Error('当前资源与回跳点不一致');
    await session.restoreHistory(plan);
    session.invalidateSurface?.(); // The restore may already have painted while the candidate was hidden. Require a fresh receipt.
    const start=performance.now();let last=start,painted=false;
    const entry=plan.entry,l=entry.location;
    for(;;){
      if(document.hidden)throw Error('游戏已切到后台');
      const tick=performance.now(),reported=await session.step(Math.min(50,Math.max(0,tick-last)));last=tick;
      painted||=reported.painted;const v=session.view(),p=v.position;
      const exact=p.asset===l.asset&&p.scene===l.scene&&(entry.kind==='choice'
        ?v.waiting.kind==='choice'&&p.cursor===plan.snapshot.position.cursor&&!v.saveReason
        :p.currentText===entry.key&&p.cursor===l.event+1&&v.waiting.kind==='dialogue');
      if(exact&&painted&&!v.awaitingPresentation&&!v.paused){
        held=false;await context.resume();
        return {area,canvas,overlay,session,activate:()=>{gain.gain.value=1;}};
      }
      if(tick-start>4200||p.asset!==l.asset||p.scene!==l.scene||entry.kind==='dialogue'&&p.cursor>l.event+1)throw Error('未取得目标渲染：'+[p.asset,p.scene,p.cursor,p.currentText,v.waiting.kind,v.saveReason,exact,painted,v.awaitingPresentation,v.paused,plan.snapshot.position.cursor].join(' | '));
      await new Promise<void>(r=>setTimeout(r,22));
    }
  }catch(error){
    try{if(session)await session.close();else await context.close();}finally{area.remove();}
    throw error;
  }
}
import type {SystemProgressData} from '../native-session-types.ts';
import type {YoshinoRoute} from './route-policy.ts';
export async function openHistoryTarget(viewport:HTMLElement,canvas:HTMLCanvasElement,overlay:HTMLElement,old:NativeSession,plan:ReplayPlan,route:YoshinoRoute,
    open:(s:ReplaySurface,c:AudioContext,p:SystemProgressData,a:ReturnType<YoshinoRoute['afterFor']>,o:NativeSessionOptions)=>Promise<NativeSession>,valid:()=>boolean){
  if(!valid()||old.identity!==plan.identity)throw Error('原会话或资源已经改变');
  const initial=old.systemProgress();route.checkProgress(initial);
  const after=route.afterFor(plan.entry.location.asset);
  if(after&&!route.unlocked(initial.sf).includes(after))throw Error('后日谈尚未解锁');
  const staged=await stageBacklogReplay(viewport,canvas,overlay,plan,(s,c,o)=>open(s,c,initial,after,o));
  try{
    if(!valid()||document.hidden)throw Error('回跳所有权已经改变');
    // Old music stays live during confirmation/preparation, but never mixes with the new owner.
    await old.pause(true,'history-handoff');
    if(!valid()||document.hidden)throw Error('回跳所有权已经改变');
    return staged;
  }catch(error){
    try{await staged.session.close();}finally{staged.area.remove();if(valid())await old.pause(false,'history-handoff');}
    throw error;
  }
}
