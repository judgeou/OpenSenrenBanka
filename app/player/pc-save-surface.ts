import art from 'virtual:yoshino-pc-save';
import type {SaveLayer} from 'virtual:yoshino-pc-save';
import './pc-save.css';
export {art};
export type Rect=Pick<SaveLayer,'x'|'y'|'w'|'h'>;
export type Sheet=Readonly<Record<string,SaveLayer>>;
export const screen={x:0,y:0,w:1920,h:1080};
export function layer(sheet:Sheet,key:string):SaveLayer{const row=sheet[key];if(!row)throw Error('缺少原存取档图层 '+key);return row;}
export function place<T extends HTMLElement>(el:T,box:Rect,base:Rect=screen):T{
  el.style.left=(box.x-base.x)*100/base.w+'%';el.style.top=(box.y-base.y)*100/base.h+'%';
  el.style.width=box.w*100/base.w+'%';el.style.height=box.h*100/base.h+'%';return el;
}
export function artImage(row:SaveLayer,base:Rect=screen,css=''):HTMLImageElement{
  if(!row.src)throw Error('原存档图缺少位图');const img=new Image();img.alt='';img.draggable=false;img.src=row.src;img.className=css;
  return place(img,row,base);
}
export function ink(text:string,box:Rect,base:Rect=screen,classes=''):HTMLElement{
  const label=document.createElement('span');label.className='pc-save-ink '+classes;label.textContent=text;return place(label,box,base);
}
export function artworkButton(sheet:Sheet,tag:string,label:string,action:()=>void,box?:Rect,base=screen){
  const b=document.createElement('button');b.type='button';b.className='pc-save-sprite';b.setAttribute('aria-label',label);b.title=label;
  const def=layer(sheet,tag+':defo'),rect=box??def;place(b,rect,base);b.onclick=action;
  b.append(artImage(def,rect,'pc-save-def'));
  for(const [state,kind] of [['over','over'],['on','on']] as const){
    const names=tag==='_next/@nest'?['_next/@next']:tag==='_next_more/@_next_more'?['_next_more/@next_more']:[];
    const actual=sheet[tag+':'+state]??names.map(n=>sheet[n+':'+state]).find(Boolean)??(state==='on'?sheet[tag+':one']:undefined);
    if(actual)b.append(artImage(actual,rect,'pc-save-'+kind));
  }
  return b;
}
export function modal(klass:string,label:string){
  const d=document.createElement('dialog');d.className='pc-save-modal '+klass;
  d.setAttribute('aria-label',label);document.body.append(d);return d;
}
export class ThumbUrls {
  private readonly urls=new Map<Blob,string>();
  picture(blob:Blob,box:Rect,base:Rect=screen,missing?:()=>void){
    let url=this.urls.get(blob);if(!url){url=URL.createObjectURL(blob);this.urls.set(blob,url);}
    const img=artImage({...box,src:url},base,'pc-save-thumb');img.alt='存档现场';img.onerror=()=>{img.remove();missing?.();};return img;
  }
  clear(){for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();}
}
const formats=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const saveDate=(date:string)=>formats.format(Date.parse(date));
