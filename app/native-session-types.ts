import type { ScenePlayer } from '../src/runtime/scene-player.ts';
import type { NativeSessionFrame } from '../src/runtime/native-session-driver.ts';
import type { PlayerSnapshot, HistoryEntry } from '../src/runtime/types.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import type { ScriptValue } from '../src/script/types.ts';
import type {SessionPrefetch} from './session-prefetch.ts';
import type {MovieStatus} from './native-op.ts';
import type { OriginalStartup } from './original-startup.ts';

export interface SystemProgressData { readonly sf: Record<string, ScriptValue>; readonly read: readonly string[] }
export interface PcDialogueView {
  hidden: boolean;
  visible: boolean;
  replayable: boolean;
  variant?: 'default'|'another';
  key?: string;
  progress?: {kind:'voice'|'auto_voice'|'auto_wait'; ratio:number};
}
export interface NativeSession {
  readonly identity: string;
  historyAvailable?():boolean;
  historyBackdrop?(show:boolean):Promise<void>;
  sceneHistory?():import('../src/runtime/live-scene-history.ts').SceneHistoryRow[];
  historyPlan?(key:number):import('../src/runtime/live-scene-history.ts').ReplayPlan;
  restoreHistory?(plan:import('../src/runtime/live-scene-history.ts').ReplayPlan):Promise<void>;
  nextWake?(): import('./native-session-work.ts').StoryWake | undefined;
  invalidateSurface?(): void;
  systemRevision?(): string;
  start(): Promise<void>; restore(snapshot: PlayerSnapshot): Promise<void>;
  step(milliseconds: number): Promise<NativeSessionFrame>; advance(): Promise<void>;
  choose(session: object, generation: number, index: number): Promise<void>;
  choiceInput(session: object, generation: number, index: number): Promise<void>;
  choiceAppearance(session: object, generation: number, index: number, kind: 'enter' | 'leave' | 'focus' | 'blur' | 'press' | 'release' | 'cancel'): Promise<void>;
  mode(change: Partial<PlaybackMode>): Promise<void>; pause(value:boolean,reason:string,scope?:import('../src/runtime/native-session-driver.ts').PauseScope):Promise<void>;
  updateMix?():void;
  readonly prefetch?: Pick<SessionPrefetch,'stats'|'limit'>;
  save(): Promise<PlayerSnapshot>; saveWithThumbnail(): Promise<{snapshot:PlayerSnapshot;thumbnail:Blob}>; history(): readonly HistoryEntry[]; systemProgress(): SystemProgressData;
  view(): { readonly identity: string; readonly position: ScenePlayer['position']; readonly waiting: ScenePlayer['waiting']; readonly mode: Readonly<PlaybackMode>; readonly paused: boolean; readonly awaitingPresentation: boolean; readonly startup: OriginalStartup['state']; readonly saveReason: string | undefined; readonly menu: {opacity:number;interactive:boolean}; readonly scriptSkipWindow: boolean; readonly audioChannels: readonly string[];readonly returnToTitle:boolean; readonly movie?:MovieStatus };
  pcDialogue?(): PcDialogueView;
  changePcDialogue?(action:'hide'|'show'|'replay'): Promise<void>;
  inspect(): Promise<unknown>; close(): Promise<void>;
}
