import type {SystemProgressData} from './native-session.ts';
import {AudioCatalog} from '../src/audio/audio-catalog.ts';
import {WebAudioEngine} from '../src/audio/web-audio-engine.ts';
import {nativeLoopRange} from '../src/audio/native-loop-range.ts';
import {sessionSettings} from './session-settings.ts';
import {NativeOp} from './native-op.ts';
import type {NativeEnding} from './native-op.ts';
import {openNativeTitleArt,titleWidth,titleHeight} from './native-title-art.ts';
import {prepareTitleMenu} from './native-title-menu.ts';
import type {AudioMix} from '../src/audio/edition-mix.ts';
export interface NativeTitleEdition { readonly unlocked:boolean;readonly combined?:boolean;readonly mix:AudioMix;
  continue():void;slots():void;after():void;settings():void; }

export interface NativeTitle { readonly busy:()=>boolean; readonly skipReplay:()=>boolean; readonly close:()=>Promise<void>; readonly updateMix?:()=>void }
function endingUnlocked(progress:SystemProgressData|undefined,heroine:NativeEnding='yos'):boolean {
  return !!progress?.sf.clear&&(heroine==='mak'?!!progress.sf.clear_mak&&!!progress.sf.ed2_mako:!!progress.sf.clear_yos&&!!progress.sf.ed1_yosh);
}
export async function showNativeTitle(root:URL,viewport:HTMLElement,progress:SystemProgressData,hasContinue:boolean,newGame:()=>void,report:(error:unknown)=>void,edition:NativeTitleEdition):Promise<NativeTitle>{
  const assets=new URL('r69-title/',root), seal=await fetch(new URL('title-assets.json',assets));
  const packed=seal.ok?await seal.json():null;
  if(packed?.format!=='senren-r69-title-assets-v1')throw Error('原标题资源尚未装配');
  const settings=await sessionSettings(root);
  const pane=document.createElement('section');pane.className='r69-title';pane.tabIndex=-1;pane.setAttribute('aria-label','千恋＊万花 原标题');
  const canvas=document.createElement('canvas');canvas.width=titleWidth;canvas.height=titleHeight;canvas.setAttribute('aria-label','原标题动画');
  const gallery=document.createElement('section');gallery.className='r69-title-gallery';gallery.hidden=true;gallery.setAttribute('aria-label','原片尾鉴赏');
  const back=document.createElement('button');back.id='original-title-gallery-back';back.textContent='返回标题';
  const rows:{heroine:NativeEnding;button:HTMLButtonElement}[]=[];
  for(const heroine of (edition.combined?['yos','mak']:['yos']) as NativeEnding[]){
    const button=document.createElement('button');button.id=heroine==='mak'?'original-title-ed-mako':'original-title-ed-yoshino';
    button.type='button';button.textContent=heroine==='mak'?'播放茉子片尾':'播放芳乃片尾';button.disabled=!endingUnlocked(progress,heroine);
    rows.push({heroine,button});
  }
  if(endingUnlocked(progress)){
    const thumb=new Image();thumb.src=new URL(packed.files?.some((row:{file?:string})=>row.file==='ed-yoshino.webp')?'ed-yoshino.webp':'ed-yoshino.jpg',assets).href;
    thumb.alt='原芳乃片尾鉴赏缩略图';gallery.append(thumb);
  }
  gallery.append(...rows.map(r=>r.button),back);
  let activeReplay:HTMLButtonElement|undefined,filmFailed=false;
  const updateGallery=(playing=false)=>{back.disabled=playing;for(const {heroine,button} of rows)button.disabled=playing||filmFailed||!endingUnlocked(progress,heroine);};
  const context=new AudioContext();let catalog:AudioCatalog|undefined,audio:WebAudioEngine|undefined,op:NativeOp|undefined;
  let retired=false,closing:Promise<void>|undefined,startMusic:Promise<void>|undefined,artClose:(()=>void)|undefined,token:number|undefined,filmFrame=0;
  const close=()=>closing??=(async()=>{
    retired=true;cancelAnimationFrame(filmFrame);
    pane.remove();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);
    try{op?.close();}finally{try{artClose?.();}finally{try{audio?.stopAll();}finally{catalog?.close();if(context.state!=='closed')await context.close();}}}
  })();
  const pagehide=()=>{void close().catch(report);};
  const musicChannel='title/bgm';
  const visibility=()=>{
    if(retired)return;
    op?.pause(document.hidden);
    if(document.hidden)audio?.pause(musicChannel);else if(token===undefined)audio?.resume(musicChannel);
  };
  function resumeMusic(gesture=false):void {
    if(retired||startMusic||document.hidden||!catalog||!audio||(!gesture&&context.state!=='running'))return;
    const engine=audio, asset=catalog.resolve('BGM61');
    startMusic=(async()=>{
      if(gesture)await context.resume();
      if(retired||context.state!=='running')return;
      await engine.play({channel:musicChannel,token:'original-title-bgm',storage:asset.name,gain:settings.volumes.bgm,loop:nativeLoopRange(asset,true)});
      if(document.hidden||token!==undefined)engine.pause(musicChannel);
    })().catch(error=>{if(!retired)report(error);});
  }
  function filmDone():void {
    token=undefined;op?.afterGamePaint();updateGallery();
    if(!document.hidden){audio?.resume(musicChannel);if(document.activeElement===pane)(activeReplay&&!activeReplay.disabled?activeReplay:back).focus({preventScroll:true});}
  }
  function skipReplay():boolean {
    if(retired||token===undefined||!op?.view()?.interruptible)return false;
    op.skip(token);filmDone();return true;
  }
  function filmPoll():void {
    if(retired||token===undefined||!op)return;
    try { if(op.ready(token)){filmDone();return;} }
    catch(error){op.close();filmFailed=true;filmDone();report(error);return;}
    filmFrame=requestAnimationFrame(filmPoll);
  }
  try {
    catalog=await AudioCatalog.open(new URL('music/manifest.json',assets),context,{decodedByteBudget:8*1024*1024,streaming:true});
    audio=new WebAudioEngine(context,catalog,context.destination,edition.mix);
    op=await NativeOp.open(new URL('movies/op.json',root),pane,context,settings.volumes.movieaudio,{hasMarker:k=>!!progress.sf[k],marker:()=>{}},new URL('movies/ed-yoshino.json',root),edition.combined?new URL('movies/ed-mako.json',root):undefined);
    const menu=await prepareTitleMenu(assets,!!progress.sf.clear,hasContinue,edition.unlocked,action=>{
      if(retired||token!==undefined)return;
      if(action==='gallery'){menu.hidden=true;gallery.hidden=false;(rows.find(r=>!r.button.disabled)?.button??back).focus();}
      else if(action==='load')edition.slots();
      else if(action==='continue')edition.continue();
      else if(action==='after')edition.after();
      else if(action==='settings')edition.settings();
      else newGame();
    });
    back.onclick=()=>{if(token===undefined){gallery.hidden=true;menu.hidden=false;}};
    for(const {heroine,button} of rows)button.onclick=()=>{
      if(retired||button.disabled||token!==undefined||!op)return;
      try{
        void context.resume().catch(report);audio?.pause(musicChannel);
        activeReplay=button;token=op.startEndingReplay(heroine);updateGallery(true);
        pane.focus({preventScroll:true});filmFrame=requestAnimationFrame(filmPoll);
      }catch(error){filmDone();report(error);}
    };
    pane.addEventListener('pointerdown',()=>resumeMusic(true));
    pane.addEventListener('keydown',e=>{
      resumeMusic(true);
      if(e.key==='Escape'&&skipReplay())e.preventDefault();
    });
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide,{once:true});
    pane.append(canvas,menu,gallery);viewport.append(pane);
    artClose=await openNativeTitleArt(root,assets,canvas,()=>{if(!retired){menu.hidden=false;pane.dataset.titleReady='true';resumeMusic();}},report);
    return {busy:()=>token!==undefined,skipReplay,close,updateMix:()=>audio?.updateMix()};
  }catch(error){await close();throw error;}
}
