import './style.css';
import './touch-layout.css';
import type { NativeSession,SystemProgressData } from '../native-session.ts';
import { showNativeTitle } from '../native-title.ts';
import type { NativeTitle } from '../native-title.ts';
import { sessionSettings } from '../session-settings.ts';
import { QuickSlotStore } from '../quick-slot.ts';
import type {OpenedSlot} from '../save-card.ts';
import {SaveFlow} from './save-flow.ts';
import {saveChapter} from './save-chapter.ts';
import { YoshinoRoute } from './route-policy.ts';
import {storyStatus} from './story-status.ts';
import { bytesPerMB,loadSettings,persistSettings,settingsForm } from './settings.ts';
import type { Settings } from './settings.ts';
import {HoldSkipKeys} from './hold-skip-keys.ts';
import {StoryLoading} from './story-loading.ts';
import { el,panel,showPanel,confirmAction,confirming,touchLayout } from './panels.ts';
import { bindSurfaceTap, bindMouseAdvance } from './surface-tap.ts';
import type {PcStoryChrome} from './pc-story-chrome.ts';
import {StoryWakeQueue} from './story-wake.ts';
import {StoryProgress} from './story-progress.ts';
import {showAfterOptions} from './edition-title-dialog.ts';
import {openEditionStory} from './edition-story.ts';
import {BacklogFlow} from './backlog-flow.ts';
import type {ReplayPlan} from '../../src/runtime/live-scene-history.ts';
import type {NativeSessionOptions} from '../native-session-options.ts';
import {storyDom} from './story-dom.ts';

const systemFontFamily='"Microsoft YaHei", "微软雅黑", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "DengXian", "WenQuanYi Micro Hei", system-ui, sans-serif';
document.documentElement.style.setProperty('--game-font',systemFontFamily);

const root=new URL('resources/',document.baseURI),viewport=el('viewport'),warning=el('warning'),status=el('status');
const b=(id:string)=>el<HTMLButtonElement>(id), gameMenu=el<HTMLDialogElement>('game-menu'), versions='yoshino-v1';
const touchMenu=b('touch-menu');
const emptyProgress:SystemProgressData={sf:{},read:[]};
const holdKeys=new HoldSkipKeys(undefined,heldChanged),storyLoading=new StoryLoading();
let canvas=el<HTMLCanvasElement>('game'),overlay=el('native-ui'),replaySurface:HTMLElement|undefined,store:QuickSlotStore,route:YoshinoRoute,settings:Settings;
let title:NativeTitle|undefined,current:NativeSession|undefined,fileUI:SaveFlow;
let pending=false,epoch=0,notice='',crashed=false,holdTimer=0;
let modalOwner:NativeSession|undefined,lostCanvas=false,openingPanel=false,chrome:PcStoryChrome|undefined;
function issue(error:unknown){warning.textContent=error instanceof Error?error.message:String(error);warning.hidden=false;console.error(error);}
function clearNotice(){notice='';warning.hidden=true;}
const movie=()=>{const m=current?.view().movie;return m&&m.phase!=='idle'?m:undefined;};
const progress=new StoryProgress(async data=>{route.checkProgress(data);await store.saveSystem(data);},issue);
const wakeQueue=new StoryWakeQueue(reason=>animate(reason).catch(issue));
const observing=new URLSearchParams(location.search).get('y04')==='observe';
const observe=(kind:string,reason:string)=>{if(observing)performance.mark('y04:'+kind,{detail:reason});};
const canRun=(s:NativeSession)=>!backlog.active&&!document.hidden&&!s.view().paused&&(!fileUI?.active||fileUI.acquiring);
function wake(reason:string){if(current&&canRun(current))wakeQueue.request({reason,delay:0,frame:true});}
function heldChanged(){
  clearTimeout(holdTimer);
  const delay=holdKeys.remaining();
  if(Number.isFinite(delay))holdTimer=window.setTimeout(()=>{wake('hold-threshold');refresh();},Math.ceil(delay));
  wake('held-key');
}
const dom=storyDom(viewport,b);
function refreshPrefetch(){dom.prefetch(current);}
function refresh(){
  const view=current?.view(),p=view?.position,film=movie();
  refreshPrefetch();
  const blocked=pending||backlog.active||fileUI?.active||storyLoading.shown||openingPanel||panel.open||!p?.asset||p.ended||!view||view.paused||view.awaitingPresentation;
  const menuOff=blocked||overlay.classList.contains('pc-message-hidden')||!!film||!view?.menu.interactive;
  if(touchMenu.hidden!==menuOff)touchMenu.hidden=menuOff;
  const protectedWait=dom.update(view,holdKeys.mode(),film,blocked,menuOff,gameMenu.open,!!fileUI?.hasQuick);
  const pc=!blocked&&!film?current?.pcDialogue?.():undefined;
  b('history-open').disabled=menuOff||!current?.historyAvailable?.();
  chrome?.update(view,pc,!!view&&!blocked&&!film&&!gameMenu.open,!menuOff&&!protectedWait,!!fileUI?.hasQuick);
  const label=storyStatus(storyLoading,pending,crashed,view,route,!!title);
  const next=notice?label+' · '+notice:label;if(status.textContent!==next)status.textContent=next;
}
async function titleScreen(){
  const data=await store.loadSystem()??emptyProgress;route.checkProgress(data);
  const latest=await fileUI.latest();
  const unlocked=route.unlocked(data.sf);
  title=await showNativeTitle(root,viewport,data,latest!==undefined,()=>launch('new'),issue,{
    unlocked:unlocked.length>0,combined:route.merged,mix:settings.mix,continue:()=>void fileUI.continue(),slots:()=>void fileUI.open('load'),
    after:()=>void showAfterOptions(unlocked,prepPanel,launch).catch(issue),settings:()=>void openSettings(),
  });
}
function dropSession(){
  holdKeys.clear();clearSurfaceTap();
  if(gameMenu.open)gameMenu.close();
  chrome?.close();chrome=undefined;fileUI?.hidePreview();
  const old=current;current=undefined;epoch++;wakeQueue.cancel();progress.attach();overlay.replaceChildren();
  if(lostCanvas){
    lostCanvas=false;
    const next=canvas.cloneNode(false) as HTMLCanvasElement;canvas.replaceWith(next);canvas=next;bindCanvas();
  }
  return old;
}
async function returnTitle(natural:boolean){
  if(!current||pending)return;const s=current;
  if(natural&&!route.unlocked(s.systemProgress().sf).length)throw Error('原标题终点缺少真实本篇通关标记');
  pending=true;dropSession();refresh();
  try{await s.close();await progress.flush(s,true);await titleScreen();}
  finally{pending=false;refresh();}
}
const entryProgress:StoryLoading['report']=(...args)=>{
  const focused=storyLoading.root.contains(document.activeElement);
  storyLoading.report(...args);
  if(focused&&!storyLoading.shown)canvas.focus({preventScroll:true});
};
function offerStoryRecovery(){storyLoading.recover(()=>launch('new'),()=>void backFromStory());}
async function backFromStory(){
  if(pending||!storyLoading.failed)return;
  pending=true;storyLoading.returning();
  try{
    if(!title)await titleScreen();storyLoading.hide();
    document.getElementById('original-title-newgame')?.focus({preventScroll:true});
  }catch(error){console.error(error);storyLoading.titleUnavailable();offerStoryRecovery();}
  finally{pending=false;refresh();}
}
async function animate(reason:string){
  const s=current,token=epoch;if(!s||!canRun(s))return;
  try{
    observe('wake',reason);
    await s.step(0);
    if(token!==epoch)return;
    const view=s.view();if(view.position.ended&&view.returnToTitle&&!pending){await returnTitle(true);return;}
    progress.changed();refresh();
    if(canRun(s)){const next=s.nextWake?.();if(next)wakeQueue.request(next);}
  }catch(error){
    if(token!==epoch){issue(error);return;}
    if(storyLoading.waiting){
      pending=true;storyLoading.fail();console.error(error);dropSession();
      try{await s.close();}catch(cleanup){console.error(cleanup);}
      finally{pending=false;offerStoryRecovery();refresh();}
      return;
    }
    const p=s.view().position;crashed=true;pending=true;dropSession();
    issue(new Error('原位置 '+p.asset+'/'+p.scene+'/'+p.cursor+' · '+(error instanceof Error?error.message:String(error)),{cause:error}));
    try{await s.close();await titleScreen();}catch(e){issue(e);}finally{pending=false;refresh();}
  }
}
const backlog=new BacklogFlow({current:()=>current,changed:()=>{holdKeys.clear();clearSurfaceTap();wakeQueue.cancel();refresh();wake('history');},commit:swapHistory,issue});
const storySpeeds=()=>({characterDelay:settings.characterDelay,autoDelay:settings.autoDelay});
type Surface={canvas:HTMLCanvasElement;overlay:HTMLElement};
function connectStory(s:Surface,c:AudioContext,p:SystemProgressData,a:ReturnType<YoshinoRoute['afterFor']>,r:Parameters<YoshinoRoute['restrictions']>[1],id:number,f=false,prior?:string,o?:NativeSessionOptions){
  return openEditionStory(root,s,c,p,route,settings,systemFontFamily,a,r,prior,{
    demand:{wake:why=>{if(epoch===id)wake(why);},painted:why=>observe('paint',why),prefetchChanged:()=>{if(epoch===id)refreshPrefetch();}},
    entryProgress:f?entryProgress:undefined,heldSkip:()=>s.overlay.classList.contains('pc-message-hidden')||pending||backlog.active||fileUI?.active||openingPanel||panel.open||gameMenu.open||document.hidden?'none':holdKeys.mode(),...o,
  });
}
async function swapHistory(old:NativeSession,plan:ReplayPlan){
  const {openHistoryTarget}=await import('./backlog-replay.ts');
  const owner=epoch+1,staged=await openHistoryTarget(viewport,canvas,overlay,old,plan,route,(s,c,p,a,o)=>connectStory(s,c,p,a,undefined,owner,false,undefined,o),()=>old===current&&epoch+1===owner);
  wakeQueue.cancel();epoch=owner;canvas.remove();overlay.remove();replaySurface?.remove();
  replaySurface=staged.area;canvas=staged.canvas;overlay=staged.overlay;canvas.id='game';overlay.id='native-ui';
  staged.area.classList.remove('pc-replay-staging');staged.area.inert=false;lostCanvas=false;bindCanvas();
  current=staged.session;progress.attach(current);progress.changed();current.invalidateSurface?.();
  notice='已回到原场景';refresh();void old.close().catch(issue);return staged.activate;
}
function launch(kind:'new'|'after'|'after-mak'|OpenedSlot){
  if(!store||pending||backlog.active||fileUI?.active||storyLoading.waiting||openingPanel||movie()||title?.busy())return;
  const story=kind==='new';if(!story&&storyLoading.shown)return;
  clearNotice();pending=true;if(story)storyLoading.begin();refresh();
  void (async()=>{
    let fresh:NativeSession|undefined,context:AudioContext|undefined;
    try{
      context=new AudioContext();await context.resume();
      const saved=typeof kind==='object'?kind:undefined;
      const initial=await store.loadSystem()??emptyProgress;route.checkProgress(initial);
      const inAfter=kind==='after'?'yos':kind==='after-mak'?'mak':saved?route.afterFor(saved.snapshot.position.asset):undefined;
      if(inAfter&&!route.unlocked(initial.sf).includes(inAfter))throw Error('先完成对应本篇才能游玩后日谈');
      const preserve=saved&&route.checkSave(saved.snapshot,initial);
      const previousTitle=title;title=undefined;await previousTitle?.close();
      const old=dropSession();if(old){try{await progress.flush(old,true);}finally{await old.close();}}
      const persisted=await store.loadSystem()??initial;
      const speeds=storySpeeds();
      const {PcStoryChrome}=await import('./pc-story-chrome.ts');
      chrome=new PcStoryChrome({viewport,settings,focusGame:()=>canvas.focus({preventScroll:true}),invokeMenu:id=>saveModes.has(id)?fileUI.open(saveModes.get(id)!):b(id).click(),issue,quickPreview:button=>button?void fileUI.preview(button):fileUI.hidePreview(),
        progress:()=>current?.pcDialogue?.(),mixChanged:()=>wake('mix-control'),dialogueAction:action=>{holdKeys.clear();operation(async s=>{await s.changePcDialogue?.(action);});}});
      await chrome.ready();
      if(story)storyLoading.program();
      const owner=epoch;
      fresh=await connectStory({canvas,overlay},context,persisted,inAfter,preserve,owner,story,saved&&saved.identity!==store.identity?saved.identity:undefined);
      if(document.hidden)await fresh.pause(true,'visibility');
      if(saved){await fresh.restore(saved.snapshot);await fresh.mode(speeds);notice='已读取存档';}else {await fresh.start();if(story)storyLoading.opening();}
      current=fresh;fresh=undefined;crashed=false;progress.attach(current);
      progress.changed();wake('session-opened');
    }catch(error){
      chrome?.close();chrome=undefined;
      if(story){storyLoading.fail();console.error(error);}else issue(error);
      try{if(fresh)await fresh.close();else if(context&&context.state!=='closed')await context.close();}
      catch(cleanup){console.error(cleanup);}
      if(!story&&!title&&!current)await titleScreen();
    }finally{pending=false;if(story&&storyLoading.failed)offerStoryRecovery();refresh();}
  })().catch(issue);
}
function operation(run:(s:NativeSession)=>Promise<void>){
  const s=current;if(!s||pending||backlog.active||fileUI?.active||storyLoading.shown||panel.open)return;void run(s).then(()=>{if(s===current){progress.changed();refresh();wake('input');}}).catch(error=>{issue(error);if(s===current)wake('input-error');});
}
function advance(){if(!gameMenu.open&&viewport.dataset.canAdvance==='true')operation(async s=>{
  if(overlay.classList.contains('pc-message-hidden'))await s.changePcDialogue?.('show');else await s.advance();
});}
function openGameMenu(){
  if(gameMenu.open||panel.open||viewport.dataset.menuReady!=='true')return;
  holdKeys.clear();gameMenu.showModal();refresh();
}
function menuAction(id:string,run:()=>void){b(id).onclick=()=>{gameMenu.close();refresh();run();};}
touchMenu.onclick=openGameMenu;
gameMenu.addEventListener('close',()=>{refresh();wake('menu-close');});
viewport.addEventListener('contextmenu',e=>{
  if(!current||panel.open||fileUI?.active)return;
  e.preventDefault();
  if(e instanceof PointerEvent&&e.pointerType==='touch'){clearSurfaceTap();return;}
  if(gameMenu.open)gameMenu.close();else openGameMenu();
});
function bindCanvas(){bindMouseAdvance(canvas,advance);canvas.addEventListener('webglcontextlost',()=>{lostCanvas=true;current?.invalidateSurface?.();wake('context-lost');});}
bindCanvas();
const filmSurface=(target:EventTarget|null)=>target instanceof Element?target.closest('.original-op'):null;
viewport.addEventListener('pointerup',ev=>{if(ev.pointerType!=='touch'&&ev.button===0&&filmSurface(ev.target))advance();});
const clearSurfaceTap=bindSurfaceTap(viewport,target=>target===canvas?canvas:filmSurface(target),()=>{
  if(title)title.skipReplay();else if(viewport.dataset.wait!=='choice')advance();
});
function surfaceChange(){clearSurfaceTap();current?.invalidateSurface?.();wake('surface');}
window.addEventListener('resize',surfaceChange);
window.visualViewport?.addEventListener('resize',surfaceChange);
touchLayout.addEventListener('change',surfaceChange);
new ResizeObserver(surfaceChange).observe(viewport);
menuAction('auto',()=>operation(s=>s.mode({auto:!s.view().mode.auto,skip:'none'})));
menuAction('skip',()=>operation(s=>s.mode({auto:false,skip:s.view().mode.skip==='read'?'none':'read'})));
menuAction('back-title',()=>void confirmReturnTitle().catch(issue));
async function confirmReturnTitle(){
  if(confirming()||!await prepPanel())return;
  try{if(await confirmAction('返回标题？未存档的剧情位置不会保留。'))await returnTitle(false);}
  finally{await resumePanel();}
}
const saveModes=new Map<string,'save'|'load'|'qsave'|'qload'>([['save','qsave'],['load','qload'],['slots-save','save'],['slots-load','load']]);
for(const [id,mode] of saveModes)menuAction(id,()=>void fileUI.open(mode));
async function prepPanel(){
  if(panel.open||pending||fileUI?.active||movie()||title?.busy())return false;
  modalOwner=current;pending=true;
  try{await modalOwner?.pause(true,'panel','story');return true;}
  catch(e){modalOwner=undefined;throw e;}finally{pending=false;refresh();}
}
async function openSettings(){
  try{if(!await prepPanel())return;showPanel('设置',settingsForm(settings,()=>{
    try{current?.prefetch?.limit(settings.prefetchMB*bytesPerMB);persistSettings(settings);(current??title)?.updateMix?.();refresh();}catch(e){issue(e);}
  }));}catch(e){issue(e);if(!panel.open)void resumePanel();}
}
menuAction('settings',()=>void openSettings());
menuAction('history-open',()=>void backlog.open());
async function resumePanel(){
  const owner=modalOwner;modalOwner=undefined;
  if(owner&&owner===current){await owner.mode({characterDelay:settings.characterDelay,autoDelay:settings.autoDelay});await owner.pause(false,'panel');}
  refresh();wake('panel-resume');
}
panel.addEventListener('close',()=>void resumePanel().catch(issue));
document.addEventListener('visibilitychange',()=>{
  const hidden=document.hidden;
  if(hidden){holdKeys.clear();clearSurfaceTap();wakeQueue.cancel();chrome?.stopProgress();}
  const s=current;if(!s)return;
  void s.pause(hidden,'visibility').then(()=>{if(s!==current)return;refresh();if(hidden)return progress.flush(s);wake('visible');}).catch(issue);
});
window.addEventListener('pagehide',()=>{wakeQueue.cancel();chrome?.stopProgress();if(current)void progress.flush(current).catch(issue);});
window.addEventListener('pageshow',e=>{if(e.persisted){surfaceChange();wake('page-restored');}});
window.addEventListener('blur',()=>{holdKeys.clear();clearSurfaceTap();});
const editing=(e:KeyboardEvent)=>e.target instanceof Element&&!!e.target.closest('button,input,select,textarea,[contenteditable="true"]');
document.addEventListener('keydown',e=>{
  if(fileUI?.active)return;
  if(backlog.active||confirming())return;
  const inGame=!!current&&!pending&&!storyLoading.shown&&!openingPanel&&!panel.open&&!gameMenu.open&&!document.hidden;
  if(holdKeys.down(e,inGame&&!editing(e)&&viewport.dataset.wait!=='choice'))return;
  if(e.defaultPrevented||e.repeat||e.altKey||e.metaKey||e.ctrlKey||panel.open||gameMenu.open||pending||storyLoading.shown)return;
  if(e.key==='Escape'&&viewport.dataset.menuReady==='true'){e.preventDefault();openGameMenu();return;}
  if(!editing(e)&&e.key==='Enter'&&current){e.preventDefault();advance();}
},true);
document.addEventListener('keyup',e=>holdKeys.up(e,advance),true);
for(const type of ['senren-choice','senren-choice-input','senren-choice-appearance' ])viewport.addEventListener(type,event=>{
  if(event.target!==overlay||!(event instanceof CustomEvent))return;
  const d=event.detail;if(!d||typeof d.session!=='object'||!d.session||!Number.isSafeInteger(d.generation)||!Number.isSafeInteger(d.index))return;
  operation(s=>type==='senren-choice'?s.choose(d.session,d.generation,d.index):type==='senren-choice-input'?s.choiceInput(d.session,d.generation,d.index):s.choiceAppearance(d.session,d.generation,d.index,d.kind));
},true);
void (async()=>{
  if(!isSecureContext||!['https:','http:'].includes(location.protocol))throw Error('请用 Chrome 打开 HTTPS 或本机 HTTP 静态地址，不支持 file:// 或非本机明文 HTTP');
  const response=await fetch(new URL('session.json',root));if(!response.ok)throw Error('缺少生产资源描述：HTTP '+response.status);
  const descriptor=await response.json();if(descriptor?.edition!==versions||typeof descriptor.identity!=='string'||descriptor.previousResourceIdentity!==undefined&&typeof descriptor.previousResourceIdentity!=='string')throw Error('不是本专版资源');
  route=await YoshinoRoute.open(root);settings=loadSettings((await sessionSettings(root)).playback);
  if(route.merged!==(descriptor.previousResourceIdentity!==undefined))throw Error('路线表与专版资源身份不匹配');
  store=await QuickSlotStore.open(descriptor.identity,versions,descriptor.previousResourceIdentity);
  fileUI=new SaveFlow(store.shelf!,viewport,{
    current:()=>current,allowed:()=>!pending&&!openingPanel&&!panel.open&&!gameMenu.open&&!movie()&&!title?.busy()&&(!current||viewport.dataset.menuReady==='true'),
    change:()=>{if(fileUI.active){holdKeys.clear();clearSurfaceTap();}refresh();wake('save-panel');},
    captureProgress:(s,snapshot)=>{const p=s.systemProgress();route.checkSave(snapshot,p);return p;},
    loaded:slot=>launch(slot),notice:value=>{warning.hidden=true;notice=value;},issue,title:card=>saveChapter(route,card),
  });
  await titleScreen();refresh();
})().catch(issue);
