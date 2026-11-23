import {heroines} from './route-key.ts';
import type {Heroine} from './route-key.ts';
import {showPanel,panel} from './panels.ts';
export async function showAfterOptions(unlocked:readonly Heroine[],prepPanel:()=>Promise<boolean>,launch:(type:'after'|'after-mak')=>void){
  if(unlocked.length===1){launch(unlocked[0]==='mak'?'after-mak':'after');return;}
  if(!unlocked.length||!await prepPanel())return;
  const choices=document.createElement('div');choices.className='menu-grid';
  for(const who of unlocked){
    const button=document.createElement('button');button.type='button';button.id='afterstory-'+who;button.textContent=heroines[who].title+'后日谈';
    button.onclick=()=>{panel.close();launch(who==='mak'?'after-mak':'after');};choices.append(button);
  }
  showPanel('选择后日谈',choices);
}
