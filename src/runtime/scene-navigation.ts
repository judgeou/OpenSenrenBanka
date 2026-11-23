import type { ScenarioCatalog } from '../scenario/catalog.ts';
import { sceneFlow } from '../scenario/flow.ts';
import type { RuntimeLocation } from '../scenario/invocation.ts';

/** Validate the original destination before mutating source ownership or cancelling waits. */
export async function loadSceneDestination(catalog: ScenarioCatalog, storage: string, target: string, from?: RuntimeLocation) {
  try {
    const entry=catalog.resolve(storage), document=await catalog.load(entry.id);
    const scene=target?document.scenePosition(target):0;
    if (scene===undefined||!document.index.scenes[scene]) throw new Error('Scene target not found: '+target);
    return {entry,document,scene,flow:sceneFlow(document,scene)};
  } catch(cause) {
    const origin=from ? from.asset+':'+from.scene+':'+from.event+' (source '+from.sourceRef+')' : '原开始';
    throw new Error('原剧本装载失败 '+origin+' → '+storage+' / '+(target||'(入口)')+': '+(cause instanceof Error?cause.message:String(cause)),{cause});
  }
}
