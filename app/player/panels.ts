export const el = <T extends HTMLElement = HTMLElement>(id:string) => {
  const node=document.getElementById(id);if(!node)throw Error('缺少界面：'+id);return node as T;
};
export const panel=el<HTMLDialogElement>('panel');
// Keep the confirmation style in sync with the stage media query in touch-layout.css.
export const touchLayout=matchMedia('(pointer:coarse) and (hover:none)');
const touchConfirm=el<HTMLDialogElement>('touch-confirm');
export const confirming=()=>touchConfirm.open;
export async function confirmAction(message:string):Promise<boolean>{
  if(confirming())return false;
  el('touch-confirm-message').textContent=message;
  touchConfirm.returnValue='';touchConfirm.showModal();
  return new Promise(resolve=>touchConfirm.addEventListener('close',()=>resolve(touchConfirm.returnValue==='yes'),{once:true}));
}
export function showPanel(title:string,content:HTMLElement){
  if(panel.open)throw Error('请先关闭当前对话框');
  el('panel-title').textContent=title;el('panel-body').replaceChildren(content);panel.showModal();
}
el('panel-close').onclick=()=>panel.close();
