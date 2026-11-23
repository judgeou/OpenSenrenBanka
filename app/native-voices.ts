import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import { nativeNumber, nativeBoolean } from '../src/world/native-values.ts';
import type { AudioCatalog } from '../src/audio/audio-catalog.ts';
import type { WebAudioEngine, AudioEvent, AudioTrackSnapshot } from '../src/audio/web-audio-engine.ts';
import { audioTrackSnapshot } from '../src/audio/audio-snapshot.ts';
import { nativeLoopRange } from '../src/audio/native-loop-range.ts';
import type { VoiceSignals } from '../src/world/voice-signals.ts';
import type { CommandBlock } from '../src/runtime/types.ts';
import type { SessionWaits } from './session-waits.ts';
import type { SessionAudioPolicy } from './session-audio-policy.ts';
import { sessionData } from './session-data.ts';
type VoiceRequest = Omit<Parameters<WebAudioEngine['play']>[0], 'token'>;
const loopVoicePrefix = 'voice/$loop/';
const loopVoiceChannel = (channel: string): boolean => channel.startsWith(loopVoicePrefix);
function audioEvent(value: PsbValue): AudioEvent {
  const row = psbRecord(value), channel = row.channel, token = row.token;
  if (typeof channel !== 'string' || !channel.startsWith('voice/') || typeof token !== 'string' || !token) throw new Error('Invalid saved voice event identity');
  if (row.kind === 'ended' && (row.reason === 'natural' || row.reason === 'stopped')) return { kind: 'ended', channel, token, reason: row.reason };
  if (row.kind === 'label' && typeof row.name === 'string' && row.name.length <= 16384 && typeof row.time === 'number' && Number.isFinite(row.time) && row.time >= 0 && typeof row.ordinal === 'number' && Number.isSafeInteger(row.ordinal) && row.ordinal >= 1) return { kind: 'label', channel, token, name: row.name, time: row.time, ordinal: row.ordinal };
  throw new Error('Invalid saved voice event');
}
/** Only this queue-owned object consumes body-voice transport events and registers resulting host blocks. */
export class NativeVoices {
  private serial = 0; private readonly active = new Map<string, string>(); private queued: AudioEvent[] = [];
  constructor(private readonly audio: WebAudioEngine, private readonly catalog: AudioCatalog,
    private readonly policy: SessionAudioPolicy, private readonly signals: VoiceSignals,
    private readonly waits: SessionWaits, private readonly accept: (block: CommandBlock) => void) {}
  current(channel: string, token: string): boolean { return this.active.get(channel) === token && this.audio.channels.includes(channel); }
  get normalPlaying(): boolean { return [...this.active].some(([channel, token]) => !loopVoiceChannel(channel) && this.current(channel, token)); }
  /** Only live, non-loop story voice transports contribute to the progress bar. */
  get normalProgress(): number | undefined {
    let best: {position:number;duration:number} | undefined;
    for (const [channel, token] of this.active) {
      if (loopVoiceChannel(channel)) continue;
      const track = this.audio.playbackProgress(channel, token);
      if (track && (!best || track.duration - track.position > best.duration - best.position)) best = track;
    }
    return best && best.position / best.duration;
  }
  stop(channel: string, token: string): void { if (this.active.get(channel) === token) { this.audio.stop(channel); this.active.delete(channel); } }
  stopAll(): void { for (const [channel, token] of this.active) this.stop(channel, token); }
  stopNormal(): void { for (const [channel, token] of this.active) if (!loopVoiceChannel(channel)) this.stop(channel, token); }
  stopSpeaker(name: string): void {
    for (const channel of ['voice/' + name, loopVoicePrefix + name]) {
      const token = this.active.get(channel); if (token) this.stop(channel, token);
    }
  }
  private descriptors(value: PsbValue, explicit = false): VoiceRequest[] {
    if (value === null) return []; if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid original voice list');
    const result: VoiceRequest[] = [], channels = new Set<string>();
    for (const item of value) {
      const row = psbRecord(item);
      for (const key of Object.keys(row)) if (!['name', 'voice', 'type', 'pan', 'noflip', 'fade', 'loop'].includes(key)) throw new Error('Unimplemented original voice field: ' + key);
      if (typeof row.name !== 'string' || !row.name || typeof row.voice !== 'string' || !row.voice) throw new Error('Invalid original voice identity');
      const type = nativeNumber(row.type, 0), loop = nativeNumber(row.loop, 0), looping = explicit && type === 2 && loop === 1;
      if (!looping && (type !== 0 || loop !== 0) || row.name.startsWith('$loop/') || looping && !/^[^/]{1,128}$/u.test(row.name)) throw new Error('Unsupported original voice mode: ' + row.voice);
      nativeBoolean(row.noflip); // Original compiled pan is preserved; fresh normal-session reverse mode is off.
      const asset = this.catalog.resolve(row.voice), channel = (looping ? loopVoicePrefix : 'voice/') + row.name;
      if (channels.has(channel)) throw new Error('Duplicate original voice speaker: ' + row.voice);
      const sidecar=asset.nonLoopSidecar;
      if(sidecar!==undefined){
        if(looping||!sidecar||typeof sidecar!=='object'||!('sha256' in sidecar)||!('bytes' in sidecar)||!('codec' in sidecar)||
          !this.catalog.entries.some(other=>other.id!==asset.id&&other.name!==asset.name&&other.sha256===sidecar.sha256&&other.bytes===sidecar.bytes&&other.codec===sidecar.codec))throw new Error('Original voice has an unclassified sidecar: '+row.voice);
      }
      // A mislabeled Ogg payload belonging to another separately indexed voice
      // is not an SLI program. Keep this request's primary original audio.
      const gain = this.policy.voiceGain(asset.name, row.name) * nativeNumber(row.fade, 100) / 100, pan = nativeNumber(row.pan, 0) / 100;
      if (!Number.isFinite(gain) || gain < 0 || gain > 16 || !Number.isFinite(pan) || Math.abs(pan) > 1) throw new Error('Original voice gain/pan exceeds transport contract');
      channels.add(channel); result.push({ channel, storage: asset.name, gain, pan, loop: nativeLoopRange(asset, looping) });
    }
    if (!Number.isSafeInteger(this.serial + result.length)) throw new Error('Voice playback identities exhausted'); return result;
  }
  preflight(value: PsbValue): void { this.descriptors(value); }
  preflightPlayVoice(parameters: PsbValue): void { this.descriptors([parameters], true); }
  async playVoice(parameters: PsbValue): Promise<void> { await this.start(this.descriptors([parameters], true)); }
  async play(value: PsbValue, waitForEnd = true): Promise<readonly string[]> {
    const requests = this.descriptors(value);
    await this.start(requests);
    return waitForEnd ? this.waitTokens() : [];
  }
  private async start(requests: readonly VoiceRequest[]): Promise<void> {
    // A body line replaces normal voices only; the explicit type-2 channel has
    // its own authored lifetime and can coexist without becoming a dialogue wait.
    if (requests.some(request => !request.loop)) { this.stopNormal(); await this.tick(); }
    for (const request of requests) {
      const old = this.active.get(request.channel);
      if (old) { this.stop(request.channel, old); await this.tick(); }
      const token = 'voice-play/' + ++this.serial; await this.audio.play({ ...request, token }); this.active.set(request.channel, token);
      for (const block of await this.signals.start(request.channel, token)) this.accept(block);
    }
  }
  waitTokens(): readonly string[] {
    const result: string[] = [];
    for (const [channel, playbackToken] of this.active) {
      if (loopVoiceChannel(channel) || !this.current(channel, playbackToken)) continue;
      const token = this.waits.findToken(wait => wait.kind === 'voice' && wait.channel === channel && wait.playbackToken === playbackToken)
        ?? this.waits.add({ kind: 'voice', channel, playbackToken });
      if (token) result.push(token);
    } return result;
  }
  async tick(): Promise<void> {
    const events = [...this.queued, ...this.audio.drainEvents()]; this.queued = [];
    for (const block of await this.signals.consume(events)) this.accept(block);
    for (const [channel, token] of this.active) if (!this.current(channel, token)) this.active.delete(channel);
  }
  capture(): PsbValue {
    const tracks = this.audio.capture().filter(track => this.active.get(track.request.channel) === track.request.token);
    this.queued.push(...this.audio.drainEvents().filter(event => event.channel.startsWith('voice/')));
    return sessionData({ schemaVersion: 2n, serial: this.serial, active: [...this.active].map(([channel, token]) => ({ channel, token })), tracks, signals: this.signals.capture(), queued: this.queued });
  }
  async restore(value: PsbValue): Promise<void> {
    const row = psbRecord(value);
    if (row.schemaVersion !== 2n || typeof row.serial !== 'number' || !Number.isSafeInteger(row.serial) || row.serial < 0 || !Array.isArray(row.active) || row.active.length > 64 || !Array.isArray(row.tracks) || !Array.isArray(row.signals) || !Array.isArray(row.queued) || row.queued.length > 100000) throw new Error('Invalid saved body-voice owner');
    if (this.active.size || this.queued.length || this.signals.capture().length) throw new Error('Voice restore requires unused ownership');
    const active = new Map<string, string>(), queued = row.queued.map(audioEvent), tracks: AudioTrackSnapshot[] = row.tracks.map(audioTrackSnapshot);
    for (const item of row.active) { const itemRow = psbRecord(item), channel = itemRow.channel, token = itemRow.token;
      if (typeof channel !== 'string' || !channel.startsWith('voice/') || typeof token !== 'string' || !token || active.has(channel)) throw new Error('Invalid saved body-voice channel'); active.set(channel, token); }
    const ended = (channel: string, token: string) => queued.some(event => event.kind === 'ended' && event.channel === channel && event.token === token);
    const restored = new Set<string>();
    for (const track of tracks) { const { channel, token } = track.request;
      const looping = loopVoiceChannel(channel), saved = track.request.loop;
      if (!token || active.get(channel) !== token || restored.has(channel) || looping !== !!saved) throw new Error('Saved voice track has no unique supported owner');
      if (saved) {
        const asset = this.catalog.resolve(track.request.storage), range = nativeLoopRange(asset, true);
        if (asset.nonLoopSidecar !== undefined || !range || saved.start !== range.start || saved.end !== range.end) throw new Error('Saved voice loop differs from the original audio range');
      }
      restored.add(channel);
    }
    for (const [channel, token] of active) if (!restored.has(channel) && !ended(channel, token)) throw new Error('Saved voice has neither live transport nor completion');
    const seenSignals = new Set<string>(), signals = row.signals.map(item => { const signal = psbRecord(item), channel = signal.channel, token = signal.token;
      if (typeof channel !== 'string' || !channel.startsWith('voice/') || typeof token !== 'string' || !token || seenSignals.has(channel) || active.get(channel) !== token && !ended(channel, token)) throw new Error('Saved voice subscription has no unique owner'); seenSignals.add(channel); return { channel, token }; });
    this.serial = row.serial; for (const [channel, token] of active) this.active.set(channel, token);
    for (const track of tracks) await this.audio.restoreTrack(track);
    this.signals.restore(signals); this.queued = queued;
  }
}
