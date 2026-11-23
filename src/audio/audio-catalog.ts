import type { LoopBlock } from '../formats/sli.ts';
import {AudioStreamCatalog} from './stream-catalog.ts';
import type {ResourcePrefetch} from '../runtime/resource-prefetch.ts';
import type {AudioLease} from './legacy-audio-buffer.ts';
import {LegacyAudioBufferCatalog} from './legacy-audio-buffer.ts';
import {originalAudioNames} from './native-audio-archive-names.ts';
export interface AudioAsset { readonly id: string; readonly name: string; readonly file: string; readonly bytes: number; readonly sha256: string; readonly codec: 'opus' | 'vorbis'; readonly channels: number; readonly sampleRate: number; readonly preSkip: number; readonly serial: number; readonly loopSampleRate?: number; readonly duration: number; readonly loops: readonly LoopBlock[]; readonly nonLoopSidecar?: unknown }
function key(value: string): string { return value.replaceAll(String.fromCharCode(92), '/').toLowerCase(); }
function entry(value: any): AudioAsset {
  if (!value || value.state !== 'prepared' || typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name ||
      typeof value.file !== 'string' || !/^[0-9]+[.]ogg$/u.test(value.file) || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 256 * 1024 * 1024 ||
      !['opus', 'vorbis'].includes(value.codec) || !Number.isSafeInteger(value.channels) || value.channels < 1 || value.channels > 8 ||
      !Number.isSafeInteger(value.sampleRate) || value.sampleRate < 1 || (value.loopSampleRate!==undefined&&(!Number.isSafeInteger(value.loopSampleRate)||value.loopSampleRate<1||value.loopSampleRate>192000)) || !Number.isFinite(value.duration) || value.duration < 0) throw new Error('Invalid prepared audio record');
  const loops = value.loops ?? []; if (!Array.isArray(loops)) throw new Error('Invalid audio loop metadata');
  for (const block of loops) if (!block || typeof block.kind !== 'string' || !block.fields || typeof block.fields !== 'object') throw new Error('Invalid audio loop block');
  return Object.freeze({ ...value, loops: Object.freeze(loops.map((block: LoopBlock) => Object.freeze({ kind: block.kind, fields: Object.freeze({ ...block.fields }) }))) });
}
export class AudioCatalog {
  readonly entries: readonly AudioAsset[];
  private readonly aliases = new Map<string, Set<AudioAsset>>();
  private constructor(entries:AudioAsset[],readonly stream:AudioStreamCatalog|undefined,private readonly legacy:LegacyAudioBufferCatalog|undefined){
    this.entries=Object.freeze(entries);
    const ids = new Set<string>();
    for (const item of entries) {
      if (ids.has(item.id)) throw new Error('Duplicate audio id'); ids.add(item.id);
      for(const name of originalAudioNames(key(item.name),item.sha256)){
        const full = name, basename = full.slice(full.lastIndexOf('/') + 1);
        for (const alias of [full, basename, full.replace(/[.](ogg|opus)$/u, ''), basename.replace(/[.](ogg|opus)$/u, '')]) { const values = this.aliases.get(alias) ?? new Set<AudioAsset>(); values.add(item); this.aliases.set(alias, values); }
      }
    }
  }
  static async open(url:string|URL,context:BaseAudioContext,options:{decodedByteBudget?:number;signal?:AbortSignal;streaming?:boolean;prefetch?:ResourcePrefetch}={}):Promise<AudioCatalog>{
    const response=await fetch(url,{signal:options.signal});if(!response.ok)throw Error('Audio manifest HTTP '+response.status);
    const bytes=await response.arrayBuffer(),value=JSON.parse(new TextDecoder().decode(bytes));
    if(value?.schemaVersion!==1||value?.format!=='prepared-web-audio-v1'||value.failed!==0||!Array.isArray(value.files)||value.entries!==value.files.length)throw Error('Incomplete audio manifest');
    const entries=value.files.map(entry),manifestURL=new URL(response.url||String(url),globalThis.location?.href),budget=options.decodedByteBudget??24*1024*1024;
    if(!Number.isSafeInteger(budget)||budget<1)throw Error('Invalid decoded-audio budget');
    const stream=options.streaming?await AudioStreamCatalog.open(manifestURL,bytes,entries,budget,options.signal,options.prefetch):undefined;
    return new AudioCatalog(entries,stream,stream?undefined:new LegacyAudioBufferCatalog(new URL('.',manifestURL),context,budget));
  }
  resolve(storage: string): AudioAsset { const values = this.aliases.get(key(storage)); if (!values || values.size !== 1) throw new Error(values ? 'Ambiguous audio: ' + storage : 'Unknown audio: ' + storage); return values.values().next().value!; }
  acquire(storage:string):Promise<AudioLease>{if(!this.legacy)throw Error('Full audio buffers are disabled in the streaming player');return this.legacy.acquire(this.resolve(storage));}
  clearUnused():void {this.stream?.clearUnused();this.legacy?.clearUnused();}
  close():void {this.stream?.close();this.legacy?.close();}
}
