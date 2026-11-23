import {oggPageCrc} from './ogg-window.ts';

export const opusRate=48000;
const maxPacketBytes=65536,maxPacketFrames=5760,maxBatchFrames=6;

export const opusPreroll=3840; // RFC 7845: at least 80 ms before a non-origin seek.
export interface OpusPacket {readonly data:Uint8Array<ArrayBuffer>;readonly start:number;readonly frames:number}
function page(bytes:Uint8Array<ArrayBuffer>,view:DataView,at:number,serial:number){
  if(at+27>bytes.length||view.getUint32(at)!==0x4f676753||bytes[at+4]||view.getUint32(at+14,true)!==serial)throw Error('Invalid Opus page');
  const lacing=at+27,body=lacing+bytes[at+26],flags=bytes[at+5],granule=Number(view.getBigInt64(at+6,true));
  if(body>bytes.length||body===lacing||flags&~7||!Number.isSafeInteger(granule)||granule< -1)throw Error('Invalid Opus page header');
  let end=body;for(let i=lacing;i<body;i++)end+=bytes[i];
  if(end>bytes.length||oggPageCrc(bytes,at,end)!==view.getUint32(at+22,true))throw Error('Invalid Opus page body');
  return {lacing,body,end,flags,granule,sequence:view.getUint32(at+18,true)};
}

/** Accept the original family-0 mono/stereo layout. Apply both Ogg trims ourselves. */
export function packetOpusConfig(bytes:Uint8Array<ArrayBuffer>,serial:number,channels:number,preSkip:number):AudioDecoderConfig {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const head=page(bytes,view,0,serial),p=head.body;
  if(head.flags!==2||head.sequence!==0||head.granule!==0||head.body-head.lacing!==1||head.end-p!==19||
    view.getUint32(p)!==0x4f707573||view.getUint32(p+4)!==0x48656164||bytes[p+8]!==1||bytes[p+9]!==channels||
    view.getUint16(p+10,true)!==preSkip||view.getInt16(p+16,true)!==0||bytes[p+18]!==0)throw Error('Unsupported Opus identification');
  const description=bytes.slice(p,head.end);description[10]=description[11]=0;
  return {codec:'opus',sampleRate:opusRate,numberOfChannels:channels,description};
}

function packetFrames(data:Uint8Array):number {
  if(!data.length)throw Error('Empty Opus packet');
  const toc=data[0],config=toc>>3;
  const size=config>=16?120<<(config&3):config>=12?480<<(config&1):[480,960,1920,2880][config&3];
  const packing=toc&3,count=packing===0?1:packing===3?(data[1]??0)&63:2,frames=size*count;
  if(!count||frames>maxPacketFrames)throw Error('Invalid Opus packet duration');
  return frames;
}

/** RFC 6716 CBR packet codes 1 and 3. Reframe only compatible single-frame
 * packets; the Opus frame bytes and time order stay untouched. This avoids a
 * browser thread hop and AudioData per 20 ms while retaining prediction state. */
export function groupOpusFrames(packets:readonly OpusPacket[]):OpusPacket[]{
  const groups:OpusPacket[]=[];
  for(let i=0;i<packets.length;){
    const first=packets[i],toc=first.data[0],length=first.data.length;
    let n=1;
    if((toc&3)===0)while(n<maxBatchFrames&&(n+1)*first.frames<=maxPacketFrames&&i+n<packets.length){
      const next=packets[i+n];
      if(next.data[0]!==toc||next.data.length!==length||next.start!==first.start+n*first.frames)break;
      n++;
    }
    if(n===1)groups.push(first);
    else{
      const head=n===2?1:2,size=length-1,data=new Uint8Array(head+n*size);
      data[0]=toc|(n===2?1:3);if(n>2)data[1]=n;
      for(let j=0;j<n;j++)data.set(packets[i+j].data.subarray(1),head+j*size);
      groups.push({data,start:first.start,frames:n*first.frames});
    }
    i+=n;
  }
  return groups;
}

/** Window boundaries are page ends, not necessarily packet ends. Only a random
 * start can drop a missing continued prefix; sequential windows own that prefix. */
export class IndexedOpusPackets {
  private tail?:Uint8Array<ArrayBuffer>;
  private sequence?:number;
  private dropping=false;
  private aligning=false;
  private cursor:number;
  constructor(private readonly serial:number,private readonly preSkip:number,private readonly base:number){this.cursor=base;}
  read(bytes:Uint8Array<ArrayBuffer>,last:number,eof:boolean):OpusPacket[]{
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),packets:OpusPacket[]=[];
    let endGranule=-1;
    for(let at=0;at<bytes.length;){
      const p=page(bytes,view,at,this.serial);at=p.end;
      const continued=!!(p.flags&1),final=!!(p.flags&4);
      if(p.flags&2||final!==(eof&&at===bytes.length))throw Error('Unexpected indexed Opus end');
      if(this.sequence===undefined&&this.base&&continued){this.dropping=true;this.aligning=true;}
      if(this.sequence!==undefined&&p.sequence!==this.sequence||continued!==(!!this.tail||this.dropping))throw Error('Opus page sequence/continuation changed');
      this.sequence=(p.sequence+1)>>>0;
      const ready:{data:Uint8Array<ArrayBuffer>;frames:number}[]=[];
      let pos=p.body,start=pos,skipped=false;
      for(let i=p.lacing;i<p.body;i++){
        const size=bytes[i];pos+=size;if(size===255)continue;
        if(this.dropping){this.dropping=false;skipped=true;}
        else{
          const data=this.join(bytes.subarray(start,pos));
          this.tail=undefined;ready.push({data,frames:packetFrames(data)});
        }
        start=pos;
      }
      if(start<pos&&!this.dropping)this.tail=this.join(bytes.subarray(start,pos));
      if(!ready.length&&!skipped){if(p.granule!==-1||final)throw Error('Opus page without complete packets has a granule');continue;}
      const count=ready.reduce((total,packet)=>total+packet.frames,0);
      if(this.aligning){
        const start=p.granule-count;
        if(final||start<=this.base||start>this.base+maxPacketFrames)throw Error('Ambiguous seek after continued Opus packet');
        this.cursor=start;this.aligning=false;
      }
      for(const packet of ready){packets.push({...packet,start:this.cursor});this.cursor+=packet.frames;}
      if(final?(this.tail||!count||p.granule<=this.cursor-ready.at(-1)!.frames||p.granule>this.cursor):p.granule!==this.cursor)throw Error('Opus granule disagrees with packet timing');
      endGranule=p.granule;
    }
    if(endGranule!==last+this.preSkip||!packets.length)throw Error('Opus window disagrees with index');
    return packets;
  }
  private join(bytes:Uint8Array<ArrayBuffer>):Uint8Array<ArrayBuffer>{
    const prior=this.tail;
    if(bytes.length+(prior?.length??0)>maxPacketBytes)throw Error('Unbounded Opus packet');
    if(!prior)return bytes;
    const joined=new Uint8Array(prior.length+bytes.length);joined.set(prior);joined.set(bytes,prior.length);return joined;
  }
}
