import type { PsbNode, PsbProperty } from '../formats/psb2/types.ts';

export type PsbRef = number;
interface EventSource { readonly sourceRef: PsbRef; readonly sourceIndex: number }
export type CommandPartKey =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: string; readonly storageBytes: number }
  | { readonly kind: 'reference'; readonly psbKind: PsbNode['kind']; readonly sourceRef: PsbRef };
export interface CommandPart {
  readonly key: CommandPartKey;
  readonly keyRef: PsbRef;
  readonly argumentRef: PsbRef;
}
export type ScenarioEvent =
  | (EventSource & { readonly kind: 'record'; readonly recordId: string; readonly variant: number;
      readonly stateSlot: PsbRef; readonly stateKind: PsbNode['kind']; readonly slots: readonly PsbRef[] })
  | (EventSource & { readonly kind: 'text'; readonly externalId: string; readonly textIndex: number; readonly textRef: PsbRef })
  | (EventSource & { readonly kind: 'command'; readonly target: string;
      readonly parts: readonly CommandPart[]; readonly slots: readonly PsbRef[] })
  | (EventSource & { readonly kind: 'marker'; readonly value: string })
  | (EventSource & { readonly kind: 'opaque'; readonly psbKind: PsbNode['kind']; readonly reason: string });

export interface TextRecord { readonly sourceRef: PsbRef; readonly slots: readonly PsbRef[] }
export interface SceneIndex {
  readonly sourceRef: PsbRef;
  readonly label: string | null;
  readonly fields: readonly PsbProperty[];
  readonly texts: readonly TextRecord[];
  readonly events: readonly ScenarioEvent[];
}
export interface SceneDiagnostic {
  readonly scene: number; readonly sourceIndex: number; readonly sourceRef: number; readonly message: string;
}
export interface ScenarioIndex {
  readonly schemaVersion: 2;
  readonly sourceFormat: 'PSB2';
  readonly rootRef: number;
  readonly name: string | null;
  readonly rootFields: readonly PsbProperty[];
  readonly scenes: readonly SceneIndex[];
  readonly diagnostics: readonly SceneDiagnostic[];
}
export interface DialogueView {
  readonly metadata: TextRecord;
  readonly speaker: PsbNode | undefined;
  readonly displayName: PsbNode | undefined;
  readonly body: PsbNode | undefined;
  readonly voiceData: PsbNode | undefined;
  readonly attributes: PsbNode | undefined;
  readonly restoreState: PsbNode | undefined;
}
