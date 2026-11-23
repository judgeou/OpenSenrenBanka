import { serviceCommandNames } from '../src/world/commands.ts';
import type { NativeCommandServices } from '../src/world/commands.ts';
import type { CommandHandler } from '../src/runtime/command-router.ts';
import type { RuntimeCommand } from '../src/scenario/invocation.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import { nativeNumber, nativeBoolean } from '../src/world/native-values.ts';
import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { ScenePlayer } from '../src/runtime/scene-player.ts';
import type { NativeWindow } from './ui/native-window.ts';
import type { NativeVoices } from './native-voices.ts';
import type { SessionWaits } from './session-waits.ts';
import type { SourceProgress } from './source-progress.ts';
import type { NativeEyecatch } from './native-eyecatch.ts';
type ServiceName = typeof serviceCommandNames[number];
// KAGWindow.waitUntil reads only the ASCII time field (void converts to 0).
// The original 008 tag includes the fullwidth equals in the name, not a duration.
function fullwidthWait(c:RuntimeCommand):boolean {
  const p=c.location;
  return p.asset==='0008'&&p.scene===2&&p.event===979&&p.sourceRef===338946&&c.order.length===1&&c.order[0]==='time＝1000'&&c.parameters['time＝1000']==='true';
}
function fields(command: RuntimeCommand, allowed: readonly string[]): void {
  for (const key of Object.keys(command.parameters)) if (!allowed.includes(key)) throw new Error('Unimplemented ' + command.name + ' field: ' + key);
}
function unsupported(command: RuntimeCommand): never { throw new Error('Native service shape is outside the implemented session: ' + command.name + ' at ' + command.location.asset + ':' + command.location.scene + ':' + command.location.event); }
import type {NativeOp} from './native-op.ts';
export class NativeServices {
  private player: ScenePlayer | undefined; private voices: NativeVoices | undefined;
  private menuHiddenUntilMessage=false;
  onMessageOrChoice():void{if(this.menuHiddenUntilMessage){this.menuHiddenUntilMessage=false;this.eyecatch.fade(true,true);}}
  private titleRequested = false;
  get returnToTitle():boolean { return this.titleRequested; }
  private originalRecollectionExit(command:RuntimeCommand):boolean {
    const p=command.parameters;
    return Object.keys(p).length===3&&p.eval==='kag.isRecollection'&&p.storage==='replay.ks'&&p.target==='*endrecollection';
  }
  private originalTitleExit(command:RuntimeCommand):boolean {
    const p=command.parameters,{asset,scene}=command.location;
    return Object.keys(p).length===3&&p.storage==='start.ks'&&p.type===1n&&(this.afterstory
      ? p.target==='*gameend_after'&&asset===(this.afterstory==='mak'?'0043':'0031')&&scene===21
      : p.target==='*gameend_title'&&(!this.makoIncluded||asset==='0030'&&scene===3||asset==='0042'&&scene===21));
  }
  private exited = false; private effectsEnabled = true;
  constructor(private readonly ui: NativeWindow, private readonly waits: SessionWaits, private readonly now: () => number, private readonly progress: SourceProgress, private readonly eyecatch: NativeEyecatch,private readonly op?:NativeOp,private readonly afterstory:false|'yos'|'mak'=false,private readonly makoIncluded=false) {}
  connect(player: ScenePlayer, voices: NativeVoices): void { if (this.player || this.voices) throw new Error('Services already connected'); this.player = player; this.voices = voices; }
  get exitRequested(): boolean { return this.exited; }
  marker(value: string): void { if (!this.op?.defersSeenMarker(value)) this.progress.marker(value); }
  // The original noeffect permission forces the normal multiplier rather than suppressing drawing.
  get effectScale(): number { return 1; }
  get menu() { return this.eyecatch.menu; }
  get menuAnimating(): boolean { return this.eyecatch.menuAnimating; }
  get lastSystemVoice() { return this.eyecatch.lastVoice; }
  preflight(command: RuntimeCommand): void {
    const p = command.parameters;
    switch (command.name) {
      case 'meswinload': fields(command, ['page']); if (p.page !== 'fore' && p.page !== 'back' && p.page !== 'both') throw new Error('Unknown original message page'); return;
      case 'chapter':
        for (const key of Object.keys(p)) { if (key === 'backoff') unsupported(command);
          if (!['show', 'hide', 'clear', 'visible', 'after', 'prologue'].includes(key) && !/^[0-9]+-[0-9]+$/u.test(key)) throw new Error('Unknown original chapter field: ' + key);
          if (key === 'visible') nativeBoolean(p[key]); }
        return;
      case 'wait': if (fullwidthWait(command)) return; fields(command, ['time', 'msgoff']); if (p.msgoff!==undefined && !nativeBoolean(p.msgoff)) unsupported(command); if (nativeNumber(p.time, 0) < 0) throw new Error('Negative original wait'); return;
      case 'scnchart': fields(command, ['enter', 'leave', 'reset']);
        if (p.enter !== undefined && typeof p.enter !== 'string') throw new Error('Invalid chart entry');
        if (p.leave !== undefined && !nativeBoolean(p.leave)) unsupported(command); if (p.reset !== undefined && !nativeBoolean(p.reset)) unsupported(command);
        if (p.enter === undefined && p.leave === undefined && p.reset === undefined) unsupported(command); return;
      case 'msgoff': case 'cancelskip': fields(command, []); return;
      case 'stopvoice': {
        fields(command,['all','name']);
        if(Object.keys(p).length && (typeof p.name!=='string'||!p.name||nativeNumber(p.all,0)!==1))unsupported(command);
        return;
      }
      case 'meswinchange': {
        fields(command,['type']);
        if(p.type==='MSGWIN'||this.op&&(p.type==='another'||p.type==='default'))return;
        return unsupported(command);
      }
      case 'playvoice': if (!this.voices) throw new Error('Voices not connected'); this.voices.preflightPlayVoice({...p}); return;
      case 'exit': if(!this.originalTitleExit(command)&&!this.originalRecollectionExit(command))fields(command,[]); return;
      case 'noeffect': fields(command,['enabled']);if(!nativeBoolean(p.enabled))unsupported(command);return;
      case 'quickmenu':
        // QuickMenu.setVisible: the same original tag shapes are shared by OP and ED.
        if(Object.keys(p).length===2&&((p.fadeout==='true'&&p.wait==='true')||(p.visible==='true'&&p.hidden==='true')))return;
        fields(command,['fadein','fadeout']);
        if (Object.keys(p).length!==1||!nativeBoolean(p.fadein??p.fadeout)) unsupported(command);
        return;
      case 'beginskip': case 'endskip': case 'endrecollection': fields(command,[]); return;
      case 'sysvoice':
        fields(command,['eyecatch','name','chara']);
        if (!nativeBoolean(p.eyecatch)||!this.voices) throw new Error('Original eyecatch voice requires connected normal voice transport');
        this.eyecatch.preflight(p.name,p.chara,this.voices); return;
      case 'sysmovie': if(!this.op)return unsupported(command);this.op.preflight(command);return;
      default: throw new Error('Unknown native service: ' + command.name);
    }
  }
  private async run(command: RuntimeCommand, mode: Readonly<PlaybackMode>) {
    this.preflight(command); const p = command.parameters;
    switch (command.name) {
      case 'meswinload': if (p.page === 'fore' || p.page === 'back' || p.page === 'both') await this.ui.load(p.page); else throw new Error('Invalid message page'); break;
      case 'chapter': await this.ui.chapterCommand(p, command.order, mode.skip !== 'none'); break;
      case 'wait': if (fullwidthWait(command)) return; return this.waits.block([{ kind: 'time', until: this.now() + nativeNumber(p.time, 0) }], true);
      case 'scnchart': this.progress.chartCommand(p); break;
      case 'quickmenu': {
        // visible=true sets the requested visibility; hidden=true suppresses it
        // without a fade until the next original visible message or choice.
        if(p.visible==='true'&&p.hidden==='true'){this.menuHiddenUntilMessage=true;this.eyecatch.fade(false,true);break;}
        const until=this.eyecatch.fade(p.fadein!==undefined&&!this.menuHiddenUntilMessage,mode.skip!=='none');
        if(p.wait==='true')return this.waits.block([{kind:'time',until}],false);
        break;
      }
      case 'beginskip': if (!this.player) throw new Error('Player not connected'); this.player.beginScriptSkip(); break;
      case 'endskip': if (!this.player) throw new Error('Player not connected'); this.player.endScriptSkip(); break;
      // The sole entry of this app is the original normal-game start, not recollection.
      // MainWindow.endRecollection returns 0 without effects when !isRecollection.
      case 'endrecollection': break;
      case 'sysvoice': if (!this.voices) throw new Error('Voices not connected'); await this.eyecatch.play(p.name,p.chara,this.voices); break;
      case 'msgoff': this.ui.hide(); break;
      case 'meswinchange': this.ui.change(p.type==='another'?'another':'default'); break;
      case 'sysmovie': {
        if(!this.op)return unsupported(command);
        // Reaching an original film while skipping dialogue is legal; the
        // movie now owns playback and its own first-watch/replay rules.
        if(mode.skip!=='none')this.player?.setMode({skip:'none'});
        const {token,interruptible}=this.op.start(command);this.ui.retireInputs();
        return {tokens:[this.waits.add({kind:'op',token})],interruptible};
      }
      case 'cancelskip': if (!this.player) throw new Error('Player not connected'); this.player.setMode({ skip: 'none' }); break;
      case 'playvoice': if (!this.voices) throw new Error('Voices not connected'); await this.voices.playVoice({...p}); break;
      case 'stopvoice': if (!this.voices) throw new Error('Voices not connected'); if(typeof p.name==='string')this.voices.stopSpeaker(p.name);else this.voices.stopAll(); await this.voices.tick(); break;
      case 'noeffect': this.effectsEnabled=p.enabled===true||p.enabled===1n||p.enabled==='true';break;
      case 'exit':
        // NativeServices belongs to the main story only: kag.isRecollection is
        // false. Gallery movies have a separate owner, not a replay SCN session.
        if(this.originalRecollectionExit(command))return;
        if(this.originalTitleExit(command)) {
          const mako=this.afterstory==='mak'||command.location.asset==='0042';
          if(this.titleRequested||this.op?.active||!['clear',mako?'clear_mak':'clear_yos',mako?'ed2_mako':'ed1_yosh'].every(flag=>this.progress.hasMarker(flag)))throw Error('原标题退出未到达完整的原尾声边界');
          this.titleRequested=true;
        }
        this.exited = true; this.ui.hide(); break;
      default: unsupported(command);
    } return undefined;
  }
  handlers(): NativeCommandServices {
    const handler: CommandHandler = (command, mode) => this.run(command, mode);
    const result: Record<ServiceName, CommandHandler> = { meswinload: handler, scnchart: handler, chapter: handler, wait: handler, quickmenu: handler, beginskip: handler, sysvoice: handler, endskip: handler, endrecollection: handler, cancelskip: handler, sysmovie: handler, meswinchange: handler, msgoff: handler, playvoice: handler, stopvoice: handler, exit: handler, noeffect: handler };
    for (const name of serviceCommandNames) if (!result[name]) throw new Error('Missing service dispatcher'); return result;
  }
  capture(): PsbValue { return { schemaVersion: 1n, exited: this.exited, effectsEnabled: this.effectsEnabled }; }
  restore(value: PsbValue): void { const row = psbRecord(value); if (row.schemaVersion !== 1n || typeof row.exited !== 'boolean' || typeof row.effectsEnabled!=='boolean') throw new Error('Invalid saved native services'); this.exited = row.exited; this.effectsEnabled=row.effectsEnabled; }
}
