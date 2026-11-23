import type {SaveCard} from '../save-card.ts';
import type {YoshinoRoute} from './route-policy.ts';
import {heroines} from './route-key.ts';
export function saveChapter(route:YoshinoRoute,card:SaveCard){
  const after=route.afterFor(card.asset);
  if(after)return heroines[after].title+'后日谈';
  if(card.chapter==='prologue')return '序章';
  if(/^\d+-\d+$/u.test(card.chapter))return card.chapter;
  return '剧情'; // An unlabelled original frame is not an invented chapter number.
}
