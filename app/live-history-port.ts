import {LiveSceneHistory} from '../src/runtime/live-scene-history.ts';
import type {ScenePlayer} from '../src/runtime/scene-player.ts';
import type {NativeSessionDriver} from '../src/runtime/native-session-driver.ts';
import type {ReplayPlan} from '../src/runtime/live-scene-history.ts';
import type {SystemProgressData} from './native-session-types.ts';
export function liveHistoryPort(journal:LiveSceneHistory,player:ScenePlayer,driver:NativeSessionDriver,
    allowed:()=>boolean,progress:()=>SystemProgressData,cancelPrefetch:()=>void,window:import('./ui/native-window.ts').NativeWindow){
  let hidden=false;
  return {
    historyAvailable:()=>{const w=player.waiting;return allowed()&&!driver.awaitingPresentation&&(w.kind==='dialogue'||w.kind==='choice');},
    historyBackdrop:async(show:boolean)=>{
      if(!show){await driver.action(async()=>window.setPlayerHidden(hidden));return;}
      if(!player.clock.snapshot().paused||!allowed())throw Error('原场景尚不能打开历史');
      hidden=window.playerHidden;
      try{window.setPlayerHidden(true);if(!await driver.paintBacklog())throw Error('历史底图未提交');}
      catch(error){window.setPlayerHidden(hidden);throw error;}
    },
    sceneHistory:()=>journal.rows(player.position),
    historyPlan:(key:number)=>{
      if(!player.clock.snapshot().paused||!allowed())throw Error('历史页面不再拥有当前会话');
      const {sf,read}=progress();return journal.plan(key,player.history,player.position,read,sf);
    },
    restoreHistory:(plan:ReplayPlan)=>{
      if(plan.identity!==journal.identity||plan.journal!==journal)throw Error('历史回跳资源身份不符');
      cancelPrefetch();return driver.restore(plan.snapshot,plan.entry.kind==='dialogue'?plan.entry.key:undefined);
    },
  };
}
export function historyRecorder(option:LiveSceneHistory|true|undefined,identity:string,caption:()=>string,capture:<T>(work:()=>Promise<T>)=>Promise<T>,eligible:()=>boolean){
  if(!option)return;
  const journal=option===true?new LiveSceneHistory(identity):option;
  if(journal.identity!==identity)throw Error('Backlog resource identity mismatch');
  return {journal,caption,capture,eligible};
}
