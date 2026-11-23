import type { SceneRestrictions } from '../../src/runtime/scene-restrictions.ts';
import type { PlayerSnapshot } from '../../src/runtime/types.ts';
import type { SystemProgressData } from '../native-session.ts';
import type { AfterstoryStart } from '../native-session-options.ts';
import { truth } from '../../src/script/operators.ts';
import { heroines,mainHeroines,profileKey,loc,routeCleared } from './route-key.ts';
import type { FlagMap,Heroine } from './route-key.ts';
import { jsonRecord } from '../session-assets.ts';

type Keys = Record<string,readonly string[]>;
type Positions = Record<string,Record<string,readonly number[]>>;
interface Graph {keys:Keys;positions:Positions;merged:boolean}
interface ChoiceCarry {readonly at:string;readonly picks:readonly number[]}
function dictionary(input:unknown):FlagMap{return jsonRecord(input) as FlagMap;}
function graph(doc:Record<string,unknown>,merged:boolean):Graph {
  const keys=jsonRecord(doc.keys),positions=jsonRecord(doc.positions);
  const limit=merged?43:31,signature=merged?/^[01]:[0-4]:[-0-9]*$/u:/^[0-4]:[-0-9]*$/u;
  const required=['0001/0','0031/0',...(merged?['0032/0','0042/21','0043/0']:[])];
  if(required.some(key=>!Object.hasOwn(positions,key)))throw Error('专版原路线入口不完整');
  for(const [at,row] of Object.entries(positions)){
    const inputs=keys[at],n=Number(at.split('/')[0]);
    if(!/^\d{4}\/\d+$/u.test(at)||n<1||n>limit||!Array.isArray(inputs)||inputs.some(key=>typeof key!=='string'||!/^\w[\w*]*$/u.test(key)))throw Error('无效的专版原路线位置');
    const byState=Object.entries(jsonRecord(row));
    if(!byState.length||byState.some(([state,picks])=>!signature.test(state)||state.length!==inputs.length+(merged?4:2)||!Array.isArray(picks)||picks.some((n,i)=>!Number.isSafeInteger(n)||n<0||i>0&&picks[i-1]>=n)))throw Error('无效的专版原选项记录');
  }
  return {keys:keys as Keys,positions:positions as Positions,merged};
}
export class YoshinoRoute {
  private constructor(private readonly data:Graph,private readonly prior:Graph|undefined,readonly afters:Readonly<Partial<Record<Heroine,AfterstoryStart>>>){}
  get merged():boolean{return this.data.merged;}
  get after():AfterstoryStart{return this.afters.yos!;}
  static async open(root: URL):Promise<YoshinoRoute>{
    async function load(name:string){
      const reply=await fetch(new URL(name,root));if(!reply.ok)throw Error('专版路线资源 HTTP '+reply.status);
      const text=await reply.text();if(text.length>1024*1024)throw Error('专版路线表超出范围');return jsonRecord(JSON.parse(text));
    }
    const doc=await load('yoshino-route.json'),merged=doc.format==='senren-y01-route-v2';
    if(!merged&&doc.format!=='senren-y01-route-v1')throw Error('专版资源路线版本不兼容');
    const data=graph(doc,merged),afters:Partial<Record<Heroine,AfterstoryStart>>={},resolved=merged?jsonRecord(doc.afters):{yos:doc.after};
    for(const who of merged?mainHeroines:['yos'] as const){
      const after=jsonRecord(resolved[who]),label=heroines[who].afterLabel;
      if(typeof after.storage!=='string'||after.target!==''||after.label!==label)throw Error('原后日谈入口不匹配：'+who);
      afters[who]={storage:after.storage,target:'',label};
    }
    const before=merged?await load('yoshino-route-v1.json'):undefined;
    if(before&&before.format!=='senren-y01-route-v1')throw Error('旧存档路线基线不匹配');
    return new YoshinoRoute(data,before?graph(before,false):undefined,afters);
  }
  afterFor(asset:string):Heroine|undefined{return mainHeroines.find(who=>this.afters[who]&&heroines[who].afterAsset===asset);}
  unlocked(sf:FlagMap):Heroine[]{return mainHeroines.filter(who=>this.afters[who]&&routeCleared(who,sf));}
  private choices(data:Graph,at:string,f:FlagMap,sf:FlagMap):readonly number[]|undefined{
    const table=data.positions[at];return table?.[profileKey(data.keys[at],f,sf,data.merged)];
  }
  restrictions(inAfter:boolean|Heroine|undefined,carry?:ChoiceCarry):SceneRestrictions{
    const who=inAfter===true?'yos':inAfter||undefined;
    const destination=(asset:string,scene:number)=>{
      const at=loc(asset,scene);
      if(this.afterFor(asset)!==who||!Object.hasOwn(this.data.positions,at))throw Error('不可进入当前专版故事范围外的场景');
      if(carry&&carry.at!==at)carry=undefined;
    };
    return {destination,picks:(asset,scene,script)=>{
      destination(asset,scene);const at=loc(asset,scene);
      const row=this.choices(this.data,at,dictionary(script.read('f')),dictionary(script.read('sf')));
      if(!row)throw Error('当前原选择状态无法通向收录路线：'+at);
      return carry?.at===at?carry.picks:row;
    }};
  }
  checkProgress(progress:SystemProgressData):void{
    const allowed=this.merged?mainHeroines:['yos'] as const;
    if(Object.entries(progress.sf).some(([key,value])=>key.startsWith('clear_')&&!allowed.some(who=>heroines[who].clear===key)&&truth(value))||progress.read.some(key=>!this.readInEdition(key)))throw Error('拒绝未收录路线进度或越界已读记录');
  }
  private readInEdition(key:string):boolean{
    const p=key.split('/');return p.length===3&&/^\d+$/u.test(p[2])&&Object.hasOwn(this.data.positions,p[0]+'/'+p[1]);
  }
  checkSave(saved:PlayerSnapshot,realSystem:SystemProgressData):ChoiceCarry|undefined{
    const p=saved.position,globals=saved.script.globals,at=loc(p.asset,p.scene),f=dictionary(globals.f);
    if(!p.entered||p.leaving||p.ended||p.nextIndex!==0||saved.hostWaits.length||saved.mode.skip==='all'||truth(dictionary(globals.tf).allseen))throw Error('越界或不受支持的专版存档');
    const ownSf=dictionary(globals.sf);
    this.checkProgress({sf:ownSf,read:saved.read});
    const picks=this.choices(this.data,at,f,realSystem.sf);
    if(!picks)throw Error('存档脚本状态不属于收录路线');
    let carry:ChoiceCarry|undefined;
    if(saved.wait.kind==='choice'){
      const indices=saved.wait.indices;
      if(!indices.length)throw Error('专版存档没有可用选项');
      if(picks.join()!==indices.join()){
        const original=this.prior&&this.choices(this.prior,at,f,ownSf);
        if(original?.join()!==indices.join()||indices.some(i=>!picks.includes(i)))throw Error('专版存档选项状态不兼容');
        carry={at,picks:indices};
      }
    }else if(saved.wait.kind!=='dialogue'||picks.length||!this.readInEdition(saved.wait.key))throw Error('专版存档正文状态不兼容');
    if(saved.history.some(row=>!Object.hasOwn(this.data.positions,loc(row.location.asset,row.location.scene))))throw Error('专版存档包含越界历史');
    return carry;
  }
}
