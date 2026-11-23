import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import {originalIndex,walkR68} from './r68-original-graph.mjs';
import { sceneFlow } from '../src/scenario/flow.ts';
import { scanOriginalScenes } from './scan-original-scenes.mjs';

// Offline: reads original control, commands, checked state references and dialogue; never evaluates script.
export const sd001 = [[1562, 'sd001aa', 356], [1582, 'sd001ba', 362], [1605, 'sd001bb', 369], [1612, 'sd001cb', 371], [1616, 'sd001dc', 372], [1624, 'sd001ec', 375], [1637, 'sd001ed', 376], [1683, 'sd001fd', 386], [1692, 'sd001gd', 387], [1702, 'sd001hd', 388]];
const routes = [[0, 1, 2, 3, 4, 5, 6, 7, 10], [0, 1, 2, 3, 4, 5, 8, 9, 10]];
const finalEvent = 1745;
export const sd002 = [[2249,'sd002aa'],[2280,'sd002ba'],[2284,'sd002bb'],[2291,'sd002bc'],[2310,'sd002cb'],[2321,'sd002dd'],[2335,'sd002de']];
export const sd003 = [[369,'sd003aa'],[386,'sd003ab'],[391,'sd003ac'],[400,'sd003bd'],[411,'sd003ce'],[439,'sd003cf'],[453,'sd003cg'],[570,'sd003ch']];
const storage2 = '002・祟り神ver1.08.ks', storage3 = '003・巫女の秘密ver1.11.ks';
const keyFor = (id,scene) => id + '/' + scene;
export const sourceHash = value => createHash('sha256').update(value).digest('hex');
export const encodeScope = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $integer: String(item) } : item, 2);
export const r63SourceScope = work => sourceScope(work, 'R63');
export const r64SourceScope = work => sourceScope(work, 'R64');
export const r66SourceScope = work => sourceScope(work, 'R66');
export const r67SourceScope = work => sourceScope(work, 'R67');
export const r68SourceScope = work => sourceScope(work, 'R68');
export const r69SourceScope = work => sourceScope(work, 'R69');
async function sourceScope(work, milestone) {
  const ending=milestone==='R69', extended=milestone!=='R63', later=milestone==='R68'||ending, batch=milestone==='R67'||later, full002=milestone==='R66'||batch;
  const startFile = 'base-script-views/r13-data/00177.utf8.txt', start = await readFile(path.join(work, startFile), 'utf8');
  const matches = [...start.split('; 各アフターシナリオ')[0].matchAll(/^\[ゲーム開始\s+storage="([^"]+)"\s+target="([^"]*)"\]\s*$/gmu)];
  if (matches.length !== 1 || matches[0][1] !== '001・アーサー王ver1.07.ks' || matches[0][2] !== '') throw new Error('Reviewed original normal start changed');
  const initial = { storage: matches[0][1], target: matches[0][2], source: startFile, sha256: sourceHash(start), line: start.slice(0, matches[0].index).split('\n').length };
  const base = path.join(work, 'runtime-data/scenarios-r6-v2'), manifest = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'));
  async function load(storage, expectedId) {
    const rows = manifest.files.filter(row => row.logicalAliases.includes(storage));
    if (rows.length !== 1 || rows[0].id !== expectedId || !/^\d+[.]psb$/u.test(rows[0].binaryFile)) throw new Error('Unexpected original storage: ' + storage);
    const row = rows[0], data = await readFile(path.join(base,row.binaryFile));
    if (sourceHash(data) !== row.sha256) throw new Error('Original SCN digest changed: ' + storage);
    return { id:row.id, storage, sha256:row.sha256, doc:new ScenarioDocument(new Psb2Reader(data)) };
  }
  const first = await load(initial.storage,'0001'), byAsset = new Map([[first.id,first]]);
  const scenes = Array.from({length:extended?12:11},(_,scene)=>({asset:first,scene,limit:scene===10?(extended?3099:finalEvent):Infinity}));
  let successor, after002;
  const continuation=[];
  const index=later?await originalIndex(work):undefined;let graph;
  if (extended) {
    const edge = sceneFlow(first.doc,11).next[0];
    if (edge?.storage !== storage2 || edge.target !== '*com_part_2') throw new Error('Original 001/11 storage edge changed');
    successor = await load(edge.storage,'0002'); byAsset.set(successor.id,successor);
    if (successor.doc.scenePosition(edge.target) !== 0) throw new Error('Original 002 title entry changed');
    scenes.push(...(full002?[0,1,2,3]:[0,1,2]).map(scene=>({asset:successor,scene,limit:scene===2?(full002?2349:12):Infinity})));
    if(full002){
      const next=sceneFlow(successor.doc,3).next[0];
      if(next?.storage!==storage3||next.target!=='*com_part_3')throw new Error('Original 002/3 storage edge changed');
      after002=await load(next.storage,'0003');byAsset.set(after002.id,after002);
      if(after002.doc.scenePosition(next.target)!==0)throw new Error('Original 003 title entry changed');
      if(!batch)scenes.push(...[0,1,2].map(scene=>({asset:after002,scene,limit:scene===2?13:Infinity})));
      else if(index){graph=await walkR68(index,byAsset,after002);scenes.push(...graph.parts);}
      else {
        let asset=after002,scene=0;
        const storageOrder=['004・学院初日ver1.04.ks','005・鍛錬ver1.04.ks','006・レナ登場ver1.03.ks'];
        for(;;){
          const key=keyFor(asset.id,scene), arrived=key==='0006/2';
          if(continuation.length>=32||continuation.includes(key))throw Error('Original batch route loop/length at '+key);
          continuation.push(key);scenes.push({asset,scene,limit:arrived?23:Infinity});
          if(arrived)break;
          const flow=sceneFlow(asset.doc,scene),step=flow.next[0];
          if(flow.choices.length||!step||flow.next.some(n=>n.type!==0||n.condition||n.raw.evalstorage||n.storage!==step.storage||n.target!==step.target))throw Error('Ambiguous 003–006 original next at '+key);
          if(step.storage&&step.storage!==asset.storage){
            const id=String(Number(asset.id)+1).padStart(4,'0');
            if(step.storage!==storageOrder[Number(id)-4])throw Error('Unexpected batch storage edge at '+key+': '+step.storage);
            asset=await load(step.storage,id);byAsset.set(asset.id,asset);
          }
          scene=asset.doc.scenePosition(step.target);
          if(scene===undefined)throw Error('Missing original target '+step.target+' from '+key);
        }
      }
    }
  }
  let main, alternative;
if(ending){
  const {yosRoute}=await import('./r69-original-route.mjs');
  main=await yosRoute(work,index);alternative=await yosRoute(work,index,{alternate:true});
  const parts=new Map(scenes.map(p=>[keyFor(p.asset.id,p.scene),p]));
  for(const part of [...main.parts,...alternative.parts]){
    if(!byAsset.has(part.asset.id))byAsset.set(part.asset.id,part.asset);
    const key=keyFor(part.asset.id,part.scene);const old=parts.get(key);
    if(old){if(key==='0010/10')old.limit=Infinity;continue;}
    parts.set(key,part);scenes.push(part);
  }
}
  const {texts,commands,imageUses,audio,states,shapes,markers,flows,directImages,directAudio,expressions}=scanOriginalScenes(scenes,extended);
  const firstChoice=flows[5], end=texts.at(-1);
  const prefix=route=>[...route.map(scene=>keyFor(first.id,scene)),...(extended?['0001/11','0002/0','0002/1','0002/2']:[]),...(full002?['0002/3']:[])];
  const journeys=graph&&routes.flatMap((route,i)=>graph.paths.map(p=>({route:[...prefix(route),...p.route],choices:{'0001/5':i,...p.selected}})));
  const scopeRoutes=journeys?journeys.map(j=>j.route):routes.map(route=>[...prefix(route),...(full002?(batch?continuation:['0003/0','0003/1','0003/2']):[])]);
  const flowIndex=new Map(flows.map(flow=>[keyFor(flow.asset??first.id,flow.scene),flow]));
  const resolveNext=(from,edge)=>{
    if (edge.type!==0 || edge.raw.evalstorage) return undefined;
    const asset=edge.storage ? (index?byAsset.get(index.aliases.get(edge.storage)):[...byAsset.values()].find(row=>row.storage===edge.storage)) : byAsset.get(from.asset??first.id);
    const scene=asset?.doc.scenePosition(edge.target);
    return scene===undefined ? undefined : keyFor(asset.id,scene);
  };
  for (const [index,route] of scopeRoutes.entries()) {
    for (const [at,from] of route.slice(0,-1).entries()) {
      const flow=flowIndex.get(from), pick=journeys?journeys[index].choices[from]:from==='0001/5'?index:undefined, choice=pick!==undefined, edges=choice?[flow.choices[pick]]:flow.next, edge=edges[0];
      if (!edge || !choice && flow.choices.length || edges.some(item=>!item || !choice && (item.condition||item.expression!==edge.expression) || resolveNext(flow,item)!==route[at+1])) throw new Error('Original route edge changed at '+from+': '+encodeScope(flow.next));
    }
    if (!later&&texts.filter(row=>route.includes(keyFor(row.asset,row.scene))).length!==(batch?[3104,3108]:full002?[1356,1360]:extended?[800,804]:[508,512])[index]) throw new Error('Original route body count changed');
  }
  const chosen = firstChoice.choices.map(row => row.target);
  if (JSON.stringify(chosen) !== JSON.stringify(['*001_01A', '*001_01B']) || firstChoice.choices.some(row => !row.text.trim())) throw new Error('First-choice source rows changed');
  for (const [n, count] of [[2, 107], [6, 5], [8, 9], [10, 396]]) if (texts.filter(row => row.asset === first.id && row.scene === n).length !== (n===10 && extended ? 686 : count)) throw new Error('Original scene body count changed: ' + n);
  for (const [event, file, preceding] of sd001) {
    const use = imageUses.find(row => row.source === 'command' && row.file === file);
    if (use?.location.asset !== first.id || use.location.scene !== 10 || use.location.event !== event || texts.filter(row => row.asset === first.id && row.scene === 10 && row.event < event).at(-1)?.key !== '0001/10/' + preceding) throw new Error('First original action position changed: ' + file);
  }
  const deferred=commands.filter(row=>row.deferred).length;
  const r63End=texts.find(row=>row.key==='0001/10/396');
  if (r63End?.event!==finalEvent || r63End.sourceRef!==736228 || r63End.textRef!==1665221 || !r63End.body.trim()) throw new Error('R63 night boundary changed');
  if (extended) {
    const first2=texts.find(row=>row.key==='0002/2/1');
    const last1=texts.find(row=>row.key==='0001/10/686');
    const second2=texts.find(row=>row.key==='0002/2/2');
    if (!ending&&texts.length!==(later?5497:batch?3113:full002?1365:809) || last1?.event!==3057 || first2?.event!==10 || first2.sourceRef!==14264 || first2.textRef!==715634 ||
        second2?.event!==12 || second2.sourceRef!==14292 || second2.textRef!==715990 || !second2.body.trim()) throw new Error('R64 source boundary changed');
    for (const [event,file] of sd002) {
      const at=imageUses.find(row=>row.source==='command' && row.file===file)?.location;
      if (at?.asset!==first.id || at.scene!==10 || at.event!==event) throw new Error('First SD002 use changed: '+file);
    }
  } else if (texts.length!==517 || commands.length!==783 || deferred!==270) throw new Error('R63 source boundary changed');
  if(full002){
    const last2=texts.find(row=>row.key==='0002/2/556'), first3=texts.find(row=>row.key==='0003/2/1'), second3=texts.find(row=>row.key==='0003/2/2');
    if(last2?.event!==2301||last2.sourceRef!==687807||last2.textRef!==1298757||first3?.event!==7||first3.sourceRef!==19948||first3.textRef!==1589860||second3?.event!==13||second3.sourceRef!==20723||second3.textRef!==1590091||!second3.body.trim())throw new Error('R66 source boundary changed');
    for(const [event,file] of sd003){const at=imageUses.find(row=>row.source==='command'&&row.file===file)?.location;if(at?.asset!=='0002'||at.scene!==2||at.event!==event)throw new Error('First SD003 use changed: '+file);}
  }
  if(batch){
    const first6=texts.find(r=>r.key==='0006/2/1'), film=commands.filter(c=>c.name==='sysmovie'&&(!ending||c.parameters.file==='OP_'));
    if(first6?.event!==11||first6.sourceRef!==13449||first6.textRef!==547401||(!later&&end.key!=='0006/2/2')||!texts.some(r=>r.key==='0006/2/2'&&r.event===23&&r.sourceRef===16959&&r.textRef===548039&&r.body.trim()))throw Error('Original 006 boundary changed');
    if(film.length!==1||film[0].location.asset!=='0003'||film[0].location.scene!==2||film[0].location.event!==4486||film[0].location.sourceRef!==1585543)throw Error('Original movie invocation changed');
  }
  if(later){
    const e=texts.find(r=>r.key==='0010/10/1');
    const second=texts.find(t=>t.key==='0010/10/2');
  if(e?.event!==8||e.sourceRef!==700596||e.textRef!==1866649||second?.event!==11||second.sourceRef!==700890||second.textRef!==1867984||!second.body.trim())throw Error('Original 010 closure changed');
    for(const [loc,flag]of [['0006/5','s006*com_part_6_sel'],['0010/5','s010*com_part_10_sel']]){
      const f=flowIndex.get(loc);if(f.choices.some((c,i)=>c.selectionIndex!==BigInt(i)||c.expression!=='SetBranchFlags("'+flag+'",'+(i+1)+')'))throw Error('Authored selection script changed '+loc);
    }
  }
  const yosTexts=main&&main.route.flatMap(key=>texts.filter(t=>keyFor(t.asset,t.scene)===key));
  const boundary=yosTexts?yosTexts.at(-1):end;
  if(ending&&(yosTexts.length!==17517||boundary.key!=='0030/2/112'||boundary.event!==310||boundary.sourceRef!==24036||boundary.textRef!==79597))throw Error('Original Yoshino endpoint changed '+boundary.key+'/'+yosTexts.length);
  const project=p=>({route:p.route,choices:p.choices,choiceRows:p.choiceRows,gates:p.gates,edges:p.edgeRows,terminal:p.terminal});
  return {format:'senren-'+milestone.toLowerCase()+'-source-scope-v1',milestone,
    label:ending?'原开局至芳乃本篇结局 · R69':later?'原开局、006–009 与 010 首次原汇流 · R68':batch?'原开始、003–005 与原片头至 006 · R67':full002?'原开始至 003 第一句／第二句 · R66':extended?'原开始至 002 次日房间 · R64':'原开始、首次选择与完整 SD001 断刀演出 · R63',initial,sha256:first.sha256,
    ...(extended && {assets:[...byAsset.values()].map(({id,storage,sha256})=>({id,storage,sha256})),expressions}),
    counts:{texts:texts.length,commands:commands.length,deferred,checkpointsAndTextStates:states.size,directImages:directImages.size,directAudio:directAudio.size},
    firstChoice,...(ending&&{yos:project(main),alternate:project(alternative)}),...(journeys&&{journeys}),routes:extended?scopeRoutes:routes,end:{ key:boundary.key,...(extended && {asset:boundary.asset}),scene:boundary.scene,event:boundary.event,sourceRef:boundary.sourceRef,textRef:boundary.textRef },flows,texts,commands,imageUses,audio:[...audio.values()],states:[...states.values()],shapes:[...shapes.values()],markers};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , work, target, milestone, ...extra] = process.argv;
  if (!work || !target || extra.length || milestone && !['R64','R66','R67','R68','R69'].includes(milestone)) throw new Error('Expected prepared work and new private cases.json [R64|R66|R67|R68]');
  const scope = await (milestone==='R69'?r69SourceScope:milestone==='R68'?r68SourceScope:milestone==='R67'?r67SourceScope:milestone==='R66'?r66SourceScope:milestone==='R64'?r64SourceScope:r63SourceScope)(path.resolve(work));
  await writeFile(process.argv[3], encodeScope(scope), { flag: 'wx' });
  console.log(JSON.stringify({ counts: scope.counts, end: scope.end, images: [...new Set(scope.imageUses.map(row => row.file))] }));
}
