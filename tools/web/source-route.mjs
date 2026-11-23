import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { originalIndex } from '../r68-original-graph.mjs';
import { sceneFlow } from '../../src/scenario/flow.ts';
import { invocation } from '../../src/scenario/invocation.ts';
import { ScriptState } from '../../src/script/state.ts';
import { ScriptEngine } from '../../src/script/expression.ts';
import { truth } from '../../src/script/operators.ts';
import { BranchBindings } from '../../src/world/branch-flags.ts';
import { afterAsset, mainEnd, afterEnd, loc, profileKey, afterLabel, heroines, mainHeroines } from '../../app/player/route-key.ts';
const ints = (_k,v) => v && typeof v === 'object' && '$integer' in v ? BigInt(v.$integer) : v;
const single = id => /^00(?:0[1-9]|[12][0-9]|3[01])$/u.test(id);
const scoring = /^(?:!)?CheckBranchFlags\("(?:(\w+) (?:==|!=) [0-9](?: && \.checkAnyClear)?|\.(?:checkIN|checkOUT|checkMOUTH|checkFACE))"\)$/u;
const effect = /^SetBranchFlags\("[A-Za-z0-9_*]+",[1-9]\)$/u;

async function originalEntries(work,index,merged,from) {
  const get = name => readFile(path.join(work,'base-script-views/r13-data',name+'.utf8.txt'),'utf8');
  const [start,menu] = await Promise.all(from ? [readFile(from.start,'utf8'),from.menu?readFile(from.menu,'utf8'):undefined] : [get('00177'),get('01087')]);
  const entries=new Map();let entry;
  const heads=[...start.matchAll(/^(?:(\*after_[a-z]+)[|]\r?\n\s*)?\[ゲーム開始\s+storage="([^"]+)"\s+target="([^"]*)"\]/gmu)];
  for(const [,label,storage,target] of heads){if(!label){if(entry)throw Error('原主入口歧义');entry={storage,target};}else{if(entries.has(label))throw Error('原后日谈标签歧义：'+label);entries.set(label,{label,storage,target});}}
  if(!entry||index.aliases.get(entry.storage)!=='0001'||entry.target)throw Error('原主入口不匹配');
  const profiles=merged?mainHeroines:['yos'];
  const afters=Object.fromEntries(profiles.map(who=>{
    const h=heroines[who],opening=entries.get(h.afterLabel);
    if(!opening||index.aliases.get(opening.storage)!==h.afterAsset||opening.target||!start.includes('@next target='+h.afterLabel+' eval="tf.afterstory=='+h.afterChoice+'"'))throw Error('原后日谈入口不匹配：'+who);
    if(menu!==undefined&&(!menu.includes('exp,tf.afterstory='+h.afterChoice)||!menu.includes('if(!(.tf.allseen||.sf.'+h.clear+'))')))throw Error('原标题后日谈按钮不匹配：'+who);
    return [who,opening];
  }));
  return {entry,after:afters.yos,afters,profiles};
}

// Evaluate only authored control; the real browser still executes original SCN choices and effects.
export async function solveRoute(work,{merged=false,archive}={}) {
  const index = await originalIndex(work,archive?.scenarios), {entry,after,afters,profiles}=await originalEntries(work,index,merged,archive);
  const isRoute=id=>single(id)||merged&&/^00(?:3[2-9]|4[0-3])$/u.test(id);
  const afterFor=id=>profiles.find(who=>heroines[who].afterAsset===id);
  const raw = JSON.parse(await readFile(archive?.branches??path.join(work,'definitions/r11/branch-rules.json'),'utf8'),ints);
  const rules = {keys:raw.keys,flags:new Map(raw.flags.map(({key,rules})=>[key,rules]))};
  const scores = new Set(), checks = new Set(), graph = new Map(), assets = new Map();
  function condition(c,keys) {
    if (!c) return;
    checks.add(c);
    if (c === 'f.sel_flag == 1') {keys.add('sel_flag'); return;}
    const m = scoring.exec(c); if (!m) throw Error('未归类原路线条件：'+c);
    if (m[1]) {
      const rows = rules.flags.get(m[1]); if (!rows?.length) throw Error('缺少原计分规则：'+m[1]);
      scores.add(m[1]); for (const row of rows) keys.add(row.selection);
    }
  }
  for (const id of index.files.keys()) {
    if (!isRoute(id)) continue;
    const asset = await index.asset(id); assets.set(id,asset);
    for (const [scene,s] of asset.doc.index.scenes.entries()) {
      const at = loc(id,scene), f = sceneFlow(asset.doc,scene);
      if ([...f.before,...f.after].some(x=>x.kind==='set'?x.path!=='f.currentChartPos':!/^f\.sel_flag = [01]$/u.test(x.source))) throw Error('未归类原场景赋值：'+at);
      const keys=new Set();
      for (const e of [...f.choices,...f.next]) {
        condition(e.condition,keys);
        if (e.raw.evalstorage || e.expression && !effect.test(e.expression)) throw Error('未归类原路线边效果：'+at);
        if (e.type===0&&e.storage&&!index.aliases.has(e.storage)) throw Error('缺少原路线目标：'+at+' → '+e.storage);
      }
      graph.set(at,{asset,scene,flow:f,keys,count:s.events.length});
    }
  }
  // Propagate input dependencies backwards. Flags no longer read in a suffix
  // do not split equivalent states; the real player still preserves all f/sf flags.
  for(let changed=true;changed;){
    changed=false;
    for(const r of [...graph.values()].reverse())for(const e of [...r.flow.choices,...r.flow.next]){
      const id=e.storage?index.aliases.get(e.storage):r.asset.id;
      if(e.type!==0||!isRoute(id))continue;
      const n=e.target?assets.get(id).doc.scenePosition(e.target):0;
      const dest=graph.get(loc(id,n));if(!dest)throw Error('原标签未解析：'+id+' '+e.target);
      const overwrite=/^SetBranchFlags\("([A-Za-z0-9_*]+)",/.exec(e.expression)?.[1];
      for(const key of dest.keys)if(key!==overwrite&&!r.keys.has(key)){r.keys.add(key);changed=true;}
    }
  }
  const script=new ScriptState(), engine=new ScriptEngine(script);
  const pref=(key,yes)=>{const sf=script.read('sf');return !truth(sf.hselectFix)||truth(sf[key])===yes;};
  new BranchBindings(script,engine,rules,{checkAnyClear:()=>profiles.some(who=>truth(script.read('sf')[heroines[who].clear])),
    checkIN:()=>pref('hselectOUTIN',false),checkOUT:()=>pref('hselectOUTIN',true),
    checkMOUTH:()=>pref('hselectMOUTHFACE',true),checkFACE:()=>pref('hselectMOUTHFACE',false)}).install();
  const evals=ops=>{for(const x of ops){if(x.kind==='set')script.write(x.path,x.value);else engine.execute(x.source);}};
  const check=e=>!e.condition||truth(engine.execute(e.condition));
  const memo=new Map(),active=new Set(),viable=new Map(),blocked=new Set(),terminals=new Set(),cases=Object.create(null),trail=[],witnesses=Object.create(null);
  const projections=Object.fromEntries([...graph].map(([at,r])=>[at,[...r.keys].sort()]));
  function edge(row,e,inAfter) {
    if(e.expression)engine.execute(e.expression);
    if(e.type===1){
      const at=loc(row.asset.id,row.scene);
      if(e.storage==='start.ks'){
        if(profiles.some(who=>at===heroines[who].mainEnd&&!inAfter&&e.target==='*gameend_title'||at===heroines[who].afterEnd&&who===inAfter&&e.target==='*gameend_after')){terminals.add(at);witnesses[at]??=[...trail];return true;}
        if(at==='0015/9'&&!inAfter&&e.target==='*gameend_title'){blocked.add(at+':normal');return false;}
      }
      throw Error('未归类原终点：'+at+' → '+e.target);
    }
    if(e.type!==0)throw Error('未归类原边类型：'+e.type);
    const id=e.storage?index.aliases.get(e.storage):row.asset.id;
    if(!isRoute(id)){blocked.add(id+':'+e.target);return false;}
    if(inAfter!==afterFor(id))throw Error('原本篇/后日谈之间有意外跳转');
    const doc=assets.get(id).doc,scene=e.target?doc.scenePosition(e.target):0;
    if(scene===undefined)throw Error('原场景标签缺失：'+id+'/'+e.target);
    return visit(loc(id,scene),inAfter);
  }
  function visit(at,inAfter) {
    const row=graph.get(at); if(!row)throw Error('原场景缺失：'+at);
    const {flow}=row; evals(flow.before);
    const sf=script.read('sf'),key=profileKey(projections[at],script.read('f'),sf,merged),token=at+'/'+key+'/'+Number(profiles.some(who=>truth(sf[heroines[who].clear])));
    if(memo.has(token))return memo.get(token);
    if(active.has(token))throw Error('控制图有环：'+at);
    if(memo.size>(merged?400000:100000))throw Error('控制图超出状态预算：'+at);
    active.add(token);
    let ok;const permitted=[];
    if(flow.choices.length){
      const matches=flow.choices.filter(check);
      if(!matches.length||matches.some(e=>e.type!==0))throw Error('原选择无合法选项或边类型变更：'+at);
      const snap=script.snapshot(),eligible=matches.map(e=>e.index);
      for(const e of matches){script.restore(snap,false);trail.push({at,index:e.index,text:e.text,storage:e.storage,target:e.target});try{if(edge(row,e,inAfter))permitted.push(e.index);}finally{trail.pop();}}
      ok=permitted.length>0;
      const record=cases[at]??=Object.create(null),old=record[key];
      if(old&&(old.permitted.join()!==permitted.join()||old.eligible.join()!==eligible.join()))throw Error('路线投影漏掉原条件：'+at+' '+key);
      record[key]={eligible,permitted};
    }else{
      evals(flow.after);const next=flow.next.find(check);
      if(!next)throw Error('没有原后续：'+at);
      ok=edge(row,next,inAfter);
    }
    if(ok){if(!viable.has(at))viable.set(at,new Map());viable.get(at).set(key,permitted);}
    active.delete(token);memo.set(token,ok);return ok;
  }
  for(let n=0;n<5;n++)for(const cleared of [false,true]){
    const sf={clear_yos:cleared,hselectFix:n!==0,hselectOUTIN:!!((n-1)&1),hselectMOUTHFACE:!!((n-1)&2)};
    for(const who of (cleared?[undefined,...profiles]:[undefined])){
      script.restore(new ScriptState().snapshot(),false);script.write('sf',who?{...sf,[heroines[who].clear]:true}:sf);
      if(!visit(who?loc(heroines[who].afterAsset,0):'0001/0',who))throw Error('专版原入口不连通');
    }
  }
  const parts=[...viable.keys()].sort((a,b)=>a.localeCompare(b,'en',{numeric:true})).map(at=>graph.get(at));
  for(const {asset,scene} of parts)for(const e of asset.doc.index.scenes[scene].events){
    if(e.kind!=='command')continue;
    const c=invocation(asset.doc,e,{asset:asset.id,scene,event:e.sourceIndex,sourceRef:e.sourceRef});
    if(/^(?:eval|emb|jump|call|goto|next|set|scenestart|sceneplay)$/iu.test(c.name))throw Error('原命令新增控制写入：'+loc(asset.id,scene)+'/'+e.sourceIndex+' '+c.name);
  }
  const positions=Object.fromEntries([...viable].sort().map(([at,rows])=>[at,Object.fromEntries([...rows].sort())]));
  const audit={exploredStates:memo.size,viableStates:Object.values(positions).reduce((n,r)=>n+Object.keys(r).length,0),
    viableScenes:parts.length,choiceScenes:Object.keys(cases).length,choices:cases,conditions:[...checks].sort(),scoreKeys:[...scores].sort(),
    otherTerminals:[...blocked].sort(),preferenceProfiles:5,originalMenuGate:'tf.allseen || sf.clear_yos',
    titlePolicy:'Actual Yoshino clear only; no allseen/other-clear overrides',mainEnd,afterEnd};
  if(profiles.some(who=>!terminals.has(heroines[who].mainEnd)||!terminals.has(heroines[who].afterEnd)))throw Error('未达到配置的原终点');
  const keys=Object.fromEntries(Object.keys(positions).map(at=>[at,projections[at]]));
  return {entry,after,afters,parts,policy:{format:merged?'senren-y01-route-v2':'senren-y01-route-v1',keys,positions,...(merged?{afters}:{after})},audit:{...audit,terminals:[...terminals].sort(),witnesses}};
}
