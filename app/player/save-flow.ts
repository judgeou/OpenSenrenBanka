import type {EditionSaveShelf} from '../edition-save-shelf.ts';
import type {OpenedSlot,PreparedSave,SaveCard} from '../save-card.ts';
import type {NativeSession,SystemProgressData} from '../native-session-types.ts';
import {SessionBoundaryUnavailable} from '../../src/runtime/native-session-driver.ts';
import type {PlayerSnapshot} from '../../src/runtime/types.ts';

type Mode='save'|'load'|'qsave'|'qload';
interface SaveHost {
  current:()=>NativeSession|undefined;
  allowed:()=>boolean;
  change:()=>void;
  captureProgress:(s:NativeSession,snapshot:PlayerSnapshot)=>SystemProgressData;
  loaded:(slot:OpenedSlot)=>void;
  notice:(text:string)=>void;
  issue:(e:unknown)=>void;
  title:(card:SaveCard)=>string;
}
export class SaveFlow {
  active=false;
  acquiring=false;
  hasQuick=false;
  private hoverId=0;
  private closeHover?:()=>void;
  constructor(readonly shelf:EditionSaveShelf,private readonly viewport:HTMLElement,private readonly host:SaveHost){}
  async latest(){
    this.hasQuick=!!await this.shelf.latestQuick().catch(()=>undefined);return this.shelf.latest();
  }
  async continue(){
    if(this.active||!this.host.allowed())return;
    this.active=true;this.host.change();
    let loaded:OpenedSlot|undefined;
    try{loaded=await this.shelf.openLatest();}
    catch(error){this.host.issue(error);}
    finally{this.active=false;this.host.change();}
    if(loaded)this.host.loaded(loaded);
  }
  private async acquire(s:NativeSession):Promise<PreparedSave>{
    const start=s.view(),key=(v:typeof start)=>[v.position.asset,v.position.scene,v.position.cursor,v.waiting.kind,v.position.currentText].join('/');
    const begin=key(start),end=performance.now()+1100;
    this.acquiring=true;this.host.change();
    try{
      for(;;){
        if(s!==this.host.current()||key(s.view())!==begin||document.hidden)throw new SessionBoundaryUnavailable('保存位置已改变，请重新操作');
        const captured=new Date().toISOString();
        try{if(!s.view().saveReason)return {...await s.saveWithThumbnail(),captured};}
        catch(error){
          if(!(error instanceof SessionBoundaryUnavailable)||!/真实提交|原过渡或前置演出|内部续页/u.test(error.message))throw error;
        }
        if(performance.now()>=end)throw new SessionBoundaryUnavailable('等待原过渡或前置演出完成');
        await new Promise<void>(resolve=>setTimeout(resolve,45));
      }
    }finally{this.acquiring=false;}
  }
  async open(mode:Mode){
    if(this.active||!this.host.allowed())return;
    const s=this.host.current(),requiresSave=mode==='save'||mode==='qsave';
    if(requiresSave&&(!s||s.view().saveReason))return;
    this.hidePreview();this.active=true;this.host.change();
    let suspended=false,requested:OpenedSlot|undefined;
    try{
      let shot:PreparedSave|undefined,progress:SystemProgressData|undefined;
      if(s&&!s.view().saveReason&&(requiresSave||mode==='load')){
        try{shot=await this.acquire(s);progress=this.host.captureProgress(s,shot.snapshot);}
        catch(error){if(requiresSave)throw error;shot=undefined;}
      }
      if(s){await s.pause(true,'pc-save','story');suspended=true;}
      if(mode==='save'||mode==='load'){
        const {PcSavePage}=await import('./pc-save-page.ts');
        await new PcSavePage(mode,{
          shelf:this.shelf,canSave:!!shot&&!!progress,inStory:!!s,label:this.host.title,
          write:async(page,cell)=>{
            if(!shot||!progress)throw Error('没有可保存的实际呈现边界');
            await this.shelf.write(shot,progress,{page,index:cell.index,expected:cell.card});this.host.notice('存档已保存');
          },
          read:async card=>{const ready=await this.shelf.open(card);if(!ready)throw Error('该槽没有可读存档');requested=ready;},
        }).run();
      }else{
        const {saveConfirm}=await import('./pc-save-dialog.ts');
        if(mode==='qsave'){
          if(!shot||!progress)throw Error('没有可保存的实际呈现边界');
          if(await saveConfirm('qsave')){await this.shelf.write(shot,progress,'quick');this.hasQuick=true;this.host.notice('快速槽已保存');}
        }else {
          const newest=await this.shelf.latestQuick();if(!newest)throw Error('没有可用快档');
          if(await saveConfirm('qload')){
            // This confirmation names the captured head, not whatever might be written in another tab during the prompt.
            requested=await this.shelf.open(newest);if(!requested)throw Error('快档已改变');
          }
        }
      }
    }catch(error){this.host.issue(error);}
    finally{
      try{if(suspended&&s===this.host.current())await s!.pause(false,'pc-save');}
      catch(error){this.host.issue(error);}
      this.active=false;this.host.change();
    }
    if(requested)this.host.loaded(requested);
  }
  hidePreview(){this.hoverId++;this.closeHover?.();this.closeHover=undefined;}
  async preview(button:HTMLElement){
    this.hidePreview();if(this.active||!this.host.allowed())return;
    const token=this.hoverId;
    try{
      const row=await this.shelf.latestQuick();if(!row||token!==this.hoverId)return;
      const {quickHover}=await import('./pc-save-dialog.ts');
      if(token===this.hoverId&&button.isConnected&&!button.matches(':disabled')&&!this.active)
        this.closeHover=quickHover(this.viewport,button,row,this.host.title(row));
    }catch{/* Corrupt/empty slots do not leave stale preview. Actual load reports an error. */}
  }
}
