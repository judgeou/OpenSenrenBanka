import './pc-story-chrome.css';
import art from 'virtual:yoshino-pc-dialogue';
import type {NativeSession,PcDialogueView} from '../native-session.ts';
import {persistSettings} from './settings.ts';
import type {Settings} from './settings.ts';

// default.tjs quickMenuDefaultList; quickmenu.func maps tags to the active 1080 PIMG names.
const groups=[['rock','custom'],['save','load','qsave','qload','system'],
  ['prevselect','prevscene','backskip','prevtxt','backlog','auto','skip','nextscene','nextselect'],
  ['flowchart','volume','voice','fav','close']] as const;
type Action=typeof groups[number][number];
const labels:Record<Action,string>={rock:'锁定快捷栏',custom:'自定义快捷栏',save:'SAVE · 存档',load:'LOAD · 读档',qsave:'Q.SAVE · 快速存档',qload:'Q.LOAD · 快速读档',system:'SYSTEM · 设置',
  prevselect:'上一选择',prevscene:'上一场景',backskip:'向后跳读',prevtxt:'上一句',backlog:'历史',auto:'自动播放',skip:'仅已读快进',nextscene:'下一场景',nextselect:'下一选择',
  flowchart:'原流程图',volume:'总音量',voice:'重听当前配音',fav:'收藏配音',close:'隐藏对话窗'};
const unavailable=new Set<Action>(['custom','prevselect','prevscene','backskip','prevtxt','nextscene','nextselect','flowchart','fav']);
const menuActions:Partial<Record<Action,string>>={save:'slots-save',load:'slots-load',qsave:'save',qload:'load',system:'settings',backlog:'history-open',auto:'auto',skip:'skip'};
type Box={x:number;y:number;w:number;h:number};
const pcWidth=1920,pcHeight=1080;
function place(el:HTMLElement,b:Box,width=pcWidth,height=pcHeight){
  el.style.left=100*b.x/width+'%';el.style.top=100*b.y/height+'%';
  el.style.width=100*b.w/width+'%';el.style.height=100*b.h/height+'%';return el;
}
function image(row:Box&{src?:string},box?:Box){
  if(!row?.src)throw Error('缺少原 PC 界面图层');
  const img=new Image();img.src=row.src;img.alt='';img.draggable=false;
  if(box)place(img,{...row,x:row.x-box.x,y:row.y-box.y},box.w,box.h);else place(img,row);
  return img;
}
const toggle=(button:HTMLElement,value:boolean)=>{if(button.getAttribute('aria-pressed')!==String(value))button.setAttribute('aria-pressed',String(value));};
const hide=(node:HTMLElement,value:boolean)=>{if(node.hidden!==value)node.hidden=value;};
type ChromeOptions={
  viewport:HTMLElement;settings:Settings;focusGame:()=>void;invokeMenu:(id:string)=>void;
  quickPreview:(button:HTMLButtonElement|undefined)=>void;
  dialogueAction:(action:'hide'|'replay')=>void;issue:(e:unknown)=>void;
  progress:()=>PcDialogueView|undefined;mixChanged:()=>void;
};
export class PcStoryChrome {
  readonly node=document.createElement('div');
  private readonly strip=document.createElement('nav');
  private readonly voice=document.createElement('div');
  private readonly backgrounds: Record<NonNullable<PcDialogueView['progress']>['kind'], HTMLImageElement>;
  private readonly fill:HTMLImageElement;
  private readonly buttons=new Map<Action,HTMLButtonElement>();
  private readonly slider=document.createElement('div');
  private readonly rail:HTMLInputElement;
  private readonly life=new AbortController();
  private volumeOpen=false;
  private hovered=false;
  private menuOn=false;
  private voiceKey?:string;
  private voiceTimer?:number;
  private skipping=false;
  constructor(private readonly options:ChromeOptions){
    const {viewport}=options;
    this.node.id='pc-dialogue-chrome';this.strip.id='pc-shortcuts';this.strip.setAttribute('aria-label','剧情快捷栏');
    const q=art.quickmenu,attention=q['@base:att:rect'];
    this.strip.style.setProperty('--pc-slide',100*attention.h/pcHeight+'%');
    const boxes=new Map<Action,Box>();let right=q['@close:rect'].x+q['@close:rect'].w;
    for(const group of [...groups].reverse()){
      for(const name of [...group].reverse()){
        const row=q['@'+name+':rect'];right-=row.w;boxes.set(name,{...row,x:right});
      }
      right-=9; // SizeCoef(6), in the authored 1080 coordinate system.
    }
    const line=image(q['@window_item']),offset=Math.max(0,boxes.get('rock')!.x-q['@custom:rect'].x);
    place(line,{...q['@window_item'],x:q['@window_item'].x+offset,w:q['@window_item'].w-offset});
    this.strip.append(line);
    for(const name of groups.flat()){
      const row=q['@'+name+':rect'],button=document.createElement('button');
      button.type='button';button.dataset.shortcut=name;button.setAttribute('aria-label',labels[name]);
      button.title=labels[name]+(unavailable.has(name)?'（双线专版不支持）':'');
      place(button,boxes.get(name)!);
      for(const state of ['defo','over','on']){const sprite=image(q['@'+name+':'+state],row);sprite.className='pc-'+state;button.append(sprite);}
      // Keep holds and Enter on the main play surface after a pointer activation.
      if(name==='qload'){
        button.onpointerenter=e=>{if(e.pointerType!=='touch'&&!button.disabled)this.options.quickPreview(button);};
        button.onpointerleave=()=>this.options.quickPreview(undefined);
      }
      button.onclick=()=>this.act(name);this.buttons.set(name,button);this.strip.append(button);
    }
    const sliderBox={...q['@slider:rect'],x:boxes.get('volume')!.x};
    place(this.slider,sliderBox);this.slider.className='pc-volume';
    this.slider.append(image(q['@slider:rail'],q['@slider:rect']));
    this.rail=document.createElement('input');this.rail.type='range';this.rail.min='0';this.rail.max='100';
    this.rail.setAttribute('aria-label','总音量');this.rail.style.setProperty('--pc-thumb','url("'+q['@slider:defo'].src+'")');
    this.rail.oninput=()=>{options.settings.mix.master=this.rail.valueAsNumber/100;this.persist();options.mixChanged();};
    this.slider.append(this.rail);this.strip.append(this.slider);
    const v=art.voicebar;
    this.voice.id='pc-voice-progress';this.voice.setAttribute('aria-hidden','true');
    this.backgrounds={voice:image(v['@voice_bg']),auto_voice:image(v['@autovoice_bg']),auto_wait:image(v['@autowait_bg'])};
    this.fill=image(v['@waitbar']);this.voice.append(...Object.values(this.backgrounds),this.fill);
    this.node.append(this.voice,this.strip);this.node.hidden=true;viewport.append(this.node);
    const signal=this.life.signal;
    viewport.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch')return;
      const r=viewport.getBoundingClientRect(),x=(e.clientX-r.left)*pcWidth/r.width,y=(e.clientY-r.top)*pcHeight/r.height;
      this.hovered=x>=attention.x&&x<attention.x+attention.w&&y>=attention.y&&y<pcHeight;
      this.position();
    },{signal,passive:true});
    viewport.addEventListener('pointerleave',()=>{this.hovered=false;this.position();},{signal});
    window.addEventListener('blur',()=>{this.hovered=false;this.position();},{signal});
  }
  private persist(){try{persistSettings(this.options.settings);}catch(e){this.options.issue(e);}}
  private act(name:Action){
    if(!this.menuOn||this.buttons.get(name)?.disabled)return;
    if(name==='volume'){
      this.volumeOpen=!this.volumeOpen;this.settingState();this.position();if(this.volumeOpen){this.rail.focus({preventScroll:true});return;}
    }else if(name==='rock'){
      this.options.settings.quickLocked=!this.options.settings.quickLocked;this.persist();this.settingState();this.position();
    }else if(name==='voice'||name==='close')this.options.dialogueAction(name==='voice'?'replay':'hide');
    else{const id=menuActions[name];if(id)this.options.invokeMenu(id);}
    if(!document.querySelector('dialog[open]'))this.options.focusGame();
  }
  private position(){
    const expanded=String(this.options.settings.quickLocked||this.hovered||this.volumeOpen);if(this.strip.dataset.expanded!==expanded)this.strip.dataset.expanded=expanded;
  }
  private settingState(){
    toggle(this.buttons.get('rock')!,this.options.settings.quickLocked);toggle(this.buttons.get('volume')!,this.volumeOpen);
    hide(this.slider,!this.volumeOpen);
    const volume=String(Math.round((this.options.settings.mix.master??1)*100));if(this.rail.value!==volume)this.rail.value=volume;
  }
  update(view:ReturnType<NativeSession['view']>|undefined,pc:PcDialogueView|undefined,
      display:boolean,interactive:boolean,haveQuick:boolean){
    hide(this.node,!display);this.menuOn=display&&interactive&&!pc?.hidden;
    hide(this.strip,!display||!view?.menu.interactive||!!pc?.hidden);
    if(this.strip.inert===this.menuOn)this.strip.inert=!this.menuOn;
    if(!this.menuOn)this.volumeOpen=false;
    this.settingState();this.position();
    for(const [name,b] of this.buttons){
      const off=!this.menuOn||unavailable.has(name)||((name==='save'||name==='qsave')&&!!view?.saveReason)||
        name==='qload'&&!haveQuick||name==='voice'&&!pc?.replayable||name==='close'&&!pc?.visible;
      if(b.disabled!==off)b.disabled=off;
    }
    toggle(this.buttons.get('auto')!,view?.mode.auto===true);toggle(this.buttons.get('skip')!,view?.mode.skip==='read');
    this.skipping=view?.mode.skip!=='none';
    this.updateVoice(display?pc:undefined);
  }
  stopProgress():void {if(this.voiceTimer!==undefined){clearTimeout(this.voiceTimer);this.voiceTimer=undefined;}}
  private updateVoice(pc:PcDialogueView|undefined){
    const key=this.skipping?undefined:pc?.key, progress=pc?.progress;
    if(key!==this.voiceKey){
      this.stopProgress();this.voice.classList.remove('pc-lit','pc-fade');this.voiceKey=key;
      delete this.voice.dataset.progress;delete this.voice.dataset.width;
    }
    if(!key||!progress||document.hidden){this.stopProgress();if(this.voice.classList.contains('pc-lit'))this.voice.classList.remove('pc-lit');return;}
    if(this.voiceTimer!==undefined&&this.voice.dataset.progress===progress.kind)return;
    const width=String(Math.round(art.voicebar['@waitbar'].w*progress.ratio));
    if(this.voice.dataset.progress!==progress.kind){
      for(const kind of Object.keys(this.backgrounds) as (keyof typeof this.backgrounds)[])hide(this.backgrounds[kind],kind!==progress.kind);
      this.voice.dataset.progress=progress.kind;
    }
    if(this.voice.dataset.width!==width){
      this.voice.dataset.width=width;
      this.fill.style.clipPath='inset(0 '+(100-100*Number(width)/art.voicebar['@waitbar'].w)+'% 0 0)';
    }
    if(!this.voice.classList.contains('pc-lit'))this.voice.classList.add('pc-fade','pc-lit');
    this.voiceTimer??=window.setTimeout(()=>{this.voiceTimer=undefined;this.updateVoice(this.node.hidden?undefined:this.options.progress());},50);
  }
  async ready(){await Promise.all(Array.from(this.node.querySelectorAll('img'),image=>image.decode()));}
  close(){this.stopProgress();this.options.quickPreview(undefined);this.life.abort();this.node.remove();}
}
