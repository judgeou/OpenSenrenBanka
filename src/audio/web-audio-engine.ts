import type {AudioCatalog} from './audio-catalog.ts';
import {LegacyBufferTrack} from './legacy-buffer-track.ts';
import {StreamTrack} from './stream-track.ts';
import {findAudioRange} from './stream-catalog.ts';
import type {DecodedAudioRange} from './stream-catalog.ts';
import { EditionMix } from './edition-mix.ts';
import type { AudioMix } from './edition-mix.ts';
import { audioTimeline } from './audio-timeline.ts';
import { audioLabelsBetween, nextAudioLabel } from './audio-labels.ts';
import type { AudioTimeline } from './audio-timeline.ts';
export interface AudioPlay { readonly channel: string; readonly token: string; readonly storage: string; readonly offset?: number; readonly gain?: number; readonly pan?: number; readonly rate?: number; readonly loop?: { readonly start: number; readonly end: number } }
export type AudioEvent = { readonly kind: 'label'; readonly channel: string; readonly token: string; readonly name: string; readonly time: number; readonly ordinal: number } | { readonly kind: 'ended'; readonly channel: string; readonly token: string; readonly reason: 'natural' | 'stopped' };
export interface AudioTrackSnapshot { readonly request: AudioPlay; readonly position: number; readonly paused: boolean; readonly gain: number; readonly pan: number; readonly gainRamp?: { readonly to: number; readonly remaining: number }; readonly panRamp?: { readonly to: number; readonly remaining: number } }
interface Ramp { from: number; to: number; start: number; end: number }
interface Track { request: AudioPlay; loop?: AudioPlay['loop']; transport: StreamTrack | LegacyBufferTrack; release():void; duration:number; timeline: AudioTimeline; gain: GainNode; pan: StereoPannerNode; offset: number; cursor: number; include: boolean; paused: boolean; gainRamp: Ramp; panRamp: Ramp; suspendedGain?: { to: number; remaining: number }; suspendedPan?: { to: number; remaining: number } }
function rampValue(ramp: Ramp, time: number): number { return time >= ramp.end ? ramp.to : time <= ramp.start ? ramp.from : ramp.from + (ramp.to-ramp.from) * (time-ramp.start)/(ramp.end-ramp.start); }
function rate(request: AudioPlay): number { return request.rate ?? 1; }
/** Web Audio transport only. Native conditional SLI link policy remains an explicit caller decision. */
export class WebAudioEngine {
  private readonly context: AudioContext; private readonly catalog: AudioCatalog; private readonly output: GainNode;
  private readonly tracks = new Map<string, Track>(); private readonly versions = new Map<string, number>(); private events: AudioEvent[] = [];
  private readonly loading=new Map<string,AbortController>();
  private readonly mix?:EditionMix;
  constructor(context: AudioContext, catalog: AudioCatalog, destination: AudioNode = context.destination, levels?:AudioMix, private readonly changed?:()=>void) { this.context = context; this.catalog = catalog; this.output = context.createGain(); this.output.connect(destination); if(levels)this.mix=new EditionMix(context,this.output,levels); }
  updateMix():void {this.mix?.tick();}
  async unlock(): Promise<void> { await this.context.resume(); }
  get channels(): readonly string[] { return [...this.tracks.keys()]; }
  drainEvents(): readonly AudioEvent[] { const events = this.events; this.events = []; return events; }
  async play(request: AudioPlay): Promise<void> {
    if (!request.channel || !request.token || !request.storage || !Number.isFinite(rate(request)) || rate(request) <= 0 || rate(request) > 32 ||
        !Number.isFinite(request.gain ?? 1) || (request.gain ?? 1) < 0 || (request.gain ?? 1) > 16 || !Number.isFinite(request.pan ?? 0) || Math.abs(request.pan ?? 0) > 1) throw new Error('Invalid audio playback request');
    this.loading.get(request.channel)?.abort();
    const loading=new AbortController();this.loading.set(request.channel,loading);
    const version=(this.versions.get(request.channel)??0)+1;this.versions.set(request.channel,version);
    let release=()=>{},owned:Track|undefined;
    try {
      const metadata=this.catalog.resolve(request.storage),stream=this.catalog.stream;
      const lease=stream?undefined:await this.catalog.acquire(request.storage);
      if(lease)release=lease.release;
      let duration=lease?.buffer.duration??metadata.duration;const sr=lease?.buffer.sampleRate??metadata.sampleRate;
      const boundary=(value:number)=>value===metadata.duration&&value>duration&&value-duration<=1/sr?duration:value;
      const offset=boundary(request.offset??0),loop=request.loop&&{start:boundary(request.loop.start),end:boundary(request.loop.end)};
      if(!Number.isFinite(offset)||offset<0||offset>duration)throw Error('Audio offset exceeds duration');
      if(loop&&(!Number.isFinite(loop.start)||!Number.isFinite(loop.end)||loop.start<0||loop.end<=loop.start||loop.end>duration))throw Error('Audio loop exceeds original duration');
      let position=loop&&offset>=loop.end?loop.start+(offset-loop.start)%(loop.end-loop.start):offset;
      let initial:DecodedAudioRange|undefined;
      if(stream&&position<duration){
        const points=stream.points(metadata),frame=Math.round(position*metadata.sampleRate),i=findAudioRange(points,frame);
        if(i<points.length)initial=await stream.load(metadata,i,loading.signal,true);
        if(initial&&points.length===1&&initial.last<points[0][1]){
          duration=initial.last/sr;
          if(loop){
            if(loop.end===metadata.duration)loop.end=duration;
            if(loop.start>=loop.end||loop.end>duration)throw Error('Authored loop exceeds native Vorbis EOF');
          }
          position=loop&&position>=loop.end?loop.start+(position-loop.start)%(loop.end-loop.start):Math.min(position,duration);
          if(position===duration)initial=undefined;
        }
      }
      loading.signal.throwIfAborted();
      if(this.versions.get(request.channel)!==version)throw Error('Audio request superseded');
      const gain=this.context.createGain(),pan=this.context.createStereoPanner(),now=this.context.currentTime;
      const transport=stream?new StreamTrack(this.context,stream,metadata,gain,duration,loop,this.changed&&((failed)=>{
         // A media-only refill need not wake story/UI (e.g. an unlabelled BGM loop).
         if(failed||owned&&Number.isFinite(this.trackDeadline(owned)))this.changed?.();
       })):new LegacyBufferTrack(this.context,gain,lease!,loop);
      const nativeTimeline=audioTimeline(metadata),timeline={links:nativeTimeline.links,labels:nativeTimeline.labels.map(label=>label.time===metadata.duration?{...label,time:Math.min(label.time,duration)}:label)};
      this.remove(request.channel,'stopped');
      gain.gain.value=request.gain??1;pan.pan.value=request.pan??0;gain.connect(pan);pan.connect(this.mix?.output(request.channel,request.storage)??this.output);
      owned={request:{...request,loop:request.loop&&{...request.loop}},loop,transport,release,duration,timeline,gain,pan,offset:position,cursor:position,include:true,paused:false,
        gainRamp:{from:gain.gain.value,to:gain.gain.value,start:now,end:now},panRamp:{from:pan.pan.value,to:pan.pan.value,start:now,end:now}};
      this.tracks.set(request.channel,owned);
      if(transport instanceof StreamTrack)transport.open(position,rate(request),initial,loading);
      else transport.open(position,rate(request));
    }catch(error){loading.abort();if(owned&&this.tracks.get(request.channel)===owned)this.remove(request.channel,'stopped');else release();throw error;}
    finally{if(this.loading.get(request.channel)===loading)this.loading.delete(request.channel);}
  }
  private total(track:Track):number {return track.paused?track.cursor:track.transport.sample();}
  position(channel: string): number | undefined {
    const track = this.tracks.get(channel); if (!track) return undefined; const total = this.total(track), loop = track.loop;
    return loop && total >= loop.end ? loop.start + (total-loop.end) % (loop.end-loop.start) : Math.min(total, track.duration);
  }
  /** Passive transport projection: no extra decode, wait, or audio event consumption. */
  playbackProgress(channel: string, token: string) {
    const track = this.tracks.get(channel);
    if (!track || track.request.token !== token || track.paused || track.loop || track.duration <= 0) return;
    const position = this.total(track);
    if (track.transport.ready && position < track.duration) return {position, duration: track.duration};
  }
  private emitLabels(track: Track, end: number): void {
    const loop = track.loop; if (!loop) end = Math.min(end, track.duration);
    for (const label of audioLabelsBetween(track.timeline, loop, Math.min(track.cursor, end), end, track.include)) this.events.push({ kind: 'label', channel: track.request.channel, token: track.request.token, name: label.name, time: label.time, ordinal: track.timeline.labels.indexOf(label) + 1 });
    track.cursor = end; track.include = false; if (this.events.length > 100000) throw new Error('Audio event backlog exceeded');
  }
  tick(): void {
    this.updateMix();
    for(const track of this.tracks.values()){
      if(track.paused)continue;
      track.transport.pump();const total=this.total(track);
      if(track.transport.ready)this.emitLabels(track,total);
      if(track.transport.finished){this.emitLabels(track,track.duration);this.remove(track.request.channel,'natural');}
    }
  }
  private trackDeadline(track:Track):number {
    if(track.paused)return Infinity;
    if(track.transport.finished)return this.context.currentTime;
    const begin=!track.transport.ready&&track.request.channel.startsWith('voice/')&&track.transport instanceof StreamTrack?track.transport.nextStart:Infinity;
    const reach=Math.min(nextAudioLabel(track.timeline,track.loop,track.cursor,track.include),track.loop?Infinity:track.duration);
    return Number.isFinite(reach)?Math.min(begin,track.transport.scheduledAt(reach)):begin;
  }
  /** PCM prebuffering stays separate. Only story-facing audio deadlines wake the session. */
  nextWake(): number {
    if (this.context.state !== 'running') return Infinity;
    const now=this.context.currentTime; let due=Infinity;
    for (const track of this.tracks.values())due=Math.min(due,this.trackDeadline(track));
    return Number.isFinite(due)?Math.max(3,Math.ceil((due-now)*1000)+3):Infinity;
  }
  pause(channel: string): void {
    const track = this.tracks.get(channel); if (!track || track.paused) return; this.emitLabels(track, this.total(track));
    const position = this.position(channel)!; track.transport.stop();
    const now = this.context.currentTime;
    for (const property of ['gain', 'pan'] as const) {
      const ramp = property === 'gain' ? track.gainRamp : track.panRamp, value = rampValue(ramp, now), parameter = property === 'gain' ? track.gain.gain : track.pan.pan;
      const suspended = ramp.end > now ? { to: ramp.to, remaining: ramp.end-now } : undefined;
      parameter.cancelScheduledValues(now); parameter.setValueAtTime(value, now);
      if (property === 'gain') { track.suspendedGain = suspended; track.gainRamp = { from: value, to: value, start: now, end: now }; }
      else { track.suspendedPan = suspended; track.panRamp = { from: value, to: value, start: now, end: now }; }
    }
    track.offset = track.cursor = position; track.paused = true;
  }
  resume(channel: string): void {
    const track = this.tracks.get(channel); if (!track || !track.paused) return; track.paused = false; track.transport.open(track.offset,rate(track.request));
    if (track.suspendedGain) this.setGain(channel, track.suspendedGain.to, track.suspendedGain.remaining);
    if (track.suspendedPan) this.setPan(channel, track.suspendedPan.to, track.suspendedPan.remaining);
    track.suspendedGain = track.suspendedPan = undefined;
  }
  stop(channel: string): void { this.loading.get(channel)?.abort(); this.versions.set(channel, (this.versions.get(channel) ?? 0)+1); this.remove(channel, 'stopped'); }
  stopAll(): void { for (const channel of new Set([...this.tracks.keys(), ...this.versions.keys()])) this.stop(channel); }
  private remove(channel: string, reason: 'natural' | 'stopped'): void {
    const track = this.tracks.get(channel); if (!track) return; this.tracks.delete(channel);
    track.transport.stop(); track.gain.disconnect(); track.pan.disconnect(); track.release(); this.events.push({ kind: 'ended', channel, token: track.request.token, reason });
  }
  setRate(channel: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0 || value > 32) throw new Error('Invalid audio playback rate');
    const track = this.tracks.get(channel); if (!track) throw new Error('Audio channel not active');
    this.emitLabels(track, this.total(track)); const position = this.position(channel)!; track.transport.stop();
    track.request = { ...track.request, rate: value }; track.offset = track.cursor = position; track.include = false; if (!track.paused) track.transport.open(track.offset,rate(track.request));
  }
  setGain(channel: string, value: number, seconds = 0): void { this.automate(channel, 'gain', value, seconds); }
  setPan(channel: string, value: number, seconds = 0): void { this.automate(channel, 'pan', value, seconds); }
  private automate(channel: string, property: 'gain' | 'pan', value: number, seconds: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(seconds) || seconds < 0 || property === 'gain' && (value < 0 || value > 16) || property === 'pan' && Math.abs(value)>1) throw new Error('Invalid audio parameter ramp');
    const track = this.tracks.get(channel); if (!track) throw new Error('Audio channel not active');
    const now = this.context.currentTime, previous = property === 'gain' ? track.gainRamp : track.panRamp, ramp = { from: rampValue(previous, now), to: value, start: now, end: now+seconds };
    const parameter = property === 'gain' ? track.gain.gain : track.pan.pan;
    if (track.paused) {
      const frozen = seconds ? ramp.from : value, suspended = seconds ? { to: value, remaining: seconds } : undefined;
      parameter.cancelScheduledValues(now); parameter.setValueAtTime(frozen, now);
      const held = { from: frozen, to: frozen, start: now, end: now };
      if (property === 'gain') { track.suspendedGain = suspended; track.gainRamp = held; } else { track.suspendedPan = suspended; track.panRamp = held; } return;
    }
    parameter.cancelScheduledValues(now); parameter.setValueAtTime(ramp.from, now);
    if (seconds) parameter.linearRampToValueAtTime(value, now+seconds); else parameter.setValueAtTime(value, now);
    if (property === 'gain') track.gainRamp = ramp; else track.panRamp = ramp;
  }
  capture(): readonly AudioTrackSnapshot[] {
    this.tick(); const now = this.context.currentTime; return [...this.tracks.values()].map(track => ({ request: { ...track.request, loop: track.request.loop && { ...track.request.loop } },
      position: this.position(track.request.channel)!, paused: track.paused, gain: rampValue(track.gainRamp, now), pan: rampValue(track.panRamp, now), gainRamp: track.suspendedGain ?? (track.gainRamp.end > now ? { to: track.gainRamp.to, remaining: track.gainRamp.end-now } : undefined),
      panRamp: track.suspendedPan ?? (track.panRamp.end > now ? { to: track.panRamp.to, remaining: track.panRamp.end-now } : undefined) }));
  }
  /** Restore one owned track exactly once; labels at the saved cursor are already consumed. */
  async restoreTrack(track: AudioTrackSnapshot): Promise<void> {
    await this.play({ ...track.request, offset: track.position, gain: track.gain, pan: track.pan });
    if (track.gainRamp) this.setGain(track.request.channel, track.gainRamp.to, track.gainRamp.remaining);
    if (track.panRamp) this.setPan(track.request.channel, track.panRamp.to, track.panRamp.remaining);
    if (track.paused) this.pause(track.request.channel);
    const restored = this.tracks.get(track.request.channel)!; restored.include = false;
  }
  async restore(snapshot: readonly AudioTrackSnapshot[]): Promise<void> {
    if (snapshot.length > 100000 || new Set(snapshot.map(track => track.request.channel)).size !== snapshot.length) throw new Error('Duplicate/over-budget saved audio tracks');
    this.stopAll(); this.events = []; for (const track of snapshot) await this.restoreTrack(track);
  }
}
