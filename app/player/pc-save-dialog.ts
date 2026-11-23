import type {SaveCard} from '../save-card.ts';
import {art,artImage,artworkButton,ink,layer,modal,place,saveDate,ThumbUrls} from './pc-save-surface.ts';
export type SaveQuestion='save'|'rewrite'|'load'|'qsave'|'qload';
const labels={save:'保存到这里？',rewrite:'覆盖这个存档？',load:'读取这个存档？',qsave:'快速保存？',qload:'读取最新快档？'};
export function saveConfirm(action:SaveQuestion):Promise<boolean>{
  const d=modal('pc-save-confirm',labels[action]);d.id='pc-save-confirm';d.dataset.question=action;
  const sheet=art.dialog;d.setAttribute('aria-modal','true');
  try{
    d.append(artImage(layer(sheet,'@cont_bg')),artImage(layer(sheet,'@dialog_'+action)));
    const button=(tag:'yes'|'no')=>artworkButton(sheet,'_yesno/@'+tag,tag==='yes'?'确认':'取消',()=>d.close(tag));
    const yes=button('yes'),no=button('no');yes.id='pc-save-confirm-yes';no.id='pc-save-confirm-no';no.autofocus=true;d.append(yes,no);
    d.showModal();
    return new Promise(resolve=>d.addEventListener('close',()=>{const ok=d.returnValue==='yes';d.remove();resolve(ok);},{once:true}));
  }catch(error){d.remove();throw error;}
}
export function quickHover(root:HTMLElement,button:HTMLElement,card:SaveCard,title:string){
  const sheet=art.qload_popup,base=layer(sheet,'#rect'),view=root.getBoundingClientRect(),b=button.getBoundingClientRect();
  const x=(b.x+b.width/2-view.x)*1920/view.width-base.w/2,y=(b.y-view.y)*1080/view.height-base.h-12;
  const box=place(document.createElement('div'),{...base,x,y});box.id='pc-quick-preview';box.className='pc-q-preview';
  const urls=new ThumbUrls();const thumb=layer(sheet,'thumb'),old=()=>box.append(ink('此档无预览',thumb,base,'pc-empty'));
  box.append(artImage(layer(sheet,'qload'),base));
  if(card.thumbnail)box.append(urls.picture(card.thumbnail,thumb,base,old));else old();
  box.append(ink('Q.01',layer(sheet,'#num'),base,'pc-number'),ink(card.excerpt,layer(sheet,'#text'),base),ink(saveDate(card.created),layer(sheet,'#date'),base),ink(title,layer(sheet,'#chapter'),base,'pc-small-chapter'));
  root.append(box);return ()=>{box.remove();urls.clear();};
}
