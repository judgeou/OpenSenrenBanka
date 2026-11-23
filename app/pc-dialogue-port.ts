import type {PcDialogueView} from './native-session-types.ts';
import type {NativeSessionDriver} from '../src/runtime/native-session-driver.ts';
import type {ScenePlayer} from '../src/runtime/scene-player.ts';
import type {NativeVoices} from './native-voices.ts';
import type {NativeWindow} from './ui/native-window.ts';

/** A read-only view of the actual story, plus queue-owned non-advancing actions. */
export function pcDialoguePort(ui:NativeWindow,ownedPlayer:ScenePlayer,voices:NativeVoices,driver:NativeSessionDriver,available:()=>boolean){
    const now=()=>driver.projectedTime;
    const pcDialogue = (): PcDialogueView => {
      const message=ui.activeMessage, wait=ownedPlayer.waiting, mode=ownedPlayer.playback;
      const visible=wait.kind==='dialogue'&&message.visible&&!ui.playerHidden&&message.key===wait.key;
      const canReplay=visible&&mode.skip==='none'&&wait.kind==='dialogue'&&(!wait.reveal||!wait.tokens.includes(wait.reveal));
      const voice=visible&&mode.skip==='none'?voices.normalProgress:undefined;
      let progress: PcDialogueView['progress'];
      if(voice!==undefined)progress={kind:mode.auto?'auto_voice':'voice',ratio:voice};
      else if(visible&&mode.auto&&wait.kind==='dialogue'&&mode.skip==='none'){
        const duration=wait.voiceAtReveal?wait.autoVoiceDelay:wait.autoDelay;
        const ratio=message.flow?.autoPage.progress??(wait.autoAt!==undefined&&duration>0?1-Math.min(1,Math.max(0,wait.autoAt-now())/duration):undefined);
        if(ratio!==undefined)progress={kind:'auto_wait',ratio};
      }
      const dialogue=canReplay?ownedPlayer.currentDialogue:undefined;
      return {hidden:ui.playerHidden,visible,replayable:Array.isArray(dialogue?.voices)&&dialogue.voices.length>0,
        variant:message.kind==='another'?'another':'default',key:visible?message.key:undefined,progress};
    };
    const changePcDialogue = (action:'hide'|'show'|'replay') => driver.action(async () => {
      if(ownedPlayer.clock.snapshot().paused||driver.awaitingPresentation||!available())return;
      if(action==='show'){if(ui.playerHidden)ui.setPlayerHidden(false);return;}
      if(ownedPlayer.waiting.kind!=='dialogue'||!pcDialogue().visible)return;
      if(action==='hide'){ownedPlayer.setMode({auto:false,skip:'none'});ui.setPlayerHidden(true);return;}
      const dialogue=ownedPlayer.currentDialogue;
      if(dialogue&&pcDialogue().replayable){ownedPlayer.setMode({auto:false,skip:'none'});await voices.play(dialogue.voices,false);}
    });

    return {pcDialogue,changePcDialogue};
}
