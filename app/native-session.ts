import { ScenePlayer } from '../src/runtime/scene-player.ts';
import {savePredecessors,legacyRenderIdentity} from './save-resource-compatibility.ts';
import { NativeSessionDriver, SessionBoundaryUnavailable } from '../src/runtime/native-session-driver.ts';
import type { NativeSessionLoop } from '../src/runtime/native-session-driver.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import { ScriptState, cloneScript, scriptValue } from '../src/script/state.ts';
import type { ScriptValue } from '../src/script/types.ts';
import { ScriptEngine } from '../src/script/expression.ts';
import { NativeProperties } from '../src/world/native-properties.ts';
import type { PropertyTarget } from '../src/world/native-properties.ts';
import { NativeCameraTarget } from '../src/world/camera-target.ts';
import { GraphicEntity } from '../src/world/graphic-entity.ts';
import { AudioEntity } from '../src/world/audio-entity.ts';
import { nativeEntityRegistry } from '../src/world/entity-factory.ts';
import { EntityWorld } from '../src/world/entity-world.ts';
import { WorldCommands } from '../src/world/commands.ts';
import { VoiceSignals } from '../src/world/voice-signals.ts';
import { AudioCatalog } from '../src/audio/audio-catalog.ts';
import {ResourcePrefetch} from '../src/runtime/resource-prefetch.ts';
import {SessionPrefetch} from './session-prefetch.ts';
import { WebAudioEngine } from '../src/audio/web-audio-engine.ts';
import { openNativeGraphics } from '../src/graphics/native-graphics-runtime.ts';
import type { NativeGraphicsRuntime } from '../src/graphics/native-graphics-runtime.ts';
import { nativeNumber } from '../src/world/native-values.ts';
import { openSessionWindow } from './ui/native-window.ts';
import { openSessionAssets } from './session-assets.ts';
import { sessionSettings } from './session-settings.ts';
import { sessionAudioPolicy } from './session-audio-policy.ts';
import { sessionData } from './session-data.ts';
import { installScriptBindings, scriptDictionary } from './script-bindings.ts';
import { NonMotionFrames } from './non-motion-frames.ts';
import { TrackedGraphics } from './tracked-graphics.ts';
import { WorldHost, withWorldUiPages } from './world-host.ts';
import { NativeServices } from './native-services.ts';
import { NativeEyecatch } from './native-eyecatch.ts';
import {NativeOp} from './native-op.ts';
import { originalMotionSound, NativeMotionEffects } from './native-motion-effects.ts';
import { NativeVoices } from './native-voices.ts';
import { SourceProgress } from './source-progress.ts';
import { SessionCommandRouter } from './command-preflight.ts';
import { ApplicationBridge } from './scene-bridge.ts';
import { OriginalStartup } from './original-startup.ts';
import { PaintBarrier } from './paint-barrier.ts';
import type { NativeSessionOptions } from './native-session-options.ts';
import type {NativeSession,SystemProgressData} from './native-session-types.ts';
export type {NativeSession,SystemProgressData,PcDialogueView} from './native-session-types.ts';
import {sessionPause} from './session-pause.ts';
import {liveHistoryPort,historyRecorder} from './live-history-port.ts';
import {pcDialoguePort} from './pc-dialogue-port.ts';
import {ownSynchronization,planStoryWake,StoryPresentation,cleanupFor} from './native-session-work.ts';
export async function openNativeSession(root: URL, canvas: HTMLCanvasElement, overlay: HTMLElement, context: AudioContext,
  initial?: SystemProgressData, restoreIdentity?:string, options:NativeSessionOptions={}): Promise<NativeSession> {
  const {closers,dispose}=cleanupFor(context);
  try {
    const wake = options.demand?.wake;
    const compactCaches=!!options.renderNamespace;
    const speculative=options.streamingAudio&&options.prefetchBytes!==undefined?new ResourcePrefetch(options.prefetchBytes,options.promotePrefetch,options.demand?.prefetchChanged):undefined;
    if(speculative)closers.push(()=>speculative.close());
    const assets = await openSessionAssets(root,compactCaches,speculative); closers.push(() => assets.close()); const defaults = await sessionSettings(root),settings={...defaults,playback:{...defaults.playback,...options.speeds}};
    options.entryProgress?.('resources');
    const after=options.afterstory&&(options.afterstory.label==='*after_mak'?'mak':'yos');
    if(after&&!(initial?.sf.clear&&initial.sf['clear_'+after]&&initial.sf[after==='mak'?'ed2_mako':'ed1_yosh']))throw Error('先通关本篇');
    if(restoreIdentity!==undefined&&!savePredecessors(assets.package.identity,assets.package.previousResourceIdentity).includes(restoreIdentity))throw Error('Unknown predecessor resource slot');
    const script = new ScriptState(); if (initial) script.write('sf', cloneScript(initial.sf));
    const expressions = new ScriptEngine(script); await installScriptBindings(root, script, expressions, assets.branches);
    const motionSound=assets.package.systemVoice ? originalMotionSound(assets.motionDefinitions,!!assets.package.motionActionProfile,!!assets.package.ending) : undefined;
    if (motionSound) script.register('animOffSE', args=>{
      if (args.length!==1 || typeof args[0]!=='string') throw new Error('Invalid original animOffSE');
      return ''; // Original default: enabled scene animation owns the same SE.
    });
    let player: ScenePlayer | undefined, world: EntityWorld | undefined, native: NativeGraphicsRuntime | undefined;
    const now = () => player?.clock.now ?? 0, evaluate = (source: string) => sessionData(expressions.execute(source));
    const lookup = (name: string): PropertyTarget | undefined => { if (name === 'env') return camera; const entity = world?.get(name); return entity instanceof GraphicEntity || entity instanceof AudioEntity ? entity : native?.port.target(name); };
    let cameraRevision = 0; const properties = new NativeProperties(evaluate, lookup, evaluate), camera = new NativeCameraTarget(properties, {}, () => { cameraRevision++; }); closers.push(() => camera.dispose());
    const evaluation = { global: evaluate, local: (source: string, variables: Readonly<Record<string, import('../src/formats/psb-value.ts').PsbValue>>) => {
      const converted = scriptValue(variables); if (!converted || typeof converted !== 'object' || Array.isArray(converted)) throw new Error('Invalid image expression context'); return script.withContext(converted, () => evaluate(source)); } };
    const other = new NonMotionFrames(assets, evaluation); closers.push(() => other.close());
    const ui = await openSessionWindow(assets.graphics, overlay, now, root, key => player?.isRead(key) ?? initial?.read.includes(key) ?? false, !!assets.package.movie, options.systemFontFamily, options.pcDialogue?.windowOpacity);
    closers.push(() => ui.close()); ui.setWindowOpacity(settings.windowOpacity); await ui.prepareFonts();
    const scale = assets.geometry.baseScale(1920, 1080);
    native = await openNativeGraphics({ canvas,compactCaches, resources: assets.graphics, definitions: assets.definitions, evaluation, ui,
      motionDefinitions: assets.motionDefinitions, motionActionProfile: motionSound?(assets.package.motionActionProfile??'sd002ba-se001-v1'):undefined, external: (request, scale, saved) => other.load(request, scale, saved), actions: properties, now, width: 1920, height: 1080,
      legacyRenderStateDatabase: options.renderNamespace==='yoshino-v1'?legacyRenderIdentity(assets.package.identity,assets.package.previousResourceIdentity,restoreIdentity):undefined,
      maskCatalog: assets.dataset('nativeMasks'), extendedTables: assets.dataset('nativeExtendedTables'), renderStateDatabase: (options.renderNamespace?'senren-yoshino-v1-render-':'senren-r62-m1-render-') + (assets.package.previousResourceIdentity??assets.package.identity),
      framePolicy: () => ({ scale: 1, timeColor: true, alphaAwareBlur: true }),
      projection: () => ({ baseScaleX: scale.x, baseScaleY: scale.y, reverseScaleX: 1 / scale.x, reverseScaleY: 1 / scale.y,
        messageShiftX: nativeNumber(camera.read('msgoffx')), messageShiftY: nativeNumber(camera.read('msgoffy')), camera: camera.info(), cameraWithoutQuake: camera.info(), levelForOrder: order => assets.geometry.orderLevel(order) }) });
    const graphics = native; closers.push(() => graphics.close()); const tracked = new TrackedGraphics(graphics.port,wake&&(()=>wake('layer-ready')));
    options.entryProgress?.('graphics');
    const catalog = await AudioCatalog.open(assets.package.audio, context,{decodedByteBudget:(compactCaches?12:24)*1024*1024,streaming:options.streamingAudio,prefetch:speculative}); closers.push(() => catalog.close());
    const audio = new WebAudioEngine(context, catalog, options.audioOutput??context.destination, options.mix,wake&&(()=>wake('audio-ready')));
    if (wake) {
      const state = () => { if (context.state === 'running') wake('audio-resumed'); };
      context.addEventListener('statechange',state); closers.push(() => context.removeEventListener('statechange',state));
    } closers.push(() => audio.stopAll());
    const policy = await sessionAudioPolicy(root, catalog, audio, properties, now, evaluate, () => player?.playback ?? settings.playback, settings, assets.classes, (name, event, storage) => ui.queueMusic(name, event, storage));
    const prefetch=speculative?new SessionPrefetch(speculative,catalog,assets.graphics.images,policy.startOffset):undefined;
    let bridge: ApplicationBridge | undefined;
    const host = new WorldHost(graphics.port, camera, properties, ui, now, tracked, key => bridge?.revealReady(key) ?? false,!!options.restrictions,wake&&(()=>wake('transition-ready')));
    const registry = nativeEntityRegistry(assets.classes, policy, tracked, properties);
    world = new EntityWorld(registry, withWorldUiPages(graphics.worldEffects(host.effects()), ui)); const ownedWorld = world;
    closers.push(async () => { for (const name of ownedWorld.names) await ownedWorld.get(name)?.dispose(); });
    const progress=new SourceProgress(script);
    const viewport=canvas.parentElement;if(!viewport)throw Error('Missing native viewport');
    const op=assets.package.movie?await NativeOp.open(assets.package.movie,viewport,context,settings.volumes.movieaudio,progress,assets.package.ending,assets.package.endingMako,wake&&(()=>wake('movie-event'))):undefined;
    if(op){host.bindOp(op);closers.push(()=>op.close());}
    const services = new NativeServices(ui, host.waits, now, progress, await NativeEyecatch.open(assets.package.systemVoice,now),op,after||false,!!assets.package.endingMako);
    const router = new SessionCommandRouter(world, assets.classes, host, ui, services), commands = new WorldCommands(router, world, services.handlers(), () => player?.playback ?? settings.playback);
    const voices = new NativeVoices(audio, catalog, policy, new VoiceSignals(commands), host.waits, block => { if (!player) throw new Error('Voice block before player ownership'); player.acceptHostWait(block); }); host.connect(world, voices);
    const paints = new PaintBarrier(); closers.push(() => paints.close()); closers.push(() => host.close());
    bridge = new ApplicationBridge(assets.package.identity, world, ui, voices, host, services, progress, router, commands, settings, paints,restoreIdentity,!!options.afterstory,()=>prefetch?.cancel(),options.entryProgress,wake&&(()=>wake('paint-wait-released')));
    const canRecord=()=>!op?.active&&!host.transitionActive&&!player?.hostWaits.length,historyAllowed=()=>canRecord()&&services.menu.interactive;
    const log=historyRecorder(options.sceneHistory,assets.package.identity,()=>ui.chapter?.date??'',graphics.withoutRetainedImages,canRecord);
    player = new ScenePlayer(assets.scenarios, bridge, script,options.restrictions,options.heldSkip&&(()=>op?.active?'none':options.heldSkip!()),log); const ownedPlayer = player; bridge.connect(player); services.connect(player, voices); player.setMode(settings.playback); if (initial) player.seedRead(initial.read);
    const ownedBridge = bridge, startup = await OriginalStartup.open(root, assets.package.entry, script, player, world, host, ui, audio, settings,options.afterstory);
    const entry=options.afterstory??assets.package.entry;
    const synchronize=ownSynchronization({player:ownedPlayer,ui,router,bridge:ownedBridge,host,world:ownedWorld,voices,services,wake});
    const saveReason = (): string | undefined => {
      if(op?.active)return '原影片播放期间不能保存';
      if(router.talkPending)return '等待原定时演出完成';
      const wait = ownedPlayer.waiting; if (!ownedPlayer.position.asset || ownedPlayer.position.ended) return '原开始／结束流程不能保存';
      if (ownedPlayer.scriptSkip.open || !services.menu.interactive) return '等待章间演出和快速菜单恢复';
      if (driver.awaitingPresentation) return '等待画面真实提交'; if (ownedPlayer.clock.snapshot().paused) return '请先关闭历史或暂停遮罩'; if (host.transitionActive || ownedPlayer.hostWaits.length) return '等待原过渡或前置演出完成';
      if (wait.kind === 'dialogue') { if (!ownedBridge.revealReady(wait.key) || wait.reveal && wait.tokens.includes(wait.reveal)) return '请先完成当前正文及内部续页'; }
      else if (wait.kind === 'choice') { if (ui.selections.fore.phase !== 'ready') return '选择正在出现／提交'; }
      else return '仅支持稳定正文／选择边界'; return undefined;
    };
    const motionEffects=motionSound ? new NativeMotionEffects(graphics.port,ownedWorld,ownedPlayer,commands,motionSound) : undefined;
    const visual=()=>host.transitionActive?'transition':graphics.port.frameAnimation??(properties.hasWork(t=>!(t instanceof AudioEntity))?'property-action':ui.frameAnimation?'ui-animation':undefined);
    const presentation=options.demand&&new StoryPresentation(()=>[graphics.port.visualRevision,cameraRevision,ui.publicationGeneration],visual,options.demand,()=>!!op?.returningToGame,()=>!!op?.opaqueVideo);
    const loop: NativeSessionLoop = {
      demand:presentation&&{needsPaint:()=>presentation.request(),committed:()=>presentation.committed(),withoutPaint:()=>{
        if(properties.hasWork(t=>t instanceof AudioEntity))properties.tick(now());
      }},
      paint: motionEffects?.paint.bind(motionEffects),
      beginStart: (storage, target) => startup.begin(storage, target), advanceStart: () => startup.advance(), afterRestore: async () => { startup.restored(); }, synchronize,
      afterPaint: async painted => { if (ownedPlayer.clock.snapshot().paused || document.hidden) return false; const visible = await ownedBridge.afterPaint(painted); if(painted&&visible)op?.afterGamePaint(); await voices.tick(); host.synchronize(); if(host.waits.poll(token => ownedPlayer.notify(token)))wake?.('wait-released');
        if (visible && !document.hidden && !host.transitionActive && !ownedPlayer.hostWaits.length) ui.publishInputs(); return visible && !document.hidden; },
      canPresent: () => !document.hidden,
      pause:sessionPause(context,op,()=>{ui.retireInputs();ownedBridge.invalidatePresentation();},options.stageAudioHeld),
      assertSaveBoundary: async () => { const reason = saveReason(); if (reason) throw new SessionBoundaryUnavailable(reason); if(!presentation||presentation.request()) { const painted = await (motionEffects?.paint(now(),false) ?? graphics.port.frame(now(), false)); if(painted)presentation?.committed(); await ownedBridge.afterPaint(painted); } await synchronize(); const changed = saveReason(); if (changed) throw new SessionBoundaryUnavailable(changed); }
    };
    closers.push(() => { ui.retireInputs(); voices.stopAll(); });
    const driver = new NativeSessionDriver(player, graphics.port, audio, dispose, loop);
    const systemProgress=() => ({ sf: Object.fromEntries(Object.entries(scriptDictionary(script, 'sf')).map(([key, value]) => [key, cloneScript(value)])), read: ownedPlayer.read });
    return { ...(presentation && {
      nextWake: () => planStoryWake(driver,ownedPlayer,{visual:visual(), fallback:host.waits.hasWorldWait?'world-wait':properties.hasWork(t=>t instanceof AudioEntity)?'audio-action':services.menuAnimating?'menu-fade':undefined,
        ui:ui.nextVisualChange,wait:host.waits.nextTime,talk:router.nextTalk,audio:audio.nextWake()}),
      invalidateSurface: () => presentation.invalidate(),
      systemRevision: () => ownedPlayer.readCount+'/'+script.systemRevision,
    }), ...(options.pcDialogue&&pcDialoguePort(ui,ownedPlayer,voices,driver,historyAllowed)), ...(log&&liveHistoryPort(log.journal,player,driver,historyAllowed,systemProgress,()=>prefetch?.cancel(),ui)), identity: assets.package.identity, start: () => driver.start(entry.storage,entry.target), restore: snapshot => {prefetch?.cancel();return driver.restore(snapshot);},
      prefetch,
      step: async milliseconds=>{const result=await driver.step(milliseconds);prefetch?.scan(ownedPlayer,!host.transitionActive&&!driver.awaitingPresentation);return result;},
      advance: () => driver.input(), mode: change => {if(change.skip&&change.skip!=='none')prefetch?.cancel();return driver.mode(change);},
      updateMix:()=>audio.updateMix(),pause:(v,r,s)=>{if(v)prefetch?.pause();return driver.pause(v,r,s);},save: () => driver.save(), saveWithThumbnail:()=>driver.saveWithThumbnail(()=>graphics.port.saveThumbnail(now())),
      choiceInput: (session, generation, index) => driver.action(async () => { await synchronize(); const wait = ownedPlayer.waiting;
        if (session === ui.inputSession && !driver.awaitingPresentation && !ownedPlayer.clock.snapshot().paused && wait.kind === 'choice' && !ownedPlayer.hostWaits.length && wait.indices.includes(index)) {await ownedPlayer.rememberChoice(index);ui.choiceInput(generation,index);} }),
      choiceAppearance: (session, generation, index, kind) => driver.action(async () => { const wait = ownedPlayer.waiting;
        if (session === ui.inputSession && !driver.awaitingPresentation && !ownedPlayer.clock.snapshot().paused && wait.kind === 'choice' && !ownedPlayer.hostWaits.length && wait.indices.includes(index)) ui.choiceAppearance(generation, index, kind); }),
      choose: (session, generation, index) => driver.action(async () => { await synchronize(); const wait = ownedPlayer.waiting;
        if (session !== ui.inputSession || driver.awaitingPresentation || ownedPlayer.clock.snapshot().paused || wait.kind !== 'choice' || ownedPlayer.hostWaits.length || !wait.indices.includes(index)) return;
        if (!ui.choiceDone(generation, index)) return; await ownedPlayer.choose(index); await ownedPlayer.pump(); }),
      history: () => ownedPlayer.history, systemProgress,
      view: () => ({ identity: assets.package.identity, position: ownedPlayer.position, waiting: ownedPlayer.waiting, mode: ownedPlayer.playback, paused: ownedPlayer.clock.snapshot().paused, awaitingPresentation: driver.awaitingPresentation, startup: startup.state, saveReason: saveReason(), menu: services.menu, scriptSkipWindow: ownedPlayer.scriptSkip.open, returnToTitle:services.returnToTitle,movie:op?.view(),audioChannels: [...audio.channels] }),
      inspect: () => driver.action(async () => { if (!driver.awaitingPresentation) await synchronize(); return { position: ownedPlayer.position, wait: ownedPlayer.waiting, hostWaits: ownedPlayer.hostWaits, clock: ownedPlayer.clock.snapshot(), startup: startup.state,
        worldNames: ownedWorld.names, script: script.snapshot(), read: ownedPlayer.read, ui: ui.capture(), audio: audio.capture(), deferred: commands.captureDeferred(), commands: router.audit, renderProfile: ui.compositionProfile, cameraRevision, menu: services.menu, scriptSkipWindow: ownedPlayer.scriptSkip.open, systemVoice: services.lastSystemVoice, motionEvents: motionEffects?.audit }; }),
      close: () => { paints.close(); return driver.close(); } };
  } catch (error) { try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], '会话准备及释放均失败'); } throw error; }
}
