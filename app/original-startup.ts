import type { ScriptState } from '../src/script/state.ts';
import type { ScenePlayer } from '../src/runtime/scene-player.ts';
import type { EntityWorld } from '../src/world/entity-world.ts';
import { worldPlan } from '../src/world/plan.ts';
import type { WebAudioEngine } from '../src/audio/web-audio-engine.ts';
import type { NativeWindow } from './ui/native-window.ts';
import type { WorldHost } from './world-host.ts';
import type { SessionSettings } from './session-settings.ts';
import { originalText } from './original-text.ts';
import { scriptDictionary } from './script-bindings.ts';
import type { AfterstoryStart } from './native-session-options.ts';
export interface StartupState { readonly phase: 'new' | 'title-fade' | 'scenario-wait' | 'ready'; readonly controls: boolean; readonly history: boolean; readonly effectsSkip: boolean; readonly system: 'title' | 'game'; readonly steps: readonly string[] }
interface StartPlan { readonly storage: string; readonly target: string; readonly titleFade: number; readonly scenarioWait: number }
function one(source: string, expression: RegExp, purpose: string): RegExpMatchArray {
  const matches = [...source.matchAll(expression)]; if (matches.length !== 1) throw new Error('Original startup is missing/ambiguous: ' + purpose); return matches[0];
}
async function plan(root: URL, expected: { readonly storage: string; readonly target: string }, afterstory?:AfterstoryStart): Promise<StartPlan> {
  const [custom, macro, start] = await Promise.all([originalText(root, 'custom.ks'), originalText(root, 'macro.ks'), originalText(root, 'start.ks')]);
  const title = one(custom, /^[*]title_game\s*\r?\n([\s\S]*?)(?=^[*])/gmu, 'title.game hook')[1];
  const titleFade = Number(one(title, /\[endtrans\s+fade=([0-9]+)\]/gu, 'title fade')[1]);
  if (!title.includes('[allimage hide delete]') || !title.includes('[clearlayers page=back]')) throw new Error('Unknown original title leave program');
  const prefix = one(start, /^[*]start[^\r\n]*\r?\n([\s\S]*?)(?=^\[ゲーム開始)/gmu, 'normal scenario prelude')[1];
  const scenarioWait = Number(one(prefix, /\[wait\s+time=([0-9]+)\]/gu, 'scenario initial wait')[1]);
  if (!prefix.includes('[initscene]') || !prefix.includes('[quickmenu fadein delayednotify]')) throw new Error('Unknown original game prelude');
  const entry = one(start, /^\[ゲーム開始\s+storage="([^"]+)"\s+target="([^"]*)"\]/gmu, 'normal game target');
  if (entry[1] !== expected.storage || entry[2] !== expected.target) throw new Error('Package entry differs from original start.ks');
  if (!macro.includes('delete tf.afterstory') || !macro.includes('delete tf.start_storage') || !macro.includes('delete tf.start_target') || !start.includes('[syscurrent name="game"]') || !start.includes('[scenestart storage=&tf.start_storage target=&tf.start_target]')) throw new Error('Unknown original game variable/dispatcher program');
  if (titleFade > 60000 || scenarioWait > 60000) throw new Error('Original startup wait exceeds finite bound');
  if(afterstory){
    const mako=afterstory.label==='*after_mak';
    const line=mako?one(start,/^\*after_mak\|\r?\n\s*\[ゲーム開始\s+storage="([^"]+)"\s+target="([^"]*)"\]/gmu,'茉子后日谈入口'):
      one(start,/^\*after_yos\|\r?\n\s*\[ゲーム開始\s+storage="([^"]+)"\s+target="([^"]*)"\]/gmu,'芳乃后日谈入口');
    if(line[1]!==afterstory.storage||line[2]!==afterstory.target||!prefix.includes('@next target='+afterstory.label+' eval="tf.afterstory=='+(mako?2:1)+'"'))throw Error('后日谈入口与原脚本不同');
    return {storage:line[1],target:line[2],titleFade,scenarioWait};
  }
  return { storage: entry[1], target: entry[2], titleFade, scenarioWait };
}
/** Finite normal-new-game path, not a generic KS interpreter or a substitute for compiled SCN control flow.
 * Temporary start controls replace title artwork. Its real leave transition still executes against owned black roots.
 * The ten active PCK text views are overlays; original start.ks includes *jump/*envstart in the same file. */
export class OriginalStartup {
  private phase: StartupState['phase'] = 'new'; private controls = false; private history = false; private effectsSkip = true;
  private system: StartupState['system'] = 'title'; private until = 0; private readonly steps: string[] = [];
  private constructor(private readonly source: StartPlan, private readonly script: ScriptState, private readonly player: ScenePlayer,
    private readonly world: EntityWorld, private readonly host: WorldHost, private readonly ui: NativeWindow,
    private readonly audio: WebAudioEngine, private readonly settings: SessionSettings) {}
  static async open(root: URL, expected: { readonly storage: string; readonly target: string }, script: ScriptState, player: ScenePlayer,
    world: EntityWorld, host: WorldHost, ui: NativeWindow, audio: WebAudioEngine, settings: SessionSettings, afterstory?:AfterstoryStart): Promise<OriginalStartup> {
    return new OriginalStartup(await plan(root, expected,afterstory), script, player, world, host, ui, audio, settings);
  }
  get state(): StartupState { return { phase: this.phase, controls: this.controls, history: this.history, effectsSkip: this.effectsSkip, system: this.system, steps: [...this.steps] }; }
  restored(): void { if (this.phase !== 'new') throw new Error('Restored startup must be unused'); this.phase = 'ready'; this.system = 'game'; this.controls = this.history = true; this.steps.push('project-restore:no-startup-replay'); }
  async begin(storage: string, target: string): Promise<void> {
    if (this.phase !== 'new' || storage !== this.source.storage || target !== this.source.target || this.world.names.length || this.audio.channels.length) throw new Error('Original new-game path requires a fresh matching session');
    this.player.setMode({ ...this.settings.playback, skip: 'none', auto: false });
    this.controls = false; this.history = false; this.ui.retireInputs();
    this.steps.push('title.game:clickskip=false', 'title.game:fadeoutbgm(empty-owned-title)', 'title.game:allimage-hide-delete/clear-back');
    await this.world.apply(worldPlan({ trans: { method: 'crossfade', time: this.source.titleFade } }), this.player.playback);
    this.phase = 'title-fade';
  }
  async advance(): Promise<boolean> {
    if (this.phase === 'title-fade') {
      if (this.host.transitionActive) return false;
      this.script.write('f', {}); this.script.write('pflags', {}); this.script.write('scflags', {}); this.script.write('pcflags', {});
      this.steps.push('title:clearvar/historyopt-uiload', 'sysinit:locklink/disablestore/cancel-modes/clear-history/stop-recollection');
      this.player.setMode({ skip: 'none', auto: false }); this.ui.hide(); this.ui.resetTextContext(); this.host.camera.reset();
      this.system = 'game'; this.steps.push('sysjump:title-to-game/start');
      // initbase's stop media/quake operate on a deliberately fresh owned world; no native movie player exists to stop.
      this.audio.stopAll(); this.effectsSkip = true; this.history = true; await this.ui.load('both');
      this.steps.push('initscene:initbase/inactive-system-movie-end/history+rclick+noeffect-enabled', 'initmode:page/erafter/nextvoice/autoindent/meswinload-both', 'quickmenu:fadein-delayednotify');
      this.until = this.host.now() + this.source.scenarioWait; this.phase = 'scenario-wait'; return false;
    }
    if (this.phase === 'scenario-wait') {
      if (this.host.now() < this.until) return false;
      const temporary = scriptDictionary(this.script, 'tf'); delete temporary.afterstory; delete temporary.start_storage; delete temporary.start_target;
      temporary.start_storage = this.source.storage; temporary.start_target = this.source.target;
      this.steps.push('game-macro:clear-afterstory/set-start-storage+target', 'exit:start/*jump', 'playerExecMode:envstart/syscurrent-game/scenestart/sceneplay');
      this.controls = true; this.phase = 'ready'; return true;
    }
    return this.phase === 'ready';
  }
}
