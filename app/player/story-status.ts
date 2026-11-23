import {chapterName} from './route-key.ts';
import type {YoshinoRoute} from './route-policy.ts';
import type {NativeSession} from '../native-session-types.ts';
import type {StoryLoading} from './story-loading.ts';
export function storyStatus(storyLoading:StoryLoading,pending:boolean,crashed:boolean,view:ReturnType<NativeSession['view']>|undefined,route:YoshinoRoute|undefined,title:boolean){
  const p=view?.position,film=view?.movie;
  return storyLoading.failed?'暂时没能进入故事':storyLoading.waiting||pending?'正在载入…':crashed?'演出已停止，可从标题读档':film?(film.interruptible?'影片重看 · 点击或按空格跳过':'首次观看 · 播放期间不能存档'):
    p?.asset?(view?.paused?'已暂停':chapterName(p.asset,route?.afterFor(p.asset)))+(view?.saveReason?' · '+view.saveReason:''):
      title?'千恋＊万花 · 芳乃篇':'正在打开原标题…';
 }
