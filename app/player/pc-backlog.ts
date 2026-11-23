import art from 'virtual:yoshino-pc-backlog';
import {artImage,artworkButton,layer,modal,place} from './pc-save-surface.ts';
import {NativeTextConverter} from '../ui/native-text-converter.ts';
import {appendNativeText} from '../ui/rich-text.ts';
import {pcDisplayName} from '../ui/native-message-raster.ts';
import type {HistoryEntry} from '../../src/runtime/types.ts';
import type {SceneHistoryRow} from '../../src/runtime/live-scene-history.ts';
import {bindBacklogButtons} from './backlog-touch.ts';
import './pc-backlog.css';

const sheet=art.backlog,box='スクロール項目/@scroll/lay:rect',textBox='スクロール項目/@scroll:text:rect';
const captionFor=(title:string)=>title==='0-0'?'序章':/^\d+-\d+$/u.test(title)?'CHAPTER '+title:title==='prologue'?'序章':title==='after'?'后日谈':title;
const messageName=(e:HistoryEntry)=>{const name=e.displayName??e.speaker;return typeof name==='string'?pcDisplayName(name):'';};
function dialogQuestion():Promise<boolean>{
  const d=modal('pc-history-confirm','确认回到选中的场景？');d.id='pc-history-confirm';bindBacklogButtons(d);
  d.append(artImage(layer(art.dialog,'@cont_bg')),artImage(layer(art.dialog,'@dialog_sceanjump')));
  for(const name of ['yes','no'] as const){const b=artworkButton(art.dialog,'_yesno/@'+name,name==='yes'?'确认回跳':'取消',()=>d.close(name));
    b.id='pc-history-'+name;b.autofocus=name==='no';d.append(b);}
  try{d.showModal();}catch(error){d.remove();throw error;}
  return new Promise(resolve=>d.addEventListener('close',()=>{const yes=d.returnValue==='yes';d.remove();resolve(yes);},{once:true}));
}
export interface BacklogPageOptions {
  text:readonly HistoryEntry[];scenes:readonly SceneHistoryRow[];jump:(id:number)=>Promise<void>;
}
export class BacklogPage {
  private readonly d=modal('pc-history','故事履历');
  private readonly title=artImage(layer(sheet,'@backlog'));
  private readonly sceneTitle=document.createElement('h2');
  private readonly switcher=document.createElement('button');
  private readonly caption=document.createElement('span');
  private readonly notice=document.createElement('p');
  private readonly range=document.createElement('input');
  private readonly scrolls=[document.createElement('section'),document.createElement('section')];
  private readonly starts=[false,false];
  private readonly offsets=[0,0];
  private mode=0;
  private busy=false;
  constructor(private readonly options:BacklogPageOptions){
    const d=this.d;d.id='pc-backlog';bindBacklogButtons(d);d.dataset.mode='text';d.append(artImage(layer(sheet,'@bg')),this.title,artImage(layer(sheet,'_chapter_title/@bar')));
    this.sceneTitle.textContent='场景履历';this.sceneTitle.className='pc-history-scene-title';place(this.sceneTitle,layer(sheet,'@backlog'));this.sceneTitle.hidden=true;d.append(this.sceneTitle);
    this.caption.className='pc-history-caption';place(this.caption,layer(sheet,'_chapter_title/@caption/lay:rect'));d.append(this.caption);
    this.notice.className='pc-history-notice';this.notice.setAttribute('role','status');place(this.notice,{x:65,y:1000,w:1000,h:52});d.append(this.notice);
    for(const [i,s] of this.scrolls.entries()){
      place(s,layer(sheet,box));s.className='pc-history-scroll';s.dataset.historyList=i?'scene':'text';s.tabIndex=0;
      s.setAttribute('aria-label',i?'场景履历条目':'对白履历条目');s.hidden=!!i;
      s.addEventListener('scroll',()=>{if(this.mode===i){this.offsets[i]=s.scrollTop;this.sync();}},{passive:true});this.drag(s);d.append(s);
    }
    const converter=new NativeTextConverter();for(const entry of options.text){const p=converter.prepare(entry.body);this.scrolls[0].append(this.entry(entry,p.program.atoms));converter.commit(p);}
    for(const scene of options.scenes){const atoms=new NativeTextConverter().prepare(scene.entry.body).program.atoms;this.scrolls[1].append(this.entry(scene.entry,atoms,scene));}
    if(!options.text.length)this.scrolls[0].append(this.empty('还没有经过的对白。'));
    if(!options.scenes.length)this.scrolls[1].append(this.empty('还没有可浏览的场景记录。'));
    this.switcher.type='button';this.switcher.id='pc-history-mode';this.switcher.className='pc-history-switch';this.switcher.textContent='场景履历';
    this.switcher.hidden=options.scenes.length===0;place(this.switcher,{x:1351,y:993,w:250,h:70});this.switcher.onclick=()=>this.switchMode();d.append(this.switcher);
    for(const [tag,name,id,f] of [['_home/@home','最早','home',()=>this.scroll.scrollTop=0],['_pageup/@pageup','向上翻页','prev',()=>this.scroll.scrollBy(0,-this.scroll.clientHeight)],['_next/@pagedown','向下翻页','next',()=>this.scroll.scrollBy(0,this.scroll.clientHeight)],['_end/@end','最新','end',()=>this.scroll.scrollTop=this.scroll.scrollHeight],['_back/@back','继续游戏','back',()=>this.d.close()]] as const){
      const b=artworkButton(sheet,tag,name,()=>{if(!this.busy)f();});b.id='pc-history-'+id;if(id==='back')b.autofocus=true;d.append(b);
    }
    d.append(artImage(layer(sheet,'_slider/@slider:rail')));this.range.type='range';this.range.min='0';this.range.step='1';this.range.setAttribute('aria-label','履历滚动进度');
    this.range.className='pc-history-range';this.range.style.setProperty('--history-thumb','url("'+layer(sheet,'_slider/@slider:defo').src+'")');place(this.range,layer(sheet,'_slider/@slider:rect'));this.range.oninput=()=>{this.scroll.scrollTop=this.range.valueAsNumber;};d.append(this.range);
    d.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});
    d.addEventListener('contextmenu',e=>{e.preventDefault();if(!this.busy)d.close();});
  }
  private get scroll(){return this.scrolls[this.mode];}
  private empty(message:string){const p=document.createElement('p');p.className='pc-history-empty';p.textContent=message;return p;}
  private entry(entry:HistoryEntry,atoms:ReturnType<NativeTextConverter['prepare']>['program']['atoms'],scene?:SceneHistoryRow){
    const row=document.createElement('article');row.className='pc-history-entry';row.dataset.key=entry.key;
    row.dataset.target=scene?String(scene.id):'';row.dataset.kind=entry.kind;
    const body=document.createElement('p');body.className='pc-history-body';appendNativeText(body,atoms);
    const name=document.createElement('span'),speaker=entry.kind==='choice'?'选择：':messageName(entry);
    row.dataset.caption=captionFor(scene?.title||entry.caption||'');
    name.className='pc-history-name';name.textContent=scene?row.dataset.caption:speaker;
    if(scene){
      if(speaker)body.prepend(document.createTextNode(speaker));
      const b=artworkButton(sheet,'_jump/@jump','回到这段剧情',()=>void this.choose(scene),{x:80,y:150,w:40,h:40},{x:18,y:140,w:1764,h:76});
      b.style.top='0';b.style.height='calc(40 * 100cqw / 1920)';b.id='pc-history-target-'+scene.id;b.disabled=!scene.ready;row.append(b);
      row.classList.add('pc-history-stop');
      if(!scene.ready){const tip=document.createElement('span');tip.className='pc-history-readonly';tip.textContent='仅回看';row.append(tip);}
      else{row.addEventListener('click',event=>{if(!(event.target as Element)?.closest('button'))void this.choose(scene);});}
    }
    if(!name.textContent)row.classList.add('pc-history-narration');row.append(name,body);return row;
  }
  private sync(){
    const s=this.scroll,max=Math.max(0,s.scrollHeight-s.clientHeight);this.range.max=String(max);this.range.value=String(s.scrollTop);this.range.disabled=!max;
    let low=0,high=s.children.length;
    while(low<high){const middle=(low+high)>>>1,row=s.children[middle] as HTMLElement;
      if(row.offsetTop+row.offsetHeight<=s.scrollTop)low=middle+1;else high=middle;
    }
    this.caption.textContent=(s.children[low] as HTMLElement|undefined)?.dataset.caption??'';
  }
  private switchMode(){
    if(this.busy)return;
    this.offsets[this.mode]=this.scroll.scrollTop;this.scroll.hidden=true;this.mode=1-this.mode;
    this.d.dataset.mode=this.mode?'scene':'text';this.title.hidden=!!this.mode;this.sceneTitle.hidden=!this.mode;
    this.switcher.textContent=this.mode?'对白履历':'场景履历';this.switcher.setAttribute('aria-pressed',String(!!this.mode));
    this.scroll.hidden=false;this.scroll.scrollTop=this.starts[this.mode]?this.offsets[this.mode]:this.scroll.scrollHeight;
    this.starts[this.mode]=true;this.sync();
  }
  private async choose(scene:SceneHistoryRow){
    if(this.busy||!scene.ready)return;
    this.busy=true;
    try{
      if(!await dialogQuestion())return;
      this.notice.textContent='正在还原原场景…';this.d.setAttribute('aria-busy','true');
      await this.options.jump(scene.id);this.d.close('jump');
    }catch(error){this.notice.textContent='未回跳：'+(error instanceof Error?error.message:String(error));}
    finally{this.d.removeAttribute('aria-busy');this.busy=false;}
  }
  private drag(s:HTMLElement){
    let pointer:number|undefined,x=0,y=0,top=0,dragged=false;
    s.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||pointer!==undefined)return;pointer=e.pointerId;x=e.clientX;y=e.clientY;top=s.scrollTop;dragged=false;});
    s.addEventListener('pointermove',e=>{if(pointer!==e.pointerId)return;
      const turn=getComputedStyle(this.d).transform.startsWith('matrix(0, 1, -1, 0'),diff=turn?x-e.clientX:e.clientY-y;
      if(!dragged&&Math.abs(diff)>8){dragged=true;s.setPointerCapture(e.pointerId);}if(dragged)s.scrollTop=top-diff;
    });
    const stop=(e:PointerEvent)=>{if(pointer===e.pointerId)pointer=undefined;};s.addEventListener('pointerup',stop);s.addEventListener('pointercancel',stop);
    s.addEventListener('click',e=>{if(dragged){dragged=false;e.preventDefault();e.stopImmediatePropagation();}},true);
  }
  run():Promise<void>{
    try{this.d.showModal();}catch(error){this.d.remove();throw error;}this.scroll.scrollTop=this.scroll.scrollHeight;this.starts[0]=true;this.sync();
    return new Promise(resolve=>this.d.addEventListener('close',()=>{this.d.remove();resolve();},{once:true}));
  }
}
