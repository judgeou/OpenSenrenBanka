import type { ScenarioCatalog } from '../scenario/catalog.ts';
import { loadSceneDestination } from './scene-navigation.ts';
import {sceneDialogue} from './scene-dialogue.ts';
import {forecastSceneResources} from './scene-forecast.ts';
import { checkSavedPosition, checkSavedControl, restrictChoices, checkEditionWait } from './scene-restrictions.ts';
import type { SceneRestrictions } from './scene-restrictions.ts';
import { ScriptSkipWindow } from './script-skip-window.ts';
import type { ScenarioDocument } from '../scenario/document.ts';
import { sceneFlow } from '../scenario/flow.ts';
import type { Branch, EvalInstruction, SceneFlow } from '../scenario/flow.ts';
import {copyHistory,checkHistoryTarget,sourceCheckpoint,checkReadWait} from './scene-replay-state.ts';
import { checkpointView, resolveStateReference } from '../scenario/semantics.ts';
import { invocation } from '../scenario/invocation.ts';
import type { RuntimeLocation } from '../scenario/invocation.ts';
import { clonePsbValue, psbValue } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import { ScriptEngine } from '../script/expression.ts';
import { scriptValue, ScriptState } from '../script/state.ts';
import { text, truth } from '../script/operators.ts';
import { LogicalClock } from './clock.ts';
import { PlaybackGate } from './playback-gate.ts';
import {withHeldSkip} from './held-skip.ts';
import { HostBlocks } from './host-blocks.ts';
import {captureHistory} from './live-scene-history.ts';
import type {SceneHistoryRecorder} from './live-scene-history.ts';
import { enterSourceWorld } from './source-entry.ts';
import type { CommandBlock } from './types.ts';
import type { PlaybackMode, PlaybackWait } from './playback-gate.ts';
import type { HistoryEntry, PlayerPosition, PlayerSnapshot, PumpResult, RuntimeDialogue, SceneBridge } from './types.ts';

export class ScenePlayer {
  readonly clock = new LogicalClock(); readonly script: ScriptState; readonly expressions: ScriptEngine;
  private readonly catalog: ScenarioCatalog; private readonly bridge: SceneBridge; private readonly gate = new PlaybackGate(); private readonly host = new HostBlocks();
  private document: ScenarioDocument | undefined; private asset = ''; private scene = 0; private cursor = 0;
  private entered = false; private leaving = false; private nextIndex = 0; private ended = false; private busy = false;
  private point: string | undefined; private stateRef: number | undefined; private currentText: string | undefined;
  private fault: Error | undefined; private flow: SceneFlow | undefined; private readonly readText = new Set<string>(); private records: HistoryEntry[] = [];
  readonly scriptSkip = new ScriptSkipWindow();
  private mode: PlaybackMode = { skip: 'none', auto: false, autoDelay: 1000, characterDelay: 30 };
  constructor(catalog: ScenarioCatalog, bridge: SceneBridge, script = new ScriptState(), private readonly restrictions?:SceneRestrictions,private readonly heldSkip?:()=>PlaybackMode['skip'],private readonly sceneLog?:SceneHistoryRecorder) {
    this.catalog = catalog; this.bridge = bridge; this.script = script; this.expressions = new ScriptEngine(script);
  }
  get position(): PlayerPosition { return { asset: this.asset, scene: this.scene, cursor: this.cursor, entered: this.entered, leaving: this.leaving, nextIndex: this.nextIndex, ended: this.ended, point: this.point, stateRef: this.stateRef, currentText: this.currentText }; }
  get waiting(): PlaybackWait { return this.gate.wait; }
  get currentDialogue(): RuntimeDialogue | undefined {
    const wait = this.gate.wait; if (wait.kind !== 'dialogue') return undefined;
    const value = this.dialogue(this.cursor - 1); if (value.key !== wait.key || value.key !== this.currentText) throw new Error('Dialogue cursor differs from active wait'); return value;
  }
  get playback():Readonly<PlaybackMode>{return this.effective();}
  private effective(read?:boolean){return withHeldSkip(this.mode,this.heldSkip?.()??'none',this.gate.wait,read);}
  beginScriptSkip(): void { this.scriptSkip.begin(this.mode); }
  endScriptSkip(): void { this.scriptSkip.end(this.mode); }
  get history(){return copyHistory(this.records);}
  setMode(change: Partial<PlaybackMode>): void {
    const mode = { ...this.mode, ...change };
    if (!['none', 'read', 'all'].includes(mode.skip) || typeof mode.auto !== 'boolean' || !Number.isFinite(mode.autoDelay) || mode.autoDelay < 0 || mode.autoDelay > 600000 || !Number.isFinite(mode.characterDelay) || mode.characterDelay < 0 || mode.characterDelay > 60000) throw new Error('Invalid playback mode');
    const wait = this.gate.wait; if (mode.skip === 'read' && wait.kind === 'dialogue' && !wait.wasRead) mode.skip = 'none';
    if (mode.auto !== this.mode.auto && wait.kind === 'dialogue') { wait.autoAt = undefined; this.gate.set(wait); }
    this.mode = mode;
  }
  get hostWaits(): readonly CommandBlock[] { return this.host.capture(); }
  isRead(key: string): boolean { return this.readText.has(key); }
  get readCount(): number { return this.readText.size; }
  get read(): readonly string[] { return [...this.readText]; }
  seedRead(keys: readonly string[]): void { this.idle(); if (this.asset) throw new Error('Read seed after start'); for (const key of keys) this.readText.add(key); }
  acceptHostWait(block: CommandBlock): void { this.host.add(block); }
  notify(token: string): void { this.gate.release(token); this.host.complete(token); }
  async start(storage: string, target = ''): Promise<void> { return this.boundary(() => this.navigate(storage, target, 'initial')); }
  private async boundary<T>(operation: () => Promise<T>): Promise<T> { this.idle(); this.busy = true; try { return await operation(); } finally { this.busy = false; } }
  private idle(): void { if (this.busy) throw new Error('Scene control requires a stable pump boundary'); }
  private loaded(): ScenarioDocument { if (!this.document) throw new Error('No scenario is loaded'); return this.document; }
  private location(sourceRef: number, event = this.cursor): RuntimeLocation { return { asset: this.asset, scene: this.scene, event, sourceRef }; }
  private async navigate(storage: string, target: string, source: 'initial' | 'sync' | 'none' = 'sync'): Promise<void> {
    const from=this.document ? this.location(this.document.index.scenes[this.scene].sourceRef) : undefined;
    const {entry,document,scene,flow}=await loadSceneDestination(this.catalog,storage||this.asset,target,from);
    this.restrictions?.destination(entry.id,scene);
    const pendingHost = this.host.take(); if (pendingHost.length) await this.bridge.cancelWait(pendingHost);
    const previous = this.gate.wait; if (previous.kind === 'dialogue' || previous.kind === 'external') { if (previous.tokens.length) await this.bridge.cancelWait(previous.tokens); }
    this.document = document; this.asset = entry.id; this.scene = scene; this.cursor = 0; this.entered = false; this.leaving = false; this.nextIndex = 0; this.ended = false;
    this.point = undefined; this.stateRef = undefined; this.currentText = undefined; this.fault = undefined; this.flow = flow; this.gate.clear();
    if (source !== 'none') await enterSourceWorld(document, scene, this.bridge, source);
  }
  private evals(instructions: readonly EvalInstruction[]): void {
    for (const instruction of instructions) {
      if (instruction.kind === 'program') this.expressions.execute(instruction.source);
      else this.expressions.set(instruction.path, scriptValue(instruction.value));
    }
  }
  private condition(source: string): boolean { return !source || truth(this.expressions.execute(source)); }
  private addHistory(e:HistoryEntry){
    const log=this.sceneLog,caption=log?.caption();if(caption)e={...e,caption};
    this.records.push(e);log?.journal.append(e,caption??'');if(this.records.length>4000)this.records.shift();
  }
  private async drainWait(): Promise<void> {
    const wait = this.gate.clear();
    if ((wait.kind === 'dialogue' || wait.kind === 'external') && wait.tokens.length) await this.bridge.cancelWait(wait.tokens);
    if (wait.kind === 'dialogue') { await this.bridge.completeDialogue(wait.key, this.playback); this.readText.add(wait.key); }
  }
  async input(): Promise<void> {
    return this.boundary(async () => { const wait = this.gate.wait;
    if (wait.kind === 'choice') return;
    if (wait.kind === 'dialogue' && wait.reveal && wait.tokens.includes(wait.reveal)) { if (await this.bridge.revealDialogue(wait.reveal)) this.gate.release(wait.reveal); return; }
    const hostTokens = this.host.take(true); if (hostTokens.length) await this.bridge.cancelWait(hostTokens);
    this.scriptSkip.input(this.mode,wait,hostTokens.length>0);
    if (this.host.blocked || wait.kind === 'none') return;
    if (wait.kind === 'external' && !wait.interruptible || wait.kind === 'time' && !wait.skippable) return;
    await this.drainWait(); });
  }
  async choose(index: number): Promise<void> {
    return this.boundary(async () => { const wait = this.gate.wait, flow = this.flow;
    if (this.host.blocked) return;
    if (wait.kind !== 'choice' || !flow || !wait.indices.includes(index) || this.restrictions && !this.restrictions.picks(this.asset,this.scene,this.script).includes(index)) throw new Error('Choice unavailable');
    const choice = flow.choices.find(value => value.index === index); if (!choice) throw new Error('Unknown scene choice');
    if (choice.expression) this.expressions.execute(choice.expression);
    this.addHistory({ kind: 'choice', key: this.asset + '/' + this.scene + '/choice/' + index, location: this.location(this.loaded().index.scenes[this.scene].sourceRef), body: choice.text, speaker: null, displayName: null, voices: null });
    const storage = this.branchStorage(choice); await this.navigate(storage, choice.target); });
  }
  private branchStorage(branch: Branch): string {
    const evaluate = branch.raw.evalstorage;
    if (evaluate !== undefined && evaluate !== null && evaluate !== '') {
      if (typeof evaluate !== 'string') throw new Error('Invalid dynamic scene storage expression');
      return text(this.expressions.execute(evaluate));
    }
    return branch.storage || this.asset;
  }
  private dialogue(index:number){return sceneDialogue(this.loaded(),this.asset,this.scene,index,(r,i)=>this.location(r,i));}
  forecast(){return this.document&&this.entered&&!this.leaving&&this.waiting.kind==='dialogue'?forecastSceneResources(this.document,this.asset,this.scene,this.cursor):[];}
  private async showDialogue(eventIndex: number): Promise<void> {
    const value = this.dialogue(eventIndex), wasRead = this.readText.has(value.key);
    if ((this.mode.skip === 'read' || this.restrictions && this.mode.skip === 'all') && !wasRead) this.mode.skip = 'none';
    const mode=this.effective(wasRead),ticket=await this.bridge.dialogue(value,mode);this.currentText=value.key;
    this.addHistory({ kind: 'dialogue', key: value.key, location: value.location, body: value.body, speaker: value.speaker, displayName: value.displayName, voices: value.voices });
    if (!this.bridge.renderSkippedDialogue || mode.skip === 'none' || !ticket.revealToken) if ((value.flags & 4n) !== 0n || mode.skip !== 'none') {
      const tokens = [...ticket.voiceTokens, ...(ticket.revealToken ? [ticket.revealToken] : [])];
      if (mode.skip !== 'none' && tokens.length) await this.bridge.cancelWait(tokens); await this.bridge.completeDialogue(value.key, mode); this.readText.add(value.key); return;
    }
    const tokens = [...((value.flags & 2048n) === 0n ? ticket.voiceTokens : []), ...(ticket.revealToken ? [ticket.revealToken] : [])];
    const voiceTokens = (value.flags & 2048n) === 0n ? [...ticket.voiceTokens] : [];
    this.gate.set({ kind: 'dialogue', key: value.key, wasRead, reveal: ticket.revealToken, tokens, voiceTokens,
      voiceAtReveal: ticket.revealToken ? undefined : voiceTokens.length > 0, autoVoiceDelay: ticket.autoVoiceDelay ?? this.mode.autoDelay, autoDelay: this.mode.autoDelay, autoAt: undefined });
  }
  private async leaveScene(): Promise<void> {
    const flow = this.flow!; if (!this.leaving) { this.evals(flow.after); this.leaving = true; }
    while (this.nextIndex < flow.next.length) {
      const branch = flow.next[this.nextIndex++]; if (!this.condition(branch.condition)) continue;
      if (branch.expression) this.expressions.execute(branch.expression);
      if (branch.type === 0) { await this.navigate(this.branchStorage(branch), branch.target); return; }
      const location = this.location(this.loaded().index.scenes[this.scene].sourceRef);
      const block = await this.bridge.command({ name: branch.type === 2 ? 'endrecollection' : 'exit', parameters: branch.raw, order: Object.keys(branch.raw), deferred: undefined, location }, this.playback);
      if (block) this.gate.set({ kind: 'external', tokens: [...block.tokens], interruptible: block.interruptible });
      if (branch.type !== 2) { this.ended = true; return; }
      if (block) return;
    }
    this.ended = true;
  }
  async tick(milliseconds: number, eventBudget = 2000): Promise<PumpResult> { this.idle(); this.clock.advance(milliseconds); return this.pump(eventBudget); }
  async pump(eventBudget = 2000): Promise<PumpResult> {
    this.idle(); if (this.fault) throw this.fault; if (this.clock.snapshot().paused) return { kind: 'yield' };
    if (!Number.isInteger(eventBudget) || eventBudget < 1 || eventBudget > 100000) throw new Error('Invalid scene event budget');
    this.busy = true;
    try {
      for (let step = 0; step < eventBudget; step++) {
        if (this.host.blocked && this.playback.skip !== 'none') { const tokens = this.host.take(true); if (tokens.length) await this.bridge.cancelWait(tokens); }
        if (this.host.blocked) return { kind: 'waiting', wait: this.gate.wait };
        if (!this.gate.ready(this.clock.now, this.playback,this.bridge.renderSkippedDialogue)) return { kind: 'waiting', wait: this.gate.wait };
        if (this.gate.wait.kind !== 'none') await this.drainWait();
        if (this.host.blocked) continue;
        if (this.ended) return { kind: 'ended' };
        const document = this.loaded(), scene = document.index.scenes[this.scene], flow = this.flow!;
        if (!this.entered) {
          this.evals(flow.before); this.entered = true;
          const picks=this.restrictions?.picks(this.asset,this.scene,this.script);
          if (flow.choices.length) {
            const choices = restrictChoices(flow.choices.filter(choice => this.condition(choice.condition)),picks);
            if (!choices.length) throw new Error('Scene has no eligible choices');
            this.point = '0'; this.cursor = Math.min(1, scene.events.length);
            await this.bridge.choices(choices, flow.selectInfo, this.location(scene.sourceRef, 0));
            this.gate.set({ kind: 'choice', indices: choices.map(choice => choice.index) }); continue;
          }
        }
        if (this.leaving || this.cursor >= scene.events.length) { await this.leaveScene(); continue; }
        const index=this.cursor,event=scene.events[index];
        if(this.sceneLog&&event.kind==='text'&&this.sceneLog.journal.needsText(this.asset,this.scene,scene.label,Number(event.externalId)))
          await this.captureMarker(this.dialogue(index).key);
        this.cursor++;const location=this.location(event.sourceRef,index);
        if (event.kind === 'opaque') throw new Error('Unmapped scene event: ' + event.reason);
        if (event.kind === 'record') {
          const checkpoint = checkpointView(document, event); this.point = String(checkpoint.point); this.stateRef = checkpoint.stateRef;
          await this.bridge.checkpoint(checkpoint, location);
        } else if (event.kind === 'marker') await this.bridge.marker(event.value, location);
        else if (event.kind === 'text') await this.showDialogue(index);
        else {
          const command = invocation(document, event, location);
          if (command.name === 'wait' && !command.deferred && command.order.every(name => name === 'time')) {
            const raw = command.parameters.time, time = raw === undefined || raw === null ? 0 : Number(raw);
            if (!Number.isFinite(time) || time < 0) throw new Error('Invalid scene time wait');
            this.gate.set({ kind: 'time', until: this.clock.now + time, skippable: true });
          } else {
            const block = await this.bridge.command(command, this.playback);
            if (block) this.gate.set({ kind: 'external', tokens: [...block.tokens], interruptible: block.interruptible });
          }
        }
      }
      return { kind: 'yield' };
    } catch (error) { this.fault = new Error('Scene failed at ' + this.asset + ':' + this.scene + ':' + Math.max(0,this.cursor-1) + ': ' + (error instanceof Error ? error.message : String(error)), { cause: error }); throw this.fault; }
    finally { this.busy = false; }
  }
  seekCheckpoint(storage:string,target:string,point:bigint){return this.boundary(async()=>{
    await this.navigate(storage,target,'none');const c=sourceCheckpoint(this.loaded(),this.scene,point,!!this.flow!.choices.length);
    this.cursor=c.cursor;this.entered=!this.flow!.choices.length;this.point=c.point;this.stateRef=c.state;
    if(c.world!==undefined)await this.bridge.restoreWorld(c.world);
  });}
  private snapshot(read:readonly string[],history:readonly HistoryEntry[]):Promise<PlayerSnapshot>{
    this.loaded();return this.bridge.captureWorld().then(world=>({schemaVersion:2,hostWaits:this.host.capture(),position:this.position,
      clock:this.clock.snapshot(),script:this.script.snapshot(),mode:{...this.mode},wait:this.gate.wait,read,history,world:clonePsbValue(world)}));
  }
  rememberChoice(index:number){return this.boundary(async()=>{
    const w=this.gate.wait;if(this.sceneLog&&w.kind==='choice'&&w.indices.includes(index))await this.captureMarker(this.asset+'/'+this.scene+'/choice/'+index);
  });}
  private captureMarker(key:string){const log=this.sceneLog!;return captureHistory(log,key,()=>this.host.blocked,()=>this.snapshot([],[]));}
  async save():Promise<PlayerSnapshot>{return this.boundary(()=>this.snapshot([...this.readText],this.history));}
  async restore(saved: PlayerSnapshot, beforeText?:string): Promise<void> {
    return this.boundary(async () => { if (saved.schemaVersion !== 2) throw new Error('Unsupported snapshot schema');
    const position = saved.position; await this.navigate(position.asset, '', 'none'); const document = this.loaded();
    checkSavedPosition(document,saved); this.restrictions?.destination(position.asset,position.scene);
    this.scene = position.scene; this.cursor = position.cursor; this.entered = position.entered; this.leaving = position.leaving; this.nextIndex = position.nextIndex; this.ended = position.ended;
    this.point = position.point; this.stateRef = position.stateRef; this.currentText = position.currentText; this.flow = sceneFlow(document, this.scene);
    checkSavedControl(saved,this.flow.next.length);
    this.clock.restore(saved.clock); this.script.restore(saved.script); this.setMode(saved.mode); this.gate.set(saved.wait);
    if(beforeText!==undefined)checkHistoryTarget(document,saved,beforeText,()=>this.dialogue(this.cursor).key,this.restrictions?.picks(this.asset,this.scene,this.script).length);
    else if(this.restrictions){checkEditionWait(this.restrictions,this.asset,this.scene,this.script,this.gate.wait);void this.currentDialogue;}
    for(const key of saved.read)this.readText.add(key);checkReadWait(this.gate,this.readText);this.records=copyHistory(saved.history);
    this.sceneLog?.journal.seedHistory(this.records);
    this.host.restore(saved.hostWaits);
    await this.bridge.restoreWorld(clonePsbValue(saved.world));
    const w=saved.wait;if(w.kind==='choice')await this.bridge.choices(this.flow.choices.filter(c=>w.indices.includes(c.index)),this.flow.selectInfo,this.location(document.index.scenes[this.scene].sourceRef));
    });
  }
}
