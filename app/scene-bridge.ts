import { spatialProfile, assertSpatialWorld } from './spatial-profile.ts';
import type { SceneBridge, RuntimeDialogue, DialogueTicket, CommandBlock } from '../src/runtime/types.ts';
import type { RuntimeCommand, RuntimeLocation } from '../src/scenario/invocation.ts';
import type { CheckpointView } from '../src/scenario/semantics.ts';
import type { SceneFlow, Choice } from '../src/scenario/flow.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import type { ScenePlayer } from '../src/runtime/scene-player.ts';
import type { EntityWorld } from '../src/world/entity-world.ts';
import type { WorldCommands } from '../src/world/commands.ts';
import { sourceWorldState } from '../src/world/plan.ts';
import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { NativeWindow } from './ui/native-window.ts';
import { messageReceipt } from './ui/message-receipt.ts';
import type { NativeVoices } from './native-voices.ts';
import type { WorldHost } from './world-host.ts';
import type { NativeServices } from './native-services.ts';
import type { SourceProgress } from './source-progress.ts';
import type { SessionCommandRouter } from './command-preflight.ts';
import type { SessionSettings } from './session-settings.ts';
import type { PaintBarrier } from './paint-barrier.ts';
import { sourceSyncPlan } from './source-sync.ts';
import { runtimeCommand } from './runtime-command-data.ts';
import { sessionData } from './session-data.ts';
import type {EntryObserver} from './native-session-options.ts';

interface ActiveDialogue { readonly key: string; readonly flags: bigint }
/** Concrete production bridge. No native callback invokes this object or changes the player. */
export class ApplicationBridge implements SceneBridge {
  readonly renderSkippedDialogue=true;
  private player: ScenePlayer | undefined; private active: ActiveDialogue | undefined; private presented: string | undefined;
  constructor(private readonly identity: string, private readonly world: EntityWorld, private readonly ui: NativeWindow,
    private readonly voices: NativeVoices, private readonly host: WorldHost, private readonly services: NativeServices,
    private readonly progress: SourceProgress, private readonly router: SessionCommandRouter, private readonly commands: WorldCommands,
    private readonly settings: SessionSettings, private readonly paints: PaintBarrier,private readonly restoreIdentity?:string,
    private readonly hiddenEntryDate=false,private readonly beforeChoice?:()=>void,private entryProgress?:EntryObserver,private readonly wake?:()=>void) {}
  connect(player: ScenePlayer): void { if (this.player) throw new Error('Scene bridge already connected'); this.player = player; }
  private owner(): ScenePlayer { if (!this.player) throw new Error('Scene bridge has no player'); return this.player; }
  async numericSignal(trigger:bigint):Promise<void>{this.accept(await this.commands.signal(trigger));}
  private accept(blocks: readonly CommandBlock[]): void { for (const block of blocks) this.owner().acceptHostWait(block); }
  command(command: RuntimeCommand, mode: Readonly<PlaybackMode>): Promise<CommandBlock | undefined> { return this.router.dispatch(command, mode); }
  async dialogue(dialogue: RuntimeDialogue, mode: Readonly<PlaybackMode>): Promise<DialogueTicket> {
    const flags = dialogue.flags, allowed = 8n | 16n | 64n | 128n | 512n | 1024n | 2048n;
    if (flags < 0n || (flags & ~allowed) !== 0n) throw new Error('Unsupported original text flag shape at ' + dialogue.key + ': ' + flags);
    this.voices.preflight(dialogue.voices); this.ui.retireInputs();
    // Font/glyph preparation finishes before starting a newly decoded voice. Never leave ui.show's Promise unowned.
    await this.ui.show(dialogue, mode); this.active = { key: dialogue.key, flags }; this.presented = undefined;
    const voiceTokens = mode.skip === 'none' ? await this.voices.play(dialogue.voices, (flags & 2048n) === 0n) : [];
    this.router.beginTalk();
    if (mode.skip !== 'none') { this.voices.stopAll(); await this.voices.tick(); }
    const revealToken = this.host.waits.add({ kind: 'reveal', key: dialogue.key });
    return { revealToken, voiceTokens, autoVoiceDelay: this.settings.autoVoiceDelay + ((flags & 512n) !== 0n ? this.settings.autoNextVoiceDelay : 0) };
  }
  revealReady(key: string): boolean {
    const page = this.ui.messages.writer;
    return this.active?.key === key && page.key === key && page.complete && this.presented !== undefined && this.presented === messageReceipt(this.ui);
  }
  async revealDialogue(token: string): Promise<boolean> {
    const wait = this.host.waits.find(token); if (wait?.kind !== 'reveal' || this.active?.key !== wait.key) return false;
    const page = this.ui.messages.writer;
    // A second click cannot cross an unseen automatic page or terminal glyph prefix.
    if (page.flow?.phase === 'page' && this.presented !== messageReceipt(this.ui)) return false;
    this.ui.continueDialogue(wait.key, this.owner().playback, this.voices.normalPlaying);
    return this.revealReady(wait.key);
  }
  async completeDialogue(key: string, mode: Readonly<PlaybackMode>): Promise<void> {
    if (this.active?.key !== key) throw new Error('Original afterpage has no matching body owner: ' + key);
    const flags = this.active.flags;
    // Native delaydone precedes afterpage; its remaining callbacks can themselves return real host waits.
    this.accept(await this.commands.signal());this.router.finishTalk();
    if (this.settings.voiceCut && this.settings.voiceCutPage && (flags & 2048n) === 0n) { this.voices.stopNormal(); await this.voices.tick(); }
    this.host.properties.finishWaitable(undefined, this.host.now()); this.host.stopScreen();
    if ((flags & 64n) !== 0n && mode.skip === 'none') this.ui.eraseText();
    this.active = undefined; this.presented = undefined;
  }
  async checkpoint(value: CheckpointView, location: RuntimeLocation): Promise<void> { this.progress.checkpoint(value, location, this.owner()); }
  async marker(value: string, _location: RuntimeLocation): Promise<void> { this.services.marker(value); }
  async choices(choices: readonly Choice[], info: SceneFlow['selectInfo'], _location: RuntimeLocation): Promise<void> {
    this.beforeChoice?.();
    this.active = undefined; this.presented = undefined; this.ui.retireInputs(); await this.ui.showChoices(choices, info);
  }
  async cancelWait(tokens: readonly string[]): Promise<void> { await this.host.waits.cancel(tokens); await this.voices.tick(); }
  /** A successful GL draw must cross a real browser frame before revealing the story token. Hidden wakeups never claim paint. */
  async afterPaint(painted: boolean): Promise<boolean> {
    if (!painted) return false; const receipt = messageReceipt(this.ui), visible = await this.paints.wait();
    if (visible && receipt !== undefined && receipt === messageReceipt(this.ui)) {
      this.presented = receipt;
      const page=this.ui.messages.pages[this.ui.visualPage];
      if(this.entryProgress&&page.key&&page.key===this.ui.messages.writer.key&&page.visible&&page.count()>0){
        const report=this.entryProgress;this.entryProgress=undefined;report('dialogue',page.key);
      }
    }
    this.host.synchronize(); if (this.host.waits.poll(token => this.owner().notify(token))) this.wake?.(); return visible;
  }
  invalidatePresentation(): void { this.presented = undefined; }
  async captureWorld(): Promise<PsbValue> {
    const world = await this.world.capture(), voices = this.voices.capture();
    return sessionData({ format: 'senren-native-session-world-v1', schemaVersion: 1n, identity: this.identity, spatialProfile,
      world, voices, ui: this.ui.capture(), waits: this.host.waits.capture(), services: this.services.capture(), progress: this.progress.capture(),
      deferred: this.commands.captureDeferred(), active: this.active ?? null });
  }
  private preflightSource(value: PsbValue): string | undefined {
    const row = psbRecord(value); sourceWorldState(value);
    for (const key of Object.keys(row)) if (!['data', 'env', 'meswinchange', 'scnchart', 'showdate'].includes(key)) throw new Error('Unimplemented original world plugin state: ' + key);
    if (row.meswinchange !== undefined && row.meswinchange !== 'MSGWIN') throw new Error('Original alternate message-window state is not bound');
    if (row.scnchart !== undefined && row.scnchart !== null && typeof row.scnchart !== 'string') throw new Error('Invalid original chart state');
    if (row.showdate === undefined || row.showdate === null) return;
    const date = psbRecord(row.showdate), keys = Object.keys(date);
    if (keys.every(key => ['back', 'date', 'fore', 'nowShow'].includes(key))) {
      if (Object.values(date).every(value => value === null)) return;
      // The extra story starts with a retained date but with both pages empty
      // and the indicator hidden. Do not show it when hydrating the tag.
      if (this.hiddenEntryDate && date.back === null && date.fore === null && date.nowShow === 0n &&
          typeof date.date === 'string' && date.date.length <= 4 && /^[0-9]+-[0-9]+$/u.test(date.date)) return date.date;
    }
    throw new Error('Active original chapter-state reconstruction is outside the initial source boundary');
  }
  async syncWorld(state: PsbValue): Promise<void> {
    const plan = sourceSyncPlan(state, this.world); await this.world.apply(plan, this.owner().playback);
  }
  async restoreWorld(state: PsbValue): Promise<void> {
    const row = psbRecord(state); this.presented = undefined;
    if (row.format !== 'senren-native-session-world-v1') {
      if (row.schemaVersion !== undefined || row.format !== undefined) throw new Error('Unknown source/player world snapshot format');
      const date = this.preflightSource(state); this.commands.cancelDeferred(); this.host.waits.clear(); this.voices.stopAll(); await this.voices.tick();
      this.active = undefined; await this.world.restoreSource(state); this.progress.restoreSource(row); this.ui.change('default');
      if (date !== undefined) await this.ui.chapterCommand({ [date]: true, visible: false }, [date, 'visible'], true);
      return;
    }
    const identity=this.restoreIdentity??this.identity;
    assertSpatialWorld(state,identity);
    if (row.schemaVersion !== 1n || row.identity !== identity || !Array.isArray(row.deferred) || row.deferred.length > 100000) throw new Error('Incompatible/corrupted native session snapshot');
    const deferred = row.deferred.map(runtimeCommand); for (const command of deferred) { if (!command.deferred) throw new Error('Saved delayed command lost trigger'); this.router.preflight(command); }
    const savedGraphics = psbRecord(psbRecord(psbRecord(row.world).effects).graphics);
    if (savedGraphics.screen !== null || !Array.isArray(savedGraphics.hidden) || savedGraphics.hidden.length) throw new Error('Saved mid-transition state is not a supported stable slot');
    // EntityWorld rebuilds entity-owned music/sound ONCE, then hidden IDs/graphics/actions. Body voice owns only its tracks.
    await this.world.restore(row.world); await this.voices.restore(row.voices);
    const waiting = this.owner().waiting; await this.ui.restore(row.ui, waiting.kind === 'choice', false);
    this.services.restore(row.services); this.progress.restore(row.progress); this.commands.restoreDeferred(deferred); this.host.waits.restore(row.waits);
    const active = row.active === null ? undefined : psbRecord(row.active);
    if (active && (typeof active.key !== 'string' || typeof active.flags !== 'bigint')) throw new Error('Invalid saved active body');
    const expected = this.owner().currentDialogue;
    if (expected) {
      if (!active || active.key !== expected.key || active.flags !== expected.flags || this.ui.messages.writer.key !== expected.key || this.ui.messages.writer.presentation?.flags !== expected.flags) throw new Error('Saved UI/body differs from source cursor');
      this.active = { key: expected.key, flags: expected.flags };
      this.ui.validateDialogueWait(expected.key, waiting.kind === 'dialogue' && !!waiting.reveal && waiting.tokens.includes(waiting.reveal));
    } else { if (active) throw new Error('Saved body owner exists outside a dialogue wait'); this.active = undefined; }
    const tokens = [...(waiting.kind === 'dialogue' || waiting.kind === 'external' ? waiting.tokens : []), ...this.owner().hostWaits.flatMap(block => [...block.tokens])];
    this.host.waits.validate(tokens);
  }
}
