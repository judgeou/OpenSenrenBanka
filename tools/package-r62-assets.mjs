import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { packageIo, basename, packageOriginalFonts } from './package-ui-support.mjs';
import { packageR63FontLink } from './r63-font-link.mjs';
const leaf = value => value.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
const stem = value => leaf(value).replace(/[.][^.]+$/u, '');
// Offline metadata/copy only. No player, expressions, Canvas, audio, IndexedDB, shaders, server or tests.
export async function packageR62Assets(work, output, selectedScope, {planOnly=false, editionAssets} = {}) {
  const resources = path.join(output, 'resources'); if (!planOnly) await mkdir(resources); const io = await packageIo(work, resources, {planOnly});
  const generated = [], writeJson = io.writeJson;
  if (['R63','R64','R66','R67','R68','R69'].includes(selectedScope?.milestone)) io.writeJson = async (file, value) => {
    const bytes = Buffer.from(JSON.stringify(value)); await io.write(file, bytes); generated.push({ file, bytes: bytes.length, sha256: io.hash(bytes) });
  };
  const scope = selectedScope ?? await io.json('r62-scope-v1/scope.json'); if (scope.initial?.storage !== '001・アーサー王ver1.07.ks' || (scope.milestone === 'R62-M1' ? scope.counts.texts !== 46 || scope.counts.commands !== 16 : scope.firstChoice?.choices?.length !== 2)) throw new Error('R62 source range has changed; review the full legal range first');
  const edition=scope.edition, r69=scope.milestone==='R69', r68=scope.milestone==='R68'||r69, r67=scope.milestone==='R67'||r68, r66=scope.milestone==='R66'||r67, r64=scope.milestone==='R64'||r66, r63=['R63','R64','R66','R67','R68','R69'].includes(scope.milestone), nativeClosure = r63 ? await import('./r63-asset-closure.mjs') : undefined;
  const wantedTexts = new Set(['config.tjs', 'default.tjs', 'custom.ks', 'macro.ks', 'start.ks', 'envinit.tjs', 'soundlist.csv', 'soundgain.csv', 'filegain.csv']);
  if(r64) wantedTexts.add('sysse.ini');
  const resolved = new Map();
  for (const folder of ['base-script-views/r13-data', 'base-script-views/r13-patch']) { const manifest = await io.json(folder + '/manifest.json');
    for (const row of manifest.views) if (wantedTexts.has(leaf(row.name))) resolved.set(leaf(row.name), { name: row.name, source: folder + '/' + row.view, provenance: row }); }
  const active = await io.json('script-inspection/r6/script-manifest.json');
  for (const row of active.views) if (wantedTexts.has(leaf(row.entry))) resolved.set(leaf(row.entry), { name: row.entry, source: 'script-inspection/r6/' + row.view, provenance: row });
  for (const name of wantedTexts) if (!resolved.has(name)) throw new Error('Missing active original text: ' + name);
  const pimgBase = 'runtime-data/graphics-r9/pimg', rasterBase = 'runtime-data/graphics-r9/pimg-images';
  const models = await io.json(pimgBase + '/pimg-models.json'), rasters = await io.json(rasterBase + '/manifest.json');
  const closure = nativeClosure && await nativeClosure.r63GraphicsClosure(io, scope, await io.json('runtime-data/graphics-r20/images/manifest-v2.json'), models, (await io.bytes(resolved.get('envinit.tjs').source)).toString('utf8'));
  const originalImages = new Set((scope.images ?? []).filter(row => !row.value.endsWith('.stand')).map(row => row.value.toLowerCase()));
  const regularFile = 'runtime-data/graphics-r20/images/manifest-v2.json', regular = await io.json(regularFile), masks = await io.json('native-mask-bindings-r18-v2.json');
  const maskIds = new Set(masks.entries.map(row => row.imageId));
  const uiImages = new Set(['select_normal.png', 'select_on.png', 'bgmtitle@base%base.png', 'bgmtitle@black%layer.png']);
  const selected = regular.entries.filter(row => maskIds.has(row.id) || uiImages.has(leaf(row.name)) || (closure ? closure.images.has(row.id) : originalImages.has(stem(row.name)) || scope.images.some(image => image.value === '芦花.stand') && [row.name, ...(row.aliases ?? [])].some(name => /芦花/iu.test(name))));
  const regularBase = path.posix.normalize(path.posix.join(path.posix.dirname(regularFile), regular.assetBaseUrl ?? '.'));
  for (const row of selected) {
    const file = basename(row.file, /^[0-9]+[.](png|jpg|jpeg|bmp)$/u), copied = await io.copy(regularBase + '/' + file, 'images/' + file);
    if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes) throw new Error('Prepared image identity changed: ' + row.name);
  }
  for (const name of uiImages) if (selected.filter(row => leaf(row.name) === name).length !== 1) throw new Error('Missing/ambiguous original UI pixels: ' + name);
  for (const mask of masks.entries) if (!selected.some(row => row.id === mask.imageId && row.sha256 === mask.sha256)) throw new Error('Original 1080 mask binding changed: ' + mask.name);
  await io.writeJson('images/manifest.json', { ...regular, assetBaseUrl: '.', entries: selected, failed: 0, converted: selected.filter(row => row.state === 'converted').length, copied: selected.filter(row => row.state === 'copied').length });
  const selectedModels = models.models.filter(row => (closure ? closure.models.has(row.name) : originalImages.has(stem(row.name))) || ['window.pimg', 'chapter.pimg'].includes(leaf(row.name)));
  for (const image of originalImages) if (!selected.some(row => stem(row.name) === image) && !selectedModels.some(row => stem(row.name) === image)) throw new Error('Required original image family is not covered: ' + image);
  const rasterIds = new Set(selectedModels.flatMap(row => row.resources.map(resource => resource.imageId))), rasterRows = rasters.entries.filter(row => rasterIds.has(row.id));
  if (rasterRows.length !== rasterIds.size) throw new Error('PIMG source layers incomplete');
  for (const row of rasterRows) { const file = basename(row.file, /^[0-9]+[.]png$/u), copied = await io.copy(rasterBase + '/' + file, 'pimg-images/' + file); if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes) throw new Error('PIMG layer identity changed'); }
  for (const row of selectedModels) { const file = basename(row.metadataFile, /^[0-9]+[.]psbmeta$/u), copied = await io.copy(pimgBase + '/' + file, 'pimg/' + file); if (copied.sha256 !== row.metadataSha256 || copied.bytes !== row.metadataBytes) throw new Error('PIMG metadata identity changed'); }
  await io.writeJson('pimg/models.json', { ...models, models: selectedModels }); await io.writeJson('pimg-images/manifest.json', { ...rasters, assetBaseUrl: '.', entries: rasterRows, failed: 0 });
  const sounds = r64 ? (await import('./r64-sound-closure.mjs')).r64SoundClosure(scope,(await io.bytes(resolved.get('sysse.ini').source)).toString('utf8')) : undefined;
  if(sounds) await io.writeJson('system-voice.json',{format:'native-eyecatch-voices-v1',tags:sounds.clips});
  const audioBase='runtime-data/audio-r11-v3', audio=await io.json(audioBase+'/manifest.json');
  const requested=new Map([...scope.audio.filter(row=>!sounds||!row.value.startsWith('&')),...(sounds?.uses??[])].map(row=>[stem(row.value),row]));
  const r69VoiceBase='r69-original-voices', supplement=r69?await io.json(r69VoiceBase+'/manifest.json'):undefined;
  if(supplement&&(supplement.format!=='senren-r69-original-voices-v1'||supplement.files.length!==3))throw Error('Original route voice supplement changed');
  const extraVoices=supplement?.files??[];
  const priorAudioRows=[...audio.files,...extraVoices].filter(row=>requested.has(stem(row.name)));
  const cueAudio=r69?audio.files.filter(row=>row.name==='SD101.ogg'):[];
  if(r69&&(cueAudio.length!==1||cueAudio[0].sha256!=='c88305c23c696455bd3e00a78685f538f853123e8e6356e34fcc434a7b7c24ad'||!edition&&priorAudioRows.includes(cueAudio[0])))throw Error('Original SD101 motion sound identity changed');
  const audioRows=[...new Set([...priorAudioRows,...cueAudio])];
  const missing=[...requested].filter(([wanted])=>audioRows.filter(row=>stem(row.name)===wanted).length!==1);
  if(missing.length)throw Error('原声音缺失或歧义：'+missing.map(([name,row])=>name+' @ '+JSON.stringify(row.location)).join(', '));
  for (const row of audioRows) {
    const file = basename(row.file, /^[0-9]+[.](ogg|opus)$/u), copied = await io.copy((extraVoices.includes(row)?r69VoiceBase:audioBase) + '/' + file, 'audio/' + file);
    if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes) throw new Error('Original compressed sound changed');
    if(row.nonLoopSidecar){
      const side=row.nonLoopSidecar;
      if (!edition && !(r69&&row.name==='yos112_110.ogg'&&extraVoices.some(v=>v.name==='yas104_038.ogg'&&v.sha256===side.sha256)))throw Error('A newly mandatory nonLoopSidecar needs explicit packaging review');
      if(edition&&!io.inventory.some(x=>x.file==='audio/'+side.file)&&!audioRows.some(x=>x.file===side.file&&x.sha256===side.sha256)){
        const file=basename(side.file,/^[0-9]+[.]sidecar[.](ogg|opus)$/u);
        const result=await io.copy((extraVoices.some(v=>v.file===side.file&&v.sha256===side.sha256)?r69VoiceBase:audioBase)+'/'+file,'audio/'+file);
        if(result.bytes!==side.bytes||result.sha256!==side.sha256)throw Error('Original non-loop audio changed: '+row.name);
      }
    }
  }
  const audioManifest=files=>({...audio,entries:files.length,files,sourceWarnings:audio.sourceWarnings.filter(row=>files.some(asset=>asset.name===row.name)),failed:0});
  await io.writeJson('audio/manifest.json',audioManifest(audioRows));
  const scenesBase = 'runtime-data/scenarios-r6-v2', scenes = await io.json(scenesBase + '/manifest.json');
  if (scenes.files.length !== 92 || scenes.unpreparedEntries !== 0) throw new Error('Do not truncate original SCN/control flow');
  const scenarioRows=edition?scenes.files.filter(row=>scope.scenarioIds.includes(row.id)):scenes.files;
  if(edition&&scenarioRows.length!==scope.scenarioIds.length)throw Error('专版原场景清单不全');
  for (const row of scenarioRows) { const file = basename(row.binaryFile, /^[0-9]+[.]psb$/u), copied = await io.copy(scenesBase + '/' + file, 'scenarios/' + file); if (copied.sha256 !== row.sha256 || copied.bytes !== row.bytes) throw new Error('SCN source changed'); await io.copy(scenesBase + '/' + basename(row.indexFile, /^[0-9]+[.]scene[.]json$/u), 'scenarios/' + row.indexFile); }
  if(edition)await io.writeJson('scenarios/manifest.json',{...scenes,files:scenarioRows,totalEntries:scenarioRows.length,preparedEntries:scenarioRows.length});
  else await io.copy(scenesBase + '/manifest.json', 'scenarios/manifest.json');
  const metadata = [ ['image-definitions-r13-v4.json', 'image-definitions.json'], ['foreground-packs-r13-v2.json', 'foreground-packs.json'], ['environment-geometry-r16.json', 'environment.json'], ['classlist-r12-native.json', 'classes.json'], ['definitions/r11/branch-rules.json', 'branches.json'], ['native-mask-bindings-r18-v2.json', 'native-masks.json'], ['native-ui-r24-v2/bgmtitle-sources.json', 'native-ui-r24-v2/bgmtitle-sources.json'] ];
  for (const [source, target] of metadata) await io.copy(source, target);
  const views = []; let next = 90000;
  for (const [name, row] of resolved) { const view = String(++next) + '.utf8.txt', copied = await io.copy(row.source, 'base-script-views/r13-patch/' + view); views.push({ name, view, source: row.source, provenance: row.provenance, decodedSha256: copied.sha256, bytes: copied.bytes }); if (name === 'envinit.tjs') await io.copy(row.source, 'envinit.tjs'); }
  await io.writeJson('base-script-views/r13-patch/manifest.json', { schemaVersion: 1, views }); await io.writeJson('base-script-views/r13-data/manifest.json', { schemaVersion: 1, views: [] });
  if (!edition) await packageOriginalFonts(io, r63 ? await packageR63FontLink(io, scope) : undefined);
  const tablesBase = 'runtime-data/extended-r19', tables = await io.json(tablesBase + '/tables.json'), tableFiles = new Set();
  const collect = value => { if (!value || typeof value !== 'object') return; if (typeof value.url === 'string' && !/^[a-z]+:/iu.test(value.url)) tableFiles.add(basename(value.url, /^[a-z0-9.-]+$/u)); for (const child of Object.values(value)) collect(child); }; collect(tables);
  for (const file of tableFiles) await io.copy(tablesBase + '/' + file, 'tables/' + file); await io.copy(tablesBase + '/tables.json', 'tables/tables.json');
  const descriptor = { schemaVersion: 1, format: 'senren-web-graphics-v1', language: 'zh-Hans', resourceProfile: '1080', nativeVirtualSurface: { width: 1920, height: 1080, primaryType: 'opaque' },
    regularImages: { url: 'images/manifest.json' }, pimgImages: { url: 'pimg-images/manifest.json' }, pimgModels: { url: 'pimg/models.json' }, imageDefinitions: { url: 'image-definitions.json' }, foregroundPacks: { url: 'foreground-packs.json' }, environmentGeometry: { url: 'environment.json' }, nativeMasks: { url: 'native-masks.json' }, nativeExtendedTables: { url: 'tables/tables.json' } };
  const multiManifest = await io.json('base-resources/r7-data/manifest.json'), multi = multiManifest.entries.find(row => row.name === 'main/imagemulti.txt');
  if (!multi || multi.state !== 'exported' || !/^[0-9]+[.]bin$/u.test(multi.file)) throw new Error('Original imagemulti is missing');
  const copiedMulti = await io.copy('base-resources/r7-data/' + multi.file, 'image-multi.bin'); if (copiedMulti.sha256 !== multi.sha256) throw new Error('Original imagemulti changed');
  const motion = closure ? await nativeClosure.packageR63Motion(io, closure.animation) : undefined;
  if (motion) { descriptor.mtnImages = { url: 'mtn/images.json' }; descriptor.mtnModels = { url: 'mtn/models.json' }; }
  descriptor.imageMultiResolution = { url: 'image-multi.bin' };
  await io.writeJson('graphics.json', descriptor);
  if(r67){
    const op=await io.json('r67-original-op/op.json');
    const [call]=scope.commands.filter(row=>row.name==='sysmovie'&&row.parameters.file==='OP_');
    if(op.format!=='senren-r67-op-v1'||op.file!=='OP_1080.mp4'||op.preparation!=='verbatim original MP4'||call.parameters.file!=='OP_')throw Error('Original OP closure mismatch');
    const bytes=await io.copy('r67-original-op/'+op.file,'movies/'+op.file);
    if(bytes.sha256!==op.sha256||bytes.bytes!==op.bytes)throw Error('Original OP source changed');
    await io.writeJson('movies/op.json',{...op,command:call.parameters,location:call.location});
  }
  if(r69){
    const ed=await io.json('r69-original-ed/ed.json'), calls=scope.commands.filter(r=>r.name==='sysmovie'&&r.parameters.file==='ED1_Yosh');
    if(calls.length!==1||ed.format!=='senren-r69-ed-v1'||ed.file!=='ED1_Yosh1080.mp4'||ed.preparation!=='verbatim original MP4')throw Error('Original Yoshino ED closure differs');
    const bytes=await io.copy('r69-original-ed/'+ed.file,'movies/'+ed.file);
    if(bytes.sha256!==ed.sha256||bytes.bytes!==ed.bytes)throw Error('Original ED payload differs');
    await io.writeJson('movies/ed-yoshino.json',{...ed,command:calls[0].parameters,location:calls[0].location});
  }
  const priorDatasets={ graphics: 'graphics.json', scenarios: 'scenarios/manifest.json', classes: 'classes.json', branches: 'branches.json', audio: 'audio/manifest.json', envinit: 'envinit.tjs', ...(r67&&{movie:'movies/op.json'}), ...(sounds && {systemVoice:'system-voice.json'}) };
  const datasets={...priorDatasets,...(r69&&{ending:'movies/ed-yoshino.json'})};
  if(edition){if(!editionAssets)throw Error('缺少专版资源策略');await editionAssets(io);}
  const assets=[...io.inventory,...generated].map(({file,sha256,bytes})=>({file,sha256,bytes})).sort((a,b)=>a.file.localeCompare(b.file));
  const identify=(datasets,assets)=>io.hash(Buffer.from(JSON.stringify({entry:scope.initial,descriptor,datasets,...(r66&&{motionActionProfile:'r66-motion-se-v1'}),assets})));
  const identity=identify(datasets,assets);
  let previousResourceIdentity;
  if(r69&&!edition){
    const legacyAudio=Buffer.from(JSON.stringify(audioManifest(priorAudioRows)));
    const prior=assets.filter(x=>x.file!=='audio/'+cueAudio[0].file).map(x=>x.file==='audio/manifest.json'?{file:x.file,sha256:io.hash(legacyAudio),bytes:legacyAudio.length}:x);
    previousResourceIdentity=identify(priorDatasets,prior);
    if(prior.length+1!==assets.length||previousResourceIdentity!=='b7cb3a3fa802121966d47465360565877afadd77789a59f2f8ab0ebd909fdc35')throw Error('R69 append-only previous resource contract differs');
  }
  await io.writeJson('session.json', { format: 'senren-native-session-v1', language: 'zh-Hans', width: 1920, height: 1080, coordinateBasis: '1280x720', resourceProfile: '1080', identity, ...(edition&&{edition}), ...(previousResourceIdentity&&{previousResourceIdentity}), ...(r66&&{motionActionProfile:'r66-motion-se-v1'}), label: scope.label ?? '原开始至首次真实选择及两条合法后继 · R62', entry: { storage: scope.initial.storage, target: scope.initial.target }, datasets });
  const inventory = { format: edition ? 'senren-y01-resource-inventory-v1' : r69 ? 'senren-r69-resource-inventory-v1' : r68 ? 'senren-r68-resource-inventory-v1' : r67 ? 'senren-r67-resource-inventory-v1' : r66 ? 'senren-r66-resource-inventory-v1' : r64 ? 'senren-r64-resource-inventory-v1' : r63 ? 'senren-r63-resource-inventory-v1' : 'senren-r62-resource-inventory-v1', ...(sounds && {indirectAudio:sounds.uses}), identity, ...(previousResourceIdentity&&{previousResourceIdentity}), kind: 'offline-preparation-not-runtime-proof', scenarioFiles: scenarioRows.length, regularImages: selected.length, pimgModels: selectedModels.length, pimgImages: rasterRows.length, audioFiles: audioRows.length, startup: scope.initial, scope: { counts: scope.counts, firstChoice: scope.firstChoice, ...(r63 && { end: scope.end, originalScenarioSha256: scope.sha256, routes: scope.routes, shapes: scope.shapes }) }, ...(closure && { dependencies: { stands: closure.stands, images: closure.aliases, motion, audio: audioRows.map(row => ({ name: row.name, file: row.file, labels: row.labels?.length, loop: row.loop ?? row.loopLink })) } }), files: io.inventory.length, bytes: io.inventory.reduce((sum, row) => sum + row.bytes, 0), assets: io.inventory, ...(r63 && { generated }) };
  await writeJson('inventory.json', JSON.parse(JSON.stringify(inventory, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value))); return inventory;
}
