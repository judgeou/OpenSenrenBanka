import {titleWidth,titleHeight} from './native-title-art.ts';

export type TitleAction='new'|'load'|'gallery'|'continue'|'after'|'settings';
interface Layer {id:number; parentId?:number; name:string; layerType:number;left:number;top:number;width:number;height:number;file?:string}
const rows=[['_newgame','从原开始','new'],['_dataload','读取存档','load'],['_continue','继续','continue'],['_extra','鉴赏','gallery'],['_after','后日谈','after'],['_system','设置','settings']] as const;
export async function prepareTitleMenu(assets:URL,cleared:boolean,hasContinue:boolean,unlocked:boolean,onAction:(action:TitleAction)=>void):Promise<HTMLElement>{
  const r=await fetch(new URL('menu/layers.json',assets));if(!r.ok)throw Error('原标题菜单缺少简中图层');
  const data=await r.json();
  if(data?.width!==titleWidth||data.height!==titleHeight||!Array.isArray(data.layers)||data.layers.length!==48)throw Error('原标题 PIMG 尺寸或层身份不符');
  const layers=data.layers as Layer[];
  if(new Set(layers.map(l=>l.id)).size!==layers.length)throw Error('原标题 PIMG 有重复层');
  const first=layers.find(l=>l.layerType===2&&l.parentId===undefined&&l.name==='_first');
  if(!first)throw Error('原标题缺少首周目布局');
  const menu=document.createElement('nav');menu.className='r69-title-menu';menu.setAttribute('aria-label','原标题菜单');menu.hidden=true;
  menu.dataset.titleLayout=cleared?'clear':'first';
  const preload:Promise<void>[]=[];
  const url=(l:Layer)=>{
    if(typeof l.file!=='string'||!/^\d+[.](?:png|webp)$/u.test(l.file)||![l.left,l.top,l.width,l.height].every(Number.isSafeInteger)||l.left<0||l.top<0||l.width<1||l.height<1||l.left+l.width>titleWidth||l.top+l.height>titleHeight)throw Error('原标题按钮纹理或范围不符: '+l.name);
    return new URL('menu/'+l.file,assets).href;
  };
  for(const [group,label,action]of rows){
    if(!unlocked&&(action==='gallery'||action==='after'))continue;
    // CustomTitle.onUiload removes rm_clear (the _first controls) once sf.clear is set.
    const parent=layers.find(l=>l.layerType===2&&l.name===group&&l.parentId===(cleared?undefined:first.id));
    if(!parent){if(!cleared&&(group==='_after'||group==='_extra'))continue;throw Error('原标题按钮组缺失: '+group);}
    const state=(s:string)=>layers.find(l=>l.layerType===0&&l.parentId===parent.id&&l.name.endsWith(':'+s));
    const normal=state('defo');if(!normal)throw Error('原标题按钮初始图层缺失');
    const n=url(normal), over=state('over'), on=state('on');
    const hover=over?url(over):n, pressed=on?url(on):hover;
    const b=document.createElement('button'), image=document.createElement('img');
    b.type='button';b.id='original-title-'+group.slice(1);b.dataset.titleButton=group;b.setAttribute('aria-label',label);b.disabled=action==='continue'&&!hasContinue;
    b.style.left=100*normal.left/titleWidth+'%';b.style.top=100*normal.top/titleHeight+'%';b.style.width=100*normal.width/titleWidth+'%';b.style.height=100*normal.height/titleHeight+'%';
    image.alt='';image.draggable=false;image.src=n;b.append(image);
    for(const asset of new Set([n,hover,pressed])){const probe=new Image();probe.src=asset;preload.push(probe.decode().catch(cause=>{throw Error('原标题按钮图片无法解码：'+new URL(asset).pathname,{cause});}));}
    b.onpointerenter=b.onfocus=()=>{if(!b.disabled)image.src=hover;};
    b.onpointerleave=b.onblur=()=>{image.src=n;};b.onpointerdown=()=>{if(!b.disabled)image.src=pressed;};b.onpointerup=()=>{if(!b.disabled)image.src=hover;};
    b.onclick=()=>onAction(action);
    menu.append(b);
  }
  await Promise.all(preload);
  return menu;
}
