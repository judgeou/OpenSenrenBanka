import type { PsbValue } from '../formats/psb-value.ts';
import type { ScriptSnapshot } from '../script/state.ts';
import type { ClockSnapshot } from './clock.ts';
import type { PlaybackMode, PlaybackWait } from './playback-gate.ts';
import type { RuntimeCommand, RuntimeLocation } from '../scenario/invocation.ts';
import type { Choice, SceneFlow } from '../scenario/flow.ts';
import type { CheckpointView } from '../scenario/semantics.ts';

export interface RuntimeDialogue {
  readonly key: string; readonly speaker: PsbValue; readonly displayName: PsbValue; readonly body: string;
  readonly voices: PsbValue; readonly flags: bigint; readonly lastInScene: boolean; readonly location: RuntimeLocation;
}
export interface DialogueTicket { readonly revealToken?: string; readonly voiceTokens: readonly string[]; readonly autoVoiceDelay?: number }
export interface CommandBlock { readonly tokens: readonly string[]; readonly interruptible: boolean }
export interface SceneBridge {
  /** A fast line must retain its reveal token until a real message frame. */
  readonly renderSkippedDialogue?:boolean;
  command(command: RuntimeCommand, mode: Readonly<PlaybackMode>): Promise<CommandBlock | undefined>;
  dialogue(dialogue: RuntimeDialogue, mode: Readonly<PlaybackMode>): Promise<DialogueTicket>;
  /** Original delaydone/afterpage boundary; called once, including read-skip. */
  completeDialogue(key: string, mode: Readonly<PlaybackMode>): Promise<void>;
  checkpoint(value: CheckpointView, location: RuntimeLocation): Promise<void>;
  marker(value: string, location: RuntimeLocation): Promise<void>;
  choices(choices: readonly Choice[], info: SceneFlow['selectInfo'], location: RuntimeLocation): Promise<void>;
  /** True only when the entire message is complete and its terminal pixels were presented. */
  revealDialogue(token: string): Promise<boolean>;
  cancelWait(tokens: readonly string[]): Promise<void>;
  captureWorld(): Promise<PsbValue>;
  restoreWorld(state: PsbValue): Promise<void>;
  /** Native onNext syncObject: reconcile membership/visibility without restarting music or resetting text context. */
  syncWorld(state: PsbValue): Promise<void>;
}
export interface HistoryEntry { readonly kind: 'dialogue' | 'choice'; readonly caption?: string; readonly key: string; readonly location: RuntimeLocation; readonly body: string; readonly speaker: PsbValue; readonly displayName: PsbValue; readonly voices: PsbValue }
export interface PlayerPosition { readonly asset: string; readonly scene: number; readonly cursor: number; readonly entered: boolean; readonly leaving: boolean; readonly nextIndex: number; readonly ended: boolean; readonly point: string | undefined; readonly stateRef: number | undefined; readonly currentText: string | undefined }
export interface PlayerSnapshot {
  readonly schemaVersion: 2; readonly position: PlayerPosition; readonly clock: ClockSnapshot; readonly script: ScriptSnapshot;
  readonly hostWaits: readonly CommandBlock[];
  readonly mode: PlaybackMode; readonly wait: PlaybackWait; readonly read: readonly string[]; readonly history: readonly HistoryEntry[]; readonly world: PsbValue;
}
export type PumpResult = { readonly kind: 'waiting'; readonly wait: PlaybackWait } | { readonly kind: 'yield' } | { readonly kind: 'ended' };
