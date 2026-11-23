import type {EditionSaveShelf} from '../edition-save-shelf.ts';
import type {SaveCard,SaveCell} from '../save-card.ts';
import {maxSavePages,SavePayloadDamaged} from '../save-card.ts';
import {art,artImage,artworkButton,ink,layer,modal,place,saveDate,ThumbUrls} from './pc-save-surface.ts';
import {saveConfirm} from './pc-save-dialog.ts';
import type {Sheet} from './pc-save-surface.ts';

type Mode='save'|'load'|'quick';
interface Actions {
  shelf:EditionSaveShelf;
  canSave:boolean; inStory:boolean;
  label(card:SaveCard):string;
  write(page:number,cell:SaveCell):Promise<void>;
  read(card:SaveCard):Promise<void>;
}
/** PC PIMG grid. Only the visible page obtains cards and object URLs. */
export class PcSavePage {
  readonly dialog:HTMLDialogElement;
  private readonly thumbs=new ThumbUrls();
  private readonly detail=document.createElement('div');
  private current=1;
  private selected=-1;
  private touchSelected=-1;
  private busy=false;
  private grid:HTMLButtonElement[]=[];
  private finish!:()=>void;
  private notice?:HTMLElement;
  constructor(private mode:Mode,private readonly actions:Actions){
    this.dialog=modal('pc-save-page','原存读档');this.dialog.id='pc-save-page';
    this.detail.id='pc-save-detail';
    this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
    this.dialog.addEventListener('close',()=>{this.thumbs.clear();this.dialog.remove();this.finish();},{once:true});
  }
  async run(){
    const end=new Promise<void>(r=>{this.finish=r;});
    this.dialog.showModal();await this.show(this.mode==='quick'?0:1);return end;
  }
  private sheet():Sheet{return art[this.mode==='save'?'sl_save':this.mode==='load'?'sl_load':'sl_qlod'];}
  private inform(value:string){if(this.notice)this.notice.textContent=value;}
  private async show(page:number){
    if(this.busy||!this.dialog.open)return;
    this.busy=true;this.dialog.setAttribute('aria-busy','true');
    try{
      const result=await this.actions.shelf.page(page);if(!this.dialog.open)return;
      this.current=result.page;if(!this.current)this.mode='quick';else if(this.mode==='quick')this.mode='load';
      this.dialog.dataset.page=String(this.current);this.dialog.dataset.pages=String(result.pages);this.dialog.dataset.mode=this.mode;
      const sheet=this.sheet();this.thumbs.clear();this.grid=[];this.touchSelected=-1;
      this.dialog.replaceChildren(artImage(layer(sheet,'@bg')),artImage(layer(sheet,'@cont_bg')));
      const nav=(tag:string,id:string,label:string,action:()=>void,enabled=true)=>{
        const b=artworkButton(sheet,tag,label,()=>{if(!this.busy)action();});b.dataset.saveNav=id;b.disabled=!enabled;this.dialog.append(b);
      };
      const tab=(mode:Mode)=>{this.mode=mode;void this.show(mode==='quick'?0:Math.max(this.current,1));};
      if(this.mode!=='save'&&this.actions.canSave)nav('_foot/_save/@save','save','普通存档',()=>tab('save'));
      if(this.mode!=='load')nav('_foot/_load/@load','load','普通读档',()=>tab('load'));
      if(this.mode!=='quick')nav('_foot/_qroad/@qload','quick','快档页',()=>tab('quick'));
      nav(this.actions.inStory?'_foot/_back/@back':'_foot/_title/@title','back','返回',()=>this.dialog.close());
      if(this.current){
        const at=this.current,last=result.pages-1;
        nav('_home/@home','first','首个普通页',()=>void this.show(1),at>1);
        nav('_prev_more/@prev_more','prev10','向前十页',()=>void this.show(Math.max(1,at-10)),at>1);
        nav('_prev/@prev','prev','上一页',()=>void this.show(at-1),at>1);
        const forward=sheet['_next/@nest:defo']?'_next/@nest':'_next/@next';
        const more=sheet['_next_more/@_next_more:defo']?'_next_more/@_next_more':'_next_more/@next_more';
        nav(forward,'next','下一页',()=>void this.show(at+1),at<last);
        nav(more,'next10','向后十页',()=>void this.show(Math.min(last,at+10)),at<last);
        nav('_end/@end','last','末页',()=>void this.show(last),at<last);
        nav('_plus/@plus','add','新增普通页',()=>void this.resize(1),result.pages<maxSavePages);
        nav('_mainus/@mainus','remove','减少末尾空页',()=>void this.resize(-1),result.canReduce);
        this.dialog.append(artImage(layer(sheet,'_num/@num_bg')),ink(String(at),layer(sheet,'_num/@value:rect'),undefined,'pc-page-number'));
      }
      const reference=layer(sheet,'_data/@data:rect');
      for(const cell of result.cells)this.makeCell(sheet,reference,cell);
      this.notice=ink(this.mode==='save'?'选择档位以保存当前场景':this.mode==='quick'?'快档按新到旧排列':'选择档位以读取',sheet['@helptext/lay:rect']??{x:71,y:995,w:747,h:61},undefined,'pc-notice');
      this.notice.setAttribute('role','status');this.dialog.append(this.detail,this.notice);
      this.select(result.cells.find(c=>c.card)??result.cells[0]);
      this.dialog.querySelector<HTMLButtonElement>('[data-save-nav=back]')?.focus({preventScroll:true});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(this.notice&&this.notice.isConnected)this.inform(message);else{
        const close=document.createElement('button');close.type='button';close.textContent='返回';close.onclick=()=>this.dialog.close();
        this.dialog.replaceChildren(ink(message,{x:160,y:480,w:1600,h:90},undefined,'pc-save-failure'),place(close,{x:840,y:590,w:240,h:75}));
      }
    }finally{this.busy=false;this.dialog.removeAttribute('aria-busy');}
  }
  private makeCell(sheet:Sheet,base:ReturnType<typeof layer>,cell:SaveCell){
    const n=String(cell.index+1).padStart(2,'0'),b=document.createElement('button'),card=cell.card;
    const box=layer(sheet,'#_data_表示位置/'+n),title=card?this.actions.label(card):cell.damaged?'存档损坏':'空槽';
    const number=this.mode==='quick'?'Q.'+n:String(this.current).padStart(2,'0')+'-'+n;
    b.type='button';b.className='pc-save-cell';b.dataset.saveCell=String(cell.index+1);b.dataset.state=card?'saved':cell.damaged?'damaged':'empty';
    b.dataset.chapter=card?title:'';if(card){b.dataset.asset=card.asset;b.dataset.scene=String(card.scene);b.dataset.cursor=String(card.cursor);b.dataset.revision=card.revision;}
    b.setAttribute('aria-label',number+' '+title);b.disabled=!!cell.damaged||(!card&&this.mode!=='save');place(b,box);
    const image=layer(sheet,card?'_data/@data:defo':'_data/@data_noth:disable');b.append(artImage(image,base));
    b.append(artImage(layer(sheet,card?'_data/@data:over':'_data/@data_noth:over'),base,'pc-save-highlight'));
    // SaveDataButton composites the real thumbnail into every template state.
    const thumb=layer(sheet,'_data/thumb');
    if(card?.thumbnail)b.append(this.thumbs.picture(card.thumbnail,thumb,base,()=>b.append(ink('无可用预览',thumb,base,'pc-empty'))));
    else if(card||cell.damaged)b.append(ink(card?'旧档无预览':title,thumb,base,'pc-empty'));
    b.append(ink(number,layer(sheet,'_data/#num'),base,'pc-number'));
    if(card){
      b.append(ink(card.excerpt,layer(sheet,'_data/#text'),base),ink(saveDate(card.created),layer(sheet,'_data/#date'),base,'pc-slotdate'),ink(title,layer(sheet,'_data/#chapter'),base,'pc-small-chapter'+(title.length>4?' pc-route-chapter':'')));
    }
    let touch=false;
    b.onpointerdown=e=>{touch=e.pointerType==='touch';};
    b.onpointerenter=e=>{if(e.pointerType!=='touch'&&!this.busy)this.select(cell);};
    b.onfocus=()=>{if(!this.busy)this.select(cell);};
    b.onclick=()=>{
      if(this.busy)return;
      this.select(cell);
      if(touch&&this.touchSelected!==cell.index){this.touchSelected=cell.index;this.inform('再点一次确认此档位');return;}
      this.touchSelected=-1;void this.choose(cell);
    };
    this.grid.push(b);this.dialog.append(b);
  }
  private select(cell:SaveCell){
    this.selected=cell.index;
    for(const [index,b] of this.grid.entries()){const on=index===this.selected;b.dataset.selected=String(on);b.setAttribute('aria-pressed',String(on));}
    const sheet=this.sheet(),card=cell.card,thumb=layer(sheet,'_data_l/thumb'),date=layer(sheet,'_data_l/#date'),chapter=layer(sheet,'_data_l/#chapter'),comment=layer(sheet,'_data_l/#text');
    this.detail.replaceChildren(artImage(thumb));
    if(card?.thumbnail)this.detail.append(this.thumbs.picture(card.thumbnail,thumb,undefined,()=>this.detail.append(ink('无可用预览',thumb,undefined,'pc-empty'))));
    else this.detail.append(ink(card?'旧档无预览':cell.damaged?'存档损坏':'空槽',thumb,undefined,'pc-empty'));
    this.detail.append(ink(card?saveDate(card.created):'',date,undefined,'pc-detail-date'),ink(card?this.actions.label(card):'',chapter,undefined,'pc-detail-chapter'),ink(card?.excerpt??'',comment,undefined,'pc-detail-comment'));
  }
  private async resize(add:1|-1){
    this.busy=true;try{await this.actions.shelf.resize(add);this.busy=false;await this.show(add>0?maxSavePages:this.current-1);}catch(error){this.inform(String(error));}finally{this.busy=false;}
  }
  private async choose(cell:SaveCell){
    if(cell.damaged||this.busy)return;
    this.busy=true;
    try{
      if(this.mode==='save'){
        if(!await saveConfirm(cell.card?'rewrite':'save'))return;
        await this.actions.write(this.current,cell);this.busy=false;await this.show(this.current);this.inform('已保存');
      }else if(cell.card&&await saveConfirm('load')){await this.actions.read(cell.card);this.dialog.close();}
    }catch(error){
      if(error instanceof SavePayloadDamaged){
        const damaged={index:cell.index,damaged:true};
        const previous=this.grid[cell.index];this.makeCell(this.sheet(),layer(this.sheet(),'_data/@data:rect'),damaged);
        const b=this.grid.pop()!;this.grid[cell.index]=b;previous.replaceWith(b);this.select(damaged);
      }
      this.inform(String(error));
    }finally{this.busy=false;}
  }
}
