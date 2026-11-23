import type {YoshinoRoute} from './route-policy.ts';
import type {NativeSessionOptions} from '../native-session-options.ts';
import type {SystemProgressData} from '../native-session-types.ts';
import type {Settings} from './settings.ts';
import {windowAlpha} from './settings.ts';
import {promoteDownloadedAsset} from './resource-cache/client.ts';
export async function openEditionStory(root:URL,surface:{canvas:HTMLCanvasElement;overlay:HTMLElement},context:AudioContext,initial:SystemProgressData,
    route:YoshinoRoute,settings:Settings,systemFontFamily:string,after:ReturnType<YoshinoRoute['afterFor']>,retain:Parameters<YoshinoRoute['restrictions']>[1],
    identity:string|undefined,options:NativeSessionOptions){
  const {openNativeSession}=await import('../native-session.ts');
  return openNativeSession(root,surface.canvas,surface.overlay,context,initial,identity,{
    restrictions:route.restrictions(after,retain),afterstory:after?route.afters[after]:undefined,
    renderNamespace:'yoshino-v1',systemFontFamily,mix:settings.mix,speeds:{characterDelay:settings.characterDelay,autoDelay:settings.autoDelay},
    streamingAudio:true,prefetchBytes:settings.prefetchMB*1024*1024,promotePrefetch:promoteDownloadedAsset,
    pcDialogue:{windowOpacity:()=>windowAlpha(settings)},sceneHistory:true,...options,
  });
}
