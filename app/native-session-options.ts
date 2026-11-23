import type { SceneRestrictions } from '../src/runtime/scene-restrictions.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import type { AudioMix } from '../src/audio/edition-mix.ts';
import type {PrefetchPromotion} from '../src/runtime/resource-prefetch.ts';
export interface AfterstoryStart {readonly storage:string;readonly target:string;readonly label:'*after_yos'|'*after_mak'}
export type EntryProgress='resources'|'graphics'|'dialogue';
export type EntryObserver=(stage:EntryProgress,key?:string)=>void;
export interface NativeSessionOptions {
  readonly demand?: import('./native-session-work.ts').DemandObserver;
  readonly entryProgress?:EntryObserver;
  /** Required by released editions; old milestone snapshots keep their historical transport. */
  readonly streamingAudio?: boolean;
  readonly sceneHistory?: true | import('../src/runtime/live-scene-history.ts').LiveSceneHistory;
  readonly audioOutput?: AudioNode;
  readonly stageAudioHeld?:()=>boolean;
  readonly prefetchBytes?: number;
  readonly promotePrefetch?:PrefetchPromotion;
  readonly heldSkip?:()=>PlaybackMode['skip'];
  readonly restrictions?:SceneRestrictions;
  readonly afterstory?:AfterstoryStart;
  readonly mix?:AudioMix;
  readonly speeds?:Partial<Pick<PlaybackMode,'characterDelay'|'autoDelay'>>;
  readonly renderNamespace?:'yoshino-v1';
  /** CSS font-family list for editions that do not ship webfonts. */
  readonly systemFontFamily?: string;
  /** Presentation preferences belong to the edition, not the story snapshot. */
  readonly pcDialogue?: {readonly windowOpacity: () => number};
}
