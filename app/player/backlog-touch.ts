/** Buttons share their normal action, but don't wait for a delayed synthetic click on a rotated touch surface. */
export function bindBacklogButtons(dialog:HTMLDialogElement){
  let down:{target:HTMLButtonElement;id:number;x:number;y:number}|undefined,activated:HTMLButtonElement|undefined;
  const button=(e:Event)=>(e.target as Element|null)?.closest<HTMLButtonElement>('button:enabled');
  dialog.addEventListener('pointerdown',e=>{
    activated=undefined;const b=button(e);
    if(e.pointerType==='touch'&&e.isPrimary&&b)down={target:b,id:e.pointerId,x:e.clientX,y:e.clientY};
  },true);
  dialog.addEventListener('pointercancel',e=>{if(down?.id===e.pointerId)down=undefined;},true);
  dialog.addEventListener('pointerup',e=>{
    if(down?.id!==e.pointerId)return;const {target,x,y}=down;down=undefined;
    if(button(e)!==target||Math.hypot(x-e.clientX,y-e.clientY)>10)return;
    target.click();activated=target;e.preventDefault();
  },true);
  dialog.addEventListener('click',e=>{
    if(e.isTrusted&&e.detail>0&&activated&&button(e)===activated){e.preventDefault();e.stopImmediatePropagation();}
  },true);
}
