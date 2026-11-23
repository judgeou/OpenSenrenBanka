import {opusRate} from './opus-packets.ts';
import type {OpusPacket} from './opus-packets.ts';

const inFlightLimit=16,maxPcmFrames=opusRate*8;
const timestamp=(frame:number)=>frame*1_000_000/opusRate;
interface DecodeBatch {
  readonly packets:readonly OpusPacket[];readonly buffer?:AudioBuffer;readonly first:number;readonly last:number;
  readonly resolve:(buffer:AudioBuffer|undefined)=>void;readonly reject:(reason:unknown)=>void;
  readonly timer:ReturnType<typeof setTimeout>; sent:number;received:number;written:number;
}

/** Chunks and their PCM callbacks are bounded. No flush/reset between windows:
 * discard the unwanted PCM, not the decoder's prediction and filter state. */
export class OpusDecoderRun {
  private readonly decoder:AudioDecoder;
  private batch?:DecodeBatch;
  private failed?:unknown;
  private readonly channels:number;
  constructor(config:AudioDecoderConfig){
    this.channels=config.numberOfChannels;
    this.decoder=new AudioDecoder({output:pcm=>this.output(pcm),error:error=>this.close(error)});
    try{this.decoder.configure(config);}catch(error){this.close(error);throw error;}
  }
  decode(packets:readonly OpusPacket[],first=0,last=0):Promise<AudioBuffer|undefined>{
    if(this.batch||this.decoder.state!=='configured')throw this.failed??Error('Opus decoder run is not available');
    if(!packets.length||last<first||last-first>maxPcmFrames)throw Error('Unbounded Opus decode window');
    const buffer=last>first?new AudioBuffer({numberOfChannels:this.channels,length:last-first,sampleRate:opusRate}):undefined;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.close(Error('Opus packet output stalled')),1500);
      this.batch={packets,buffer,first,last,resolve,reject,timer,sent:0,received:0,written:0};
      this.feed(this.batch);
    });
  }
  private feed(batch:DecodeBatch):void {
    try{
      while(batch.sent<batch.packets.length&&batch.sent-batch.received<inFlightLimit){
        const p=batch.packets[batch.sent++];
        this.decoder.decode(new EncodedAudioChunk({type:'key',timestamp:timestamp(p.start),duration:timestamp(p.frames),data:p.data}));
      }
    }catch(error){this.close(error);}
  }
  private output(pcm:AudioData):void {
    try{
      const batch=this.batch;if(!batch){if(this.decoder.state!=='closed')throw Error('Unexpected Opus output');return;}
      const p=batch.packets[batch.received++];
      // Chromium can truncate a floating-point timestamp by 1 µs. PCM placement
      // is by Opus samples, not timestamps; even 1 µs is < 1/20 of a sample.
      if(!p||Math.abs(pcm.timestamp-timestamp(p.start))>1||pcm.numberOfFrames!==p.frames||pcm.sampleRate!==opusRate||pcm.numberOfChannels!==this.channels)
        throw Error('Opus output mismatch: '+[pcm.timestamp,pcm.numberOfFrames,pcm.sampleRate,pcm.numberOfChannels].join('/')+' expected '+(p?timestamp(p.start)+'/'+p.frames:'no packet')+'/'+opusRate+'/'+this.channels);
      const from=Math.max(batch.first,p.start),to=Math.min(batch.last,p.start+p.frames);
      if(batch.buffer&&to>from){
        if(from-batch.first!==batch.written)throw Error('Gap or overlap in Opus PCM');
        for(let ch=0;ch<this.channels;ch++)pcm.copyTo(batch.buffer.getChannelData(ch).subarray(batch.written,batch.written+to-from),
          {planeIndex:ch,format:'f32-planar',frameOffset:from-p.start,frameCount:to-from});
        batch.written+=to-from;
      }
      if(batch.received===batch.packets.length){
        if(batch.written!==batch.last-batch.first)throw Error('Incomplete Opus window PCM');
        clearTimeout(batch.timer);this.batch=undefined;batch.resolve(batch.buffer);
      }else if(batch.sent-batch.received<=inFlightLimit/2)this.feed(batch);
    }catch(error){this.close(error);}finally{pcm.close();}
  }
  close(reason:unknown=new DOMException('Opus decode run ended','AbortError')):void {
    const batch=this.batch;this.batch=undefined;this.failed=reason;
    if(this.decoder.state!=='closed')this.decoder.close();
    if(batch){clearTimeout(batch.timer);batch.reject(reason);}
  }
}
