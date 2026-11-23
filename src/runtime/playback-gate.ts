export interface PlaybackMode { skip: 'none' | 'read' | 'all'; auto: boolean; autoDelay: number; characterDelay: number }
export type PlaybackWait =
  | { kind: 'none' }
  | { kind: 'time'; until: number; skippable: boolean }
  | { kind: 'external'; tokens: string[]; interruptible: boolean }
  | { kind: 'dialogue'; key: string; wasRead: boolean; reveal: string | undefined; tokens: string[]; voiceTokens: string[]; voiceAtReveal: boolean | undefined; autoVoiceDelay: number; autoDelay: number; autoAt: number | undefined }
  | { kind: 'choice'; indices: number[] };
export function copyWait(wait: PlaybackWait): PlaybackWait {
  if (wait.kind === 'dialogue') return { ...wait, tokens: [...wait.tokens], voiceTokens: [...wait.voiceTokens] };
  if (wait.kind === 'external') return { ...wait, tokens: [...wait.tokens] };
  if (wait.kind === 'choice') return { ...wait, indices: [...wait.indices] }; return { ...wait };
}
export function validateWait(wait: PlaybackWait): void {
  if (!wait || typeof wait !== 'object') throw new Error('Invalid playback wait');
  const time = (value: number) => Number.isFinite(value) && value >= 0;
  if (wait.kind === 'none') return;
  if (wait.kind === 'time') { if (time(wait.until) && typeof wait.skippable === 'boolean') return; }
  else if (wait.kind === 'choice') { if (Array.isArray(wait.indices) && wait.indices.length <= 10000 && wait.indices.every(value => Number.isSafeInteger(value) && value >= 0)) return; }
  else if (wait.kind === 'external' || wait.kind === 'dialogue') {
    if (!Array.isArray(wait.tokens) || wait.tokens.length > 100000 || wait.tokens.some(value => typeof value !== 'string' || !value)) throw new Error('Invalid playback tokens');
    if (wait.kind === 'external' && typeof wait.interruptible === 'boolean') return;
    if (wait.kind === 'dialogue' && typeof wait.key === 'string' && typeof wait.wasRead === 'boolean' &&
        (wait.reveal === undefined || typeof wait.reveal === 'string') && Array.isArray(wait.voiceTokens) && wait.voiceTokens.length <= 256 && wait.voiceTokens.every(token => typeof token === 'string' && token !== '') &&
        (wait.voiceAtReveal === undefined || typeof wait.voiceAtReveal === 'boolean') && time(wait.autoVoiceDelay) && time(wait.autoDelay) && (wait.autoAt === undefined || time(wait.autoAt))) return;
  }
  throw new Error('Invalid playback wait state');
}
export class PlaybackGate {
  private state: PlaybackWait = { kind: 'none' };
  get wait(): PlaybackWait { return copyWait(this.state); }
  set(wait: PlaybackWait): void { validateWait(wait); this.state = copyWait(wait); }
  clear(): PlaybackWait { const previous = this.state; this.state = { kind: 'none' }; return copyWait(previous); }
  release(token: string): void {
    const state = this.state;
    if (state.kind === 'dialogue' && token === state.reveal && state.tokens.includes(token) && state.voiceAtReveal === undefined) state.voiceAtReveal = state.voiceTokens.some(value => state.tokens.includes(value));
    if (state.kind === 'external' || state.kind === 'dialogue') state.tokens = state.tokens.filter(value => value !== token);
  }
  ready(now: number, mode: PlaybackMode, renderSkippedDialogue=false): boolean {
    const state = this.state;
    if (state.kind === 'none') return true; if (state.kind === 'choice') return false;
    if (state.kind === 'time') return now >= state.until || mode.skip !== 'none' && state.skippable;
    if (state.kind === 'external') return state.tokens.length === 0 || mode.skip !== 'none' && state.interruptible;
    if (mode.skip === 'all' || mode.skip === 'read' && state.wasRead)
      return !renderSkippedDialogue || !state.reveal || !state.tokens.includes(state.reveal);
    if (state.tokens.length !== 0) return false;
    if (!mode.auto) { state.autoAt = undefined; return false; }
    // Original normal-auto uses page delay OR voice completion + voice delay, never both or a second typing duration.
    if (state.autoAt === undefined) state.autoAt = now + (state.voiceAtReveal ? state.autoVoiceDelay : state.autoDelay);
    return now >= state.autoAt;
  }
}
