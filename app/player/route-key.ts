import { truth } from '../../src/script/operators.ts';
import type { ScriptValue } from '../../src/script/types.ts';
export type FlagMap = Readonly<Record<string, ScriptValue>>;
export const afterAsset = '0031', mainEnd = '0030/3', afterEnd = '0031/21', afterLabel = '*after_yos';
export const heroines={
  yos:{title:'芳乃',afterAsset,afterLabel,afterChoice:1,mainEnd,afterEnd,clear:'clear_yos',watched:'ed1_yosh'},
  mak:{title:'茉子',afterAsset:'0043',afterLabel:'*after_mak',afterChoice:2,mainEnd:'0042/21',afterEnd:'0043/21',clear:'clear_mak',watched:'ed2_mako'},
} as const;
export type Heroine=keyof typeof heroines;
export const mainHeroines=['yos','mak'] as const;
export function routeCleared(who:Heroine,sf:FlagMap):boolean {
  const {clear,watched}=heroines[who];return truth(sf.clear)&&truth(sf[clear])&&truth(sf[watched]);
}
export function profileKey(keys:readonly string[],f:FlagMap,sf:FlagMap,merged:boolean):string {
  const key=routeKey(keys,f,sf);return merged?Number(mainHeroines.some(h=>truth(sf[heroines[h].clear])))+':'+key:key;
}
export const loc = (asset: string, scene: number) => asset + '/' + scene;

export function routeKey(keys: readonly string[], f: FlagMap, sf: FlagMap): string {
  const pref = truth(sf.hselectFix) ? 1 + Number(truth(sf.hselectOUTIN)) + 2 * Number(truth(sf.hselectMOUTHFACE)) : 0;
  return pref + ':' + keys.map(key => {
    const value = f[key];
    if (value === undefined) return '-';
    const digit = typeof value === 'bigint' ? Number(value) : value;
    if (typeof digit !== 'number' || !Number.isInteger(digit) || digit < 0 || digit > 9) throw Error('无效的专版路线状态：' + key);
    return String(digit);
  }).join('');
}

export function chapterName(asset:string,after?:Heroine):string{
  return after?heroines[after].title+'后日谈':'剧情 · 第 '+Number(asset)+' 章';
}
