import type {AudioAsset} from './audio-catalog.ts';
import {oggWindow} from './ogg-window.ts';
import {AudioByteRun} from './stream-byte-source.ts';
import {StreamOpus} from './stream-opus.ts';
import {continuousOpus} from '../runtime/playback-optimizations.ts';
import type {PrefetchRequest,ResourcePrefetch} from '../runtime/resource-prefetch.ts';

export type AudioRange=readonly [byteEnd:number,sampleEnd:number];
export type AudioIndex=readonly [headerBytes:number,ranges:readonly AudioRange[]];
export interface DecodedAudioRange {readonly first:number;readonly last:number;readonly offset:number;readonly buffer:AudioBuffer}
const unitLimit=512*1024,rawBudget=2*1024*1024,vorbisOverlapLimit=4096;
interface ByteRun {file:string;header?:Uint8Array<ArrayBuffer>;windows:Map<string,Uint8Array<ArrayBuffer>>;input?:AudioByteRun}
export function findAudioRange(points:readonly AudioRange[],frame:number):number {
  let lo=0,hi=points.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(points[m][1]<=frame)lo=m+1;else hi=m;}
  return lo;
}
async function sha(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
export class AudioStreamCatalog {
  private readonly life=new AbortController();
  private readonly index=new Map<string,AudioIndex>();
  private readonly raw=new Map<string,Uint8Array<ArrayBuffer>>();
  private readonly opus=continuousOpus?new StreamOpus():undefined;
  private readonly readers=new WeakMap<AbortSignal,ByteRun>();
  private readonly pcm=new Map<string,DecodedAudioRange>();
  private readonly decodeContexts=new Map<number,OfflineAudioContext>();
  private rawBytes=0;private pcmBytes=0;
  private constructor(readonly base:URL,readonly budget:number,private readonly prefetch?:ResourcePrefetch){}
  static async open(manifestURL:URL,manifestBytes:ArrayBuffer,items:readonly AudioAsset[],budget:number,signal?:AbortSignal,prefetch?:ResourcePrefetch){
    const out=new AudioStreamCatalog(new URL('.',manifestURL),budget,prefetch);
    const response=await fetch(new URL('stream-index.json',out.base),{signal});
    if(!response.ok)throw Error('缺少正式音频分段索引，请重新构建静态站');
    const row=await response.json();
    if(row?.format!=='senren-ogg-range-v2'||row.manifestSha256!==await sha(manifestBytes)||!row.tracks||Object.keys(row.tracks).length!==items.length)throw Error('Audio stream index/manifest mismatch');
    for(const item of items){
      const itemIndex=row.tracks[item.file];
      if(!Array.isArray(itemIndex)||itemIndex.length!==2)throw Error('Missing audio index: '+item.file);
      const [header,points]=itemIndex;
      if(!Number.isSafeInteger(header)||header<27||header>=item.bytes||header>unitLimit||!Array.isArray(points)||!points.length||points.length>100000)throw Error('Invalid audio range index: '+item.file);
      let prevByte=header,prevSample=0;
      for(const p of points){
        if(!Array.isArray(p)||p.length!==2||!p.every(Number.isSafeInteger)||p[0]<=prevByte||p[0]-prevByte>unitLimit||p[1]<=prevSample)throw Error('Invalid audio indexed window: '+item.file);
        [prevByte,prevSample]=p;
      }
      if(prevByte!==item.bytes||prevSample!==Math.round(item.duration*item.sampleRate)||points[0][0]>unitLimit)throw Error('Wrong audio index endpoint: '+item.file);
      out.index.set(item.file,itemIndex as unknown as AudioIndex);
    }
    return out;
  }
  points(item:AudioAsset):readonly AudioRange[]{return this.index.get(item.file)![1];}
  private request(item:AudioAsset,from:number,to:number):PrefetchRequest {
    return {url:new URL(item.file,this.base).href,bytes:to-from,range:{start:from,size:item.bytes}};
  }
  warmRequests(item:AudioAsset,offset:number):PrefetchRequest[]{
    const [h,p]=this.index.get(item.file)!,unit=findAudioRange(p,Math.round(offset*item.sampleRate));
    if(unit>=p.length||this.pcm.has(item.file+':'+unit))return [];
    const requests:PrefetchRequest[]=[];
    const push=(a:number,b:number)=>{if(!this.raw.has(item.file+':'+a+'-'+b))requests.push(this.request(item,a,b));};
    if(unit<=1){push(0,p[0][0]);if(unit)push(p[0][0],p[1][0]);}
    else {push(0,h);for(let i=unit-1;i<=unit;i++)push(p[i-1][0],p[i][0]);}
    return requests;
  }
  async load(item:AudioAsset,unit:number,caller:AbortSignal,front=false):Promise<DecodedAudioRange>{
    const life=AbortSignal.any([caller,this.life.signal]);life.throwIfAborted();
    const index=this.index.get(item.file)!;
    const [header,p]=index;
    if(!Number.isSafeInteger(unit)||unit<0||unit>=p.length)throw Error('Audio window outside index');
    let run=this.readers.get(caller);
    if(!run){run={file:item.file,windows:new Map()};this.readers.set(caller,run);}
    if(run.file!==item.file)throw Error('Audio playback owner changed files');
    const read=(from:number,to:number,head=false)=>this.range(run,item,from,to,life,front,head);
    if(this.opus){
      const decoded=await this.opus.load(item,index,unit,caller,life,read);
      if(decoded)return decoded;
    }
    const key=item.file+':'+unit,cached=this.pcm.get(key);
    if(cached){this.pcm.delete(key);this.pcm.set(key,cached);return cached;}
    const first=unit?p[unit-1][1]:0,start=Math.max(0,unit-1);let last=p[unit][1];
    const base=start?p[start-1][1]+item.preSkip:0;
    const parts:Uint8Array[]=[];
    if(!start){
      const together=await read(0,p[0][0]);
      run.header=together.subarray(0,header);
      this.keepRaw(item.file+':0-'+header,together.slice(0,header));
      parts.push(together);
      if(unit)parts.push(await read(p[0][0],p[1][0]));
    }else{
      parts.push(await read(0,header,true));
      for(let i=start;i<=unit;i++)parts.push(await read(p[i-1][0],p[i][0]));
    }
    life.throwIfAborted();
    const serial=item.serial;
    if(!Number.isSafeInteger(serial)||serial<0||serial>0xffffffff)throw Error('Missing Ogg stream serial');
    let codec=this.decodeContexts.get(item.sampleRate);
    if(!codec){codec=new OfflineAudioContext(1,1,item.sampleRate);this.decodeContexts.set(item.sampleRate,codec);}
    const originalEnd={eos:false,granule:-1};
    const decode=async()=>{
      const payload=oggWindow(parts,header,base,item.codec==='opus'&&start>0,serial,originalEnd);
      try{return await codec!.decodeAudioData(payload);}catch(error){throw Error('Ogg 区块解码失败：'+item.name+' #'+unit,{cause:error});}
    };
    let buffer=await decode();life.throwIfAborted();
    const expected=base?last-(base-item.preSkip):last;
    let offset=buffer.length-(last-first);
    const paddedVorbisEof=(endUnit:number)=>{
      const end=p[endUnit][1],padding=buffer.length-end;
      return item.codec==='vorbis'&&start===0&&endUnit===p.length-1&&originalEnd.eos&&originalEnd.granule===end&&padding>0&&padding<=vorbisOverlapLimit;
    };
    // Chrome may truncate the last Vorbis overlap in a *synthetic* first EOS.
    // Use one real successor page as postroll; origin zero remains unchanged.
    if(item.codec==='vorbis'&&!base&&buffer.length<expected&&unit+1<p.length){
      parts.push(await read(p[unit][0],p[unit+1][0]));
      buffer=await decode();life.throwIfAborted();offset=first;
      if(buffer.length<last||(buffer.length>p[unit+1][1]&&!paddedVorbisEof(unit+1)))throw Error('Initial Vorbis postroll insufficient: '+item.name);
    }else if(paddedVorbisEof(unit)){
      // Origin zero + verified original EOS: trim the tail, not the slice origin.
      offset=first;
    }else if(item.codec==='vorbis'&&p.length===1&&buffer.length<last&&last-buffer.length<=vorbisOverlapLimit){
      // At real EOF there is no successor packet. Retain exactly what Chrome
      // natively decodes from the original one-window clip, without padding.
      last=buffer.length;offset=0;
    }else if(buffer.length>expected||(!base&&buffer.length!==expected)){
      throw Error('Unexpected Ogg window span: '+item.name+' #'+unit+' got '+buffer.length+' expected '+expected);
    }
    // A midstream Vorbis window lacks its first overlap packet. Preroll absorbs
    // that loss; the indexed final granule aligns the retained suffix exactly.
    const frames=last-first;
    if(!frames||buffer.numberOfChannels!==item.channels||buffer.sampleRate!==item.sampleRate||offset<0||offset+frames>buffer.length)
      throw Error('Unexpected retained Ogg samples: '+item.name+' #'+unit+' got '+buffer.length+' need '+frames);
    const existing=this.pcm.get(key);if(existing)return existing;
    const decoded={first,last,offset,buffer};this.pcm.set(key,decoded);this.pcmBytes+=this.pcmSize(decoded);this.trim(this.budget);return decoded;
  }
  private async range(run:ByteRun,item:AudioAsset,from:number,to:number,signal:AbortSignal,front:boolean,head:boolean):Promise<Uint8Array<ArrayBuffer>>{
    const key=item.file+':'+from+'-'+to,held=head?run.header:run.windows.get(key);
    if(held)return held;
    if(to-from>unitLimit||to<=from)throw Error('Audio bytes exceed range budget');
    const spec=this.request(item,from,to),old=this.raw.get(key);
    let data:Uint8Array<ArrayBuffer>;
    if(old){this.raw.delete(key);this.raw.set(key,old);data=old;}
    else{
      const bytes=this.prefetch?.take(spec);
      if(bytes){signal.throwIfAborted();this.prefetch?.promote?.(spec,bytes);data=new Uint8Array(bytes);}
      else{
        const read=()=>{
          if(head)return this.readHeader(spec,signal,front);
          // Only a backwards reposition can replace a live response. Cache eviction cannot.
          if(!run.input||from<run.input.position){run.input?.close();run.input=new AudioByteRun(spec.url,from,item.bytes,signal);}
          return run.input.read(from,to,front);
        };
        data=await (this.prefetch?this.prefetch.foreground(read):read());
      }
      signal.throwIfAborted();this.keepRaw(key,data);
    }
    // The Ogg header and two neighbouring windows belong to playback, not the shared LRU.
    if(head)run.header=data;
    else{
      run.windows.set(key,data);
      for(const k of run.windows.keys()){if(run.windows.size<=2)break;run.windows.delete(k);}
    }
    return data;
  }
  private async readHeader(spec:PrefetchRequest,signal:AbortSignal,front:boolean):Promise<Uint8Array<ArrayBuffer>>{
    const total=spec.range!.size,stop=spec.bytes-1;
    const request=AbortSignal.any([signal,AbortSignal.timeout(25000)]);
    const reply=await fetch(spec.url,{headers:{Range:'bytes=0-'+stop},signal:request,priority:front?'high':'low'});
    const encoding=reply.headers.get('Content-Encoding');
    if(reply.status!==206||reply.headers.get('Content-Range')!=='bytes 0-'+stop+'/'+total||encoding&&encoding!=='identity'){
      await reply.body?.cancel();throw Error('静态站必须支持原音频 HTTP Range：'+new URL(spec.url).pathname);
    }
    const data=new Uint8Array(await reply.arrayBuffer());
    if(data.length!==spec.bytes)throw Error('Truncated Ogg header');
    return data;
  }
  private keepRaw(key:string,bytes:Uint8Array<ArrayBuffer>):void {
    if(this.raw.has(key))return;
    this.raw.set(key,bytes);this.rawBytes+=bytes.length;
    for(const [k,b] of this.raw){if(this.rawBytes<=rawBudget)break;this.rawBytes-=b.length;this.raw.delete(k);}
  }
  private pcmSize(block:DecodedAudioRange){return block.buffer.length*block.buffer.numberOfChannels*4;}
  private trim(budget:number):void {
    for(const [k,b] of this.pcm){if(this.pcmBytes<=budget)break;this.pcmBytes-=this.pcmSize(b);this.pcm.delete(k);}
  }
  clearUnused():void {this.trim(0);this.raw.clear();this.rawBytes=0;}
  close():void {this.life.abort();this.clearUnused();this.decodeContexts.clear();}
}
