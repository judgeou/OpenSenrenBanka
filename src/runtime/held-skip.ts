import type {PlaybackMode,PlaybackWait} from './playback-gate.ts';

/** Keys overlay the base playback settings; never persisted or handed to script-skip windows. */
export function withHeldSkip(base:PlaybackMode,held:PlaybackMode['skip'],wait:PlaybackWait,upcomingRead?:boolean):Readonly<PlaybackMode> {
  if(held==='none')return {...base};
  const blocked=wait.kind==='choice'||wait.kind==='external'&&!wait.interruptible;
  const read=upcomingRead??(wait.kind!=='dialogue'||wait.wasRead);
  return {...base,auto:false,skip:blocked||held==='read'&&!read?'none':held};
}
