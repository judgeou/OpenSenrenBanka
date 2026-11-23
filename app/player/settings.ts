import type {AudioMix} from '../../src/audio/edition-mix.ts';
import {cacheSettings} from './resource-cache/client.ts';
const key='senren-yoshino-v1-settings';
export const prefetchDefaultMB=8,prefetchMaxMB=64,bytesPerMB=1_000_000;
export interface Settings {characterDelay:number;autoDelay:number;prefetchMB:number;windowOpacity:number;quickLocked:boolean;mix:AudioMix}
export const ranges=[['characterDelay','字间间隔',0,100,1,'毫秒'],['autoDelay','自动等待',0,6000,50,'毫秒'],['prefetchMB','资源预读上限',0,prefetchMaxMB,1,'MB'],['bgm','背景音乐',0,100,1,'%'],['voice','配音',0,100,1,'%'],['se','音效',0,100,1,'%'],['master','总音量',0,100,1,'%'],['windowOpacity','对话窗不透明度',0,100,1,'%']] as const;
function bounded(v:unknown,fallback:number,max:number):number{return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:fallback;}
export function loadSettings(defaults:Pick<Settings,'characterDelay'|'autoDelay'>):Settings{
  let row:Partial<Settings>={};
  try{const raw=JSON.parse(localStorage.getItem(key)??'null');if(raw?.version===1)row=raw;}catch{/* Invalid settings never overwrite saves. */}
  return {characterDelay:bounded(row.characterDelay,defaults.characterDelay,100),autoDelay:bounded(row.autoDelay,defaults.autoDelay,6000),
    prefetchMB:Number.isSafeInteger(row.prefetchMB)?bounded(row.prefetchMB,prefetchDefaultMB,prefetchMaxMB):prefetchDefaultMB,
    windowOpacity:Number.isInteger(row.windowOpacity)?bounded(row.windowOpacity,75,100):75,quickLocked:row.quickLocked!==false,
    mix:{master:bounded(row.mix?.master,1,1),bgm:bounded(row.mix?.bgm,1,1),voice:bounded(row.mix?.voice,1,1),se:bounded(row.mix?.se,1,1)}};
}
export const windowAlpha=(s:Settings)=>Math.min(255,Math.trunc(s.windowOpacity*256/100))/255;
export function persistSettings(s:Settings){localStorage.setItem(key,JSON.stringify({version:1,...s}));}
export function settingsForm(s:Settings,changed:()=>void):HTMLElement{
  const form=document.createElement('div');
  for(const [key,label,min,max,step,unit] of ranges){
    const row=document.createElement('label'),input=document.createElement('input'),output=document.createElement('output');
    row.className='control-row';input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.id='setting-'+key;
    const value=key==='bgm'||key==='voice'||key==='se'||key==='master'?(s.mix[key]??1)*100:s[key];input.value=String(Math.round(value));
    output.textContent=input.value+' '+unit;input.oninput=()=>{const n=input.valueAsNumber;if(key==='bgm'||key==='voice'||key==='se'||key==='master')s.mix[key]=n/100;else s[key]=n;output.textContent=input.value+' '+unit;changed();};
    row.append(label,input,output);form.append(row);
  }
  const note=document.createElement('p');note.textContent='预读上限包含缓存和正在下载的预读资源（0 MB 关闭），不限制当前画面或声音。音量相对于原始混音。';form.append(note,cacheSettings());return form;
}
