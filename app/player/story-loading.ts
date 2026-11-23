import {el} from './panels.ts';
import type {EntryProgress} from '../native-session-options.ts';

const details=['正在连接故事…','正在读取剧情索引和资源目录…','正在准备画面和字体…','正在准备声音与开场…','正在载入开场，等待第一句对白…','故事已准备好'];
const entrySteps:Record<EntryProgress,number>={resources:2,graphics:3,dialogue:5};

/** The bar counts verified milestones, not time or unknown network bytes. */
export class StoryLoading {
  readonly root=el('story-loading');
  private readonly bar=el<HTMLProgressElement>('story-progress');
  private readonly title=el('story-loading-title');
  private readonly detail=el('story-loading-detail');
  private readonly count=el('story-loading-count');
  private readonly hint=el('story-loading-hint');
  private readonly actions=el('story-loading-actions');
  private readonly retry=el<HTMLButtonElement>('story-loading-retry');
  private readonly back=el<HTMLButtonElement>('story-loading-back');
  private slow?:ReturnType<typeof setTimeout>;
  private step=0;
  get shown(){return !this.root.hidden;}
  get waiting(){return this.root.dataset.phase==='loading';}
  get failed(){return this.root.dataset.phase==='error';}
  begin():void {
    clearTimeout(this.slow);this.step=0;this.root.dataset.phase='loading';this.root.removeAttribute('data-first-text');
    this.root.hidden=false;this.bar.hidden=false;this.count.hidden=false;this.actions.hidden=true;
    this.title.textContent='正在开启故事';this.hint.textContent='首次进入需要准备资源，请稍候。';
    this.update(0);this.root.focus({preventScroll:true});
    this.slow=setTimeout(()=>{if(this.waiting)this.hint.textContent='首次加载可能需要一点时间，慢速网络下也会继续准备。';},8000);
  }
  readonly report=(state:EntryProgress,firstText?:string):void=>{
    if(!this.waiting)return;
    if(state==='dialogue'){
      if(!firstText)return;
      this.update(entrySteps.dialogue);this.root.dataset.firstText=firstText;this.hide('ready');
    }else this.update(entrySteps[state]);
  };
  program():void {this.update(1);}
  opening():void {this.update(4);}
  private update(n:number):void {
    if(!this.waiting||n<this.step)return;
    this.step=n;this.root.dataset.step=String(n);this.bar.value=n;
    this.count.textContent='已完成 '+n+' / '+this.bar.max+' 步';this.detail.textContent=details[n];
  }
  fail():void {
    if(!this.waiting)return;
    clearTimeout(this.slow);this.root.dataset.phase='error';this.bar.hidden=true;this.count.hidden=true;
    this.title.textContent='暂时没能进入故事';this.detail.textContent='请检查网络连接，再试一次。';
    this.hint.textContent='这不会删除已有的存档或进度。';
  }
  recover(retry:()=>void,back:()=>void):void {
    if(!this.failed)return;
    this.actions.hidden=false;this.retry.onclick=retry;this.back.onclick=back;this.retry.focus({preventScroll:true});
  }
  returning():void {
    this.actions.hidden=true;this.detail.textContent='正在返回标题…';
  }
  titleUnavailable():void {this.detail.textContent='暂时打不开标题。请检查网络后再试。';}
  hide(phase:'ready'|'idle'='idle'):void {
    clearTimeout(this.slow);this.root.dataset.phase=phase;this.root.hidden=true;
    this.retry.onclick=null;this.back.onclick=null;
  }
}
