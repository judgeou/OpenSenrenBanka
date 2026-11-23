import type {AudioAsset} from './audio-catalog.ts';
import type {AudioIndex,DecodedAudioRange} from './stream-catalog.ts';
import {IndexedOpusPackets,groupOpusFrames,opusPreroll,opusRate,packetOpusConfig} from './opus-packets.ts';
import {OpusDecoderRun} from './opus-decoder-run.ts';

type ReadRange=(from:number,to:number,header?:boolean)=>Promise<Uint8Array<ArrayBuffer>>;
interface ActiveRun { readonly file:string;readonly packets:IndexedOpusPackets;readonly decoder:OpusDecoderRun;readonly release:()=>void;next:number }
const activeLimit=6;

/** Playback-owned, not part of the PCM LRU: skipping a cached middle window
 * would also skip the packets needed to advance the decoder's state. */
export class StreamOpus {
  private readonly active=new Map<AbortSignal,ActiveRun>();
  private readonly fallback=new WeakSet<AbortSignal>();
  private readonly supported=new Map<number,Promise<boolean>>();
  async load(item:AudioAsset,index:AudioIndex,unit:number,owner:AbortSignal,life:AbortSignal,read:ReadRange):Promise<DecodedAudioRange|undefined>{
    const [header,points]=index;
    // One-window clips have no repeated decode to remove and benefit from the shared PCM LRU.
    if(item.codec!=='opus'||item.sampleRate!==opusRate||item.channels>2||points.length<2||typeof AudioDecoder==='undefined'||
      typeof EncodedAudioChunk==='undefined'||this.fallback.has(owner))return;
    let run=this.active.get(owner);
    if(run&&(run.next!==unit||run.file!==item.file)){run.release();run=undefined;}
    const first=unit?points[unit-1][1]:0,last=points[unit][1];
    let start=unit;
    if(!run){
      if(this.active.size>=activeLimit){this.fallback.add(owner);return;}
      // Start at a page boundary leaving 80 ms after any continued packet we
      // may have to discard (at most 120 ms). Origin retains original pre-skip.
      if(unit)do{start--;}while(start>0&&first-points[start-1][1]<opusPreroll+5760);
      const head=start?await read(0,header,true):(await read(0,points[0][0])).subarray(0,header);
      life.throwIfAborted();
      try{
        const config=packetOpusConfig(head,item.serial,item.channels,item.preSkip);
        let supported=this.supported.get(item.channels);
        if(!supported){supported=AudioDecoder.isConfigSupported(config).then(result=>result.supported===true,()=>false);this.supported.set(item.channels,supported);}
        if(!await supported){this.fallback.add(owner);return;}
        life.throwIfAborted();
        if(this.active.size>=activeLimit){this.fallback.add(owner);return;}
        const decoder=new OpusDecoderRun(config),base=start?points[start-1][1]+item.preSkip:0;
        const release=()=>{this.active.delete(owner);life.removeEventListener('abort',release);decoder.close(life.reason);};
        run={file:item.file,next:unit,decoder,packets:new IndexedOpusPackets(item.serial,item.preSkip,base),release};
        this.active.set(owner,run);life.addEventListener('abort',release,{once:true});
      }catch(error){life.throwIfAborted();this.fallback.add(owner);return;}
    }
    try{
      let buffer:AudioBuffer|undefined;
      for(let i=start;i<=unit;i++){
        const bytes=i?await read(points[i-1][0],points[i][0]):(await read(0,points[0][0])).subarray(header);
        life.throwIfAborted();
        try{
          const packets=groupOpusFrames(run.packets.read(bytes,points[i][1],i===points.length-1));
          buffer=await (i===unit?run.decoder.decode(packets,first+item.preSkip,last+item.preSkip):run.decoder.decode(packets));
        }catch(error){life.throwIfAborted();this.fallback.add(owner);run.release();return;}
      }
      run.next=unit+1;if(run.next===points.length)run.release();
      return {first,last,offset:0,buffer:buffer!};
    }catch(error){run.release();throw error;}
  }
}
