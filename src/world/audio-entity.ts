import { clonePsbValue, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { WebAudioEngine } from '../audio/web-audio-engine.ts';
import { audioTrackSnapshot } from '../audio/audio-snapshot.ts';
import type { WorldEntity } from './entity-world.ts';
import type { EntityClassDefinition } from './class-catalog.ts';
import type { NativeProperties, PropertyTarget } from './native-properties.ts';
import { nativeBoolean, nativeNumber } from './native-values.ts';
export interface AudioEntityPolicy {
  readonly engine: WebAudioEngine; readonly properties: NativeProperties; now(): number;
  resolve(storage: string): string; evaluate(source: string): PsbValue; enabled(definition: EntityClassDefinition): boolean;
  busGain(name: string | undefined): number; fileGain(storage: string, className: string): number;
  startOffset(storage: string, start: PsbValue | undefined): number;
  loopRange(storage: string, looping: boolean): { readonly start: number; readonly end: number } | undefined;
  musicEvent(name: string, event: 'play' | 'stop' | 'pause' | 'resume', storage?: string): void;
}
interface Channel { id: string; storage: string; volume: number; fade: number; pan: number; start: number; looping: boolean; from: number; to: number; began: number; duration: number; stopAtEnd: boolean; paused: boolean; pauseAtEnd?: boolean }
let nextAudioEntity = 1;
function dataTree(value: unknown): PsbValue {
  if (value === undefined) return null; if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (Array.isArray(value)) return value.map(dataTree); if (typeof value !== 'object') throw new Error('Non-data audio state'); const result: { [key: string]: PsbValue } = Object.create(null);
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = dataTree(item); return result;
}
/** Actual music/sound entities; graph and device access starts only when a caller applies native updates. */
export class AudioEntity implements WorldEntity, PropertyTarget {
  readonly id: string; name: string; readonly classSpec: PsbValue; readonly kind: 'music' | 'sound';
  private readonly definition: EntityClassDefinition; private readonly policy: AudioEntityPolicy; private channels: Channel[] = []; private serial = 0;
  private filename = ''; private volume = 100; private looping = false; private fade = 100; private pitch = 100; private pan = 0;
  constructor(name: string, definition: EntityClassDefinition, policy: AudioEntityPolicy) {
    if (definition.kind !== 'music' && definition.kind !== 'sound') throw new Error('Non-audio class passed to audio entity');
    this.id = 'audio-entity-' + nextAudioEntity++; this.name = name; this.classSpec = definition.name; this.kind = definition.kind; this.definition = definition; this.policy = policy; policy.properties.attach(this);
  }
  async initialize(): Promise<void> { if (this.kind === 'sound') this.stop(0); }
  async dispose(): Promise<void> { this.stop(0); this.policy.properties.detach(this); }
  async rename(name: string): Promise<void> { this.name = name; }
  read(property: string): PsbValue | undefined { if (property === 'fade') return this.fade; if (property === 'pitch') return this.pitch; if (property === 'pan') return this.pan; throw new Error('Unknown audio property: ' + property); }
  write(property: string, value: PsbValue): void {
    const number = nativeNumber(value), current = this.channels.at(-1);
    if (property === 'fade') { this.fade = number; if (current) current.fade = number; } else if (property === 'pan') { this.pan = number; if (current) current.pan = number; }
    else if (property === 'pitch') { this.pitch = number; if (current && this.policy.engine.channels.includes(current.id)) this.policy.engine.setRate(current.id, number/100); }
    else throw new Error('Unsupported audio property: ' + property); this.tick();
  }
  private event(event: 'play' | 'stop' | 'pause' | 'resume', storage?: string): void { if (this.definition.event) this.policy.musicEvent(this.name, event, storage); }
  private visibility(channel: Channel, now = this.policy.now()): number {
    if (channel.duration <= 0 || now >= channel.began+channel.duration) return channel.to; const t = Math.max(0, (now-channel.began)/channel.duration); return channel.from+(channel.to-channel.from)*t;
  }
  private gain(channel: Channel): number {
    return Math.max(0, channel.volume/100 * channel.fade/100 * this.visibility(channel) * this.policy.busGain(this.definition.volumeName) * this.policy.fileGain(channel.storage, this.definition.name));
  }
  tick(): void {
    const now = this.policy.now();
    for (const channel of [...this.channels]) {
      if (!this.policy.engine.channels.includes(channel.id)) { this.channels = this.channels.filter(item => item !== channel); continue; }
      if (channel.stopAtEnd && now >= channel.began+channel.duration) { this.policy.engine.stop(channel.id); this.channels = this.channels.filter(item => item !== channel); continue; }
      if (channel.pauseAtEnd && now >= channel.began+channel.duration) { this.policy.engine.pause(channel.id); channel.paused = true; channel.pauseAtEnd = false; }
      this.policy.engine.setGain(channel.id, this.gain(channel)); this.policy.engine.setPan(channel.id, Math.max(-1, Math.min(1, channel.pan/100)));
    }
  }
  private fadeOut(channel: Channel, time: number): void { channel.from = this.visibility(channel); channel.to = 0; channel.began = this.policy.now(); channel.duration = time; channel.stopAtEnd = true; if (time === 0) this.policy.engine.stop(channel.id); }
  private stop(time: number): void { for (const channel of this.channels) this.fadeOut(channel, time); this.tick(); this.event('stop'); }
  private storage(value: PsbValue | undefined): string {
    if (value === undefined || value === null || value === '') return ''; if (typeof value !== 'string') throw new Error('Invalid native sound filename');
    const evaluated = value.startsWith('&') ? this.policy.evaluate(value.slice(1)) : value; if (typeof evaluated !== 'string') throw new Error('Sound expression did not return a filename'); return evaluated==='' ? '' : this.policy.resolve(evaluated);
  }
  private async play(replay: { [key: string]: PsbValue }, transitionTime: number): Promise<void> {
    const volume = nativeNumber(replay.volume, 100), looping = this.kind === 'music' && nativeBoolean(replay.loop);
    // The original BGM double buffer fades its old source before playBuffer
    // logs this authored missing storage and returns. No replacement clip.
    if(this.kind==='music'&&this.name==='lse'&&replay.filename==='fade-50'&&transitionTime===1000&&looping&&volume===100&&replay.start===null&&nativeNumber(replay.state,-1)===1){
      this.stop(transitionTime);this.filename=replay.filename;this.volume=volume;this.looping=looping;
      console.warn('Original lse storage fade-50 is absent; retained the authored 1000ms outgoing fade');return;
    }
    const storage = this.storage(replay.filename); if (!storage || this.kind === 'sound' && this.definition.skipSound && !this.policy.enabled(this.definition)) return;
    const changed = storage !== this.filename || volume !== this.volume || looping !== this.looping;
    if (this.kind === 'music' && !changed && this.channels.some(channel => !channel.stopAtEnd && this.policy.engine.channels.includes(channel.id))) return;
    while (this.kind === 'sound' && this.channels.length >= this.definition.tracks) { const oldest = this.channels.shift()!; this.policy.engine.stop(oldest.id); }
    const now = this.policy.now(), id = this.id + '/' + ++this.serial, offset = this.policy.startOffset(storage, replay.start);
    const time = this.kind === 'sound' ? nativeNumber(replay.time, 0) : transitionTime;
    const channel: Channel = { id, storage, volume, fade: this.fade, pan: this.pan, start: offset, looping, from: time > 0 ? 0 : 1, to: 1, began: now, duration: time, stopAtEnd: false, paused: false };
    const loop=this.policy.loopRange(storage,looping), gain=this.gain(channel);
    // A third BGM would immediately evict the previous outgoing track. Release its
    // PCM lease before decoding the replacement; keep the current audible track.
    if(this.kind==='music') while(this.channels.length>=2&&this.channels[0].stopAtEnd) this.policy.engine.stop(this.channels.shift()!.id);
    await this.policy.engine.play({ channel: id, token: id, storage, offset, gain, pan: Math.max(-1, Math.min(1, this.pan/100)), rate: this.pitch/100, loop });
    if (this.kind === 'music') {
      while (this.channels.length >= 2) this.policy.engine.stop(this.channels.shift()!.id);
      for (const previous of this.channels) this.fadeOut(previous, transitionTime);
    }
    channel.began = this.policy.now(); this.filename = storage; this.volume = volume; this.looping = looping;
    this.channels.push(channel); this.tick(); this.event('play', storage);
  }
  async playMotionEffect(storage: string, volume: number): Promise<boolean> {
    if (this.kind!=='sound') throw new Error('Original motion SE requires a sound entity');
    const serial=this.serial;
    await this.play({filename:storage, volume, start:null, time:0},0);
    return this.serial!==serial;
  }
  async update(parameters: Readonly<{ [key: string]: PsbValue }>, restoring = false): Promise<void> {
    const trans = parameters.trans === undefined || parameters.trans === null ? undefined : psbRecord(parameters.trans), duration = restoring ? 0 : nativeNumber(trans?.time, 0);
    if (this.kind === 'sound' && parameters.stop !== undefined && parameters.replay === undefined) this.stop(nativeNumber(parameters.stop, 0));
    if (parameters.replay !== undefined && parameters.replay !== null) {
      const replay = psbRecord(parameters.replay), state = nativeNumber(replay.state, -1);
      if (this.kind === 'sound') await this.play(replay, duration);
      else if (state === 0) this.stop(duration);
      else if (state === 1 || state === 2) { await this.play(replay, state === 2 ? 0 : duration); if (state === 2) for (const channel of this.channels) { this.policy.engine.pause(channel.id); channel.paused = true; } }
      else if (state !== -1) throw new Error('Unknown native music replay state');
    }
    if (parameters.update !== undefined && parameters.update !== null) {
      const state = nativeNumber(psbRecord(parameters.update).state, 0);
      for (const channel of this.channels) {
        if (state === 1) { this.policy.engine.resume(channel.id); channel.paused = false; channel.pauseAtEnd = false; channel.from = this.visibility(channel); channel.to = 1; channel.began = this.policy.now(); channel.duration = duration; }
        else if (state === 2) { channel.from = this.visibility(channel); channel.to = 0; channel.began = this.policy.now(); channel.duration = duration; channel.pauseAtEnd = true; }
      } this.tick();
      if (state === 1) this.event('resume', this.filename); else if (state === 2) this.event('pause');
    }
    this.policy.properties.before(this, parameters.action);
  }
  async after(parameters: Readonly<{ [key: string]: PsbValue }>): Promise<void> { this.policy.properties.after(this, parameters.action); this.tick(); }
  async capture(): Promise<PsbValue> {
    this.tick(); const ids = new Set(this.channels.map(channel => channel.id));
    return { schemaVersion: 2n, serial: this.serial, propertyId: this.id, filename: this.filename, volume: this.volume, looping: this.looping, fade: this.fade, pitch: this.pitch, pan: this.pan, channels: dataTree(this.channels.map(channel => ({ ...channel, from: this.visibility(channel), began: 0, duration: Math.max(0, channel.began+channel.duration-this.policy.now()) }))),
      tracks: dataTree(this.policy.engine.capture().filter(track => ids.has(track.request.channel))) };
  }
  async restore(value: PsbValue): Promise<void> {
    const state = psbRecord(value); if (state.schemaVersion === undefined) { await this.update(state, true); await this.after(state); return; }
    if (state.schemaVersion !== 2n || typeof state.serial !== 'number' || !Number.isSafeInteger(state.serial) || state.serial < 0) throw new Error('Invalid/incompatible audio entity state');
    this.serial = state.serial;
    if (typeof state.propertyId === 'string') this.policy.properties.bindSavedTarget(state.propertyId, this);
    this.stop(0); if (!Array.isArray(state.channels) || !Array.isArray(state.tracks)) throw new Error('Invalid audio entity state');
    this.filename = typeof state.filename === 'string' ? state.filename : ''; this.volume = nativeNumber(state.volume); this.looping = nativeBoolean(state.looping); this.fade = nativeNumber(state.fade); this.pitch = nativeNumber(state.pitch); this.pan = nativeNumber(state.pan);
    this.channels = state.channels.map(value => { const item = psbRecord(value); return { id: String(item.id), storage: String(item.storage), volume: nativeNumber(item.volume), fade: nativeNumber(item.fade, 100), pan: nativeNumber(item.pan, 0), start: nativeNumber(item.start), looping: nativeBoolean(item.looping), from: nativeNumber(item.from), to: nativeNumber(item.to), began: this.policy.now(), duration: nativeNumber(item.duration), stopAtEnd: nativeBoolean(item.stopAtEnd), paused: nativeBoolean(item.paused), pauseAtEnd: nativeBoolean(item.pauseAtEnd) }; });
    const tracks = state.tracks.map(audioTrackSnapshot), names = new Set(this.channels.map(channel => channel.id));
    if (names.size !== this.channels.length || new Set(tracks.map(track => track.request.channel)).size !== tracks.length || tracks.some(track => !names.has(track.request.channel) || track.request.token !== track.request.channel)) throw new Error('Saved entity audio ownership differs');
    for (const track of tracks) await this.policy.engine.restoreTrack(track); this.tick();
  }
}
