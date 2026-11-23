/** Rewrap a bounded original Ogg window for native decoding; coded packets are unchanged. */
const table=Uint32Array.from({length:256},(_,i)=>{
  let x=i<<24;
  for(let b=0;b<8;b++)x=(x<<1)^((x>>>31)?0x04c11db7:0);
  return x>>>0;
});
export function oggPageCrc(bytes:Uint8Array,start:number,end:number):number {
  let crc=0;
  for(let i=start;i<end;i++){
    const value=i>=start+22&&i<start+26?0:bytes[i];
    crc=(crc<<8)^table[(crc>>>24)^value];
  }
  return crc>>>0;
}
interface OggWindowEnd { eos:boolean; granule:number }
export function oggWindow(sections:readonly Uint8Array[],headerBytes:number,base:number,opusSeek:boolean,serial:number,originalEnd?:OggWindowEnd):ArrayBuffer {
  const original=new Uint8Array(sections.reduce((n,p)=>n+p.length,0));
  let head=0;for(const p of sections){original.set(p,head);head+=p.length;}
  const input=new DataView(original.buffer),out=new Uint8Array(original.length),view=new DataView(out.buffer);
  let offset=0,write=0,sequence=0,lastGranule=-1,beginAudio=true;
  while(offset<original.length){
    if(offset+27>original.length||input.getUint32(offset)!==0x4f676753||original[offset+4]!==0||input.getUint32(offset+14,true)!==serial)throw Error('Invalid indexed Ogg window');
    let flags=original[offset+5],first=offset+27,last=first+original[offset+26],body=last,end=body;
    if(body>original.length)throw Error('Truncated indexed Ogg lacing');
    for(let i=first;i<last;i++)end+=original[i];
    if(end>original.length||oggPageCrc(original,offset,end)!==input.getUint32(offset+22,true))throw Error('Original Ogg page checksum mismatch');
    const final=end===original.length;
    let payloadEnd=end;
    if(offset>=headerBytes){
      if(beginAudio&&flags&1){
        // A seek window can start halfway through a packet. Skip only its
        // missing prefix and decode the next complete packet in the preroll.
        while(first<last){const size=original[first++];body+=size;if(size<255)break;}
        flags&=~1;
      }
      if(final)while(last>first&&original[last-1]===255)payloadEnd-=original[--last];
      if(first===last){if(final)throw Error('Audio window has no complete final packet');offset=end;continue;}
      beginAudio=false;
    }
    let granule=Number(input.getBigInt64(offset+6,true));
    if(offset>=headerBytes&&!original.subarray(first,last).some(size=>size<255))granule=-1;
    if(granule>0){
      if(!Number.isSafeInteger(granule)||granule<=base||granule<lastGranule)throw Error('Invalid indexed Ogg granule');
      lastGranule=granule;
    }
    if(final&&originalEnd){originalEnd.eos=!!(flags&4);originalEnd.granule=granule;}
    out.set(original.subarray(offset,offset+27),write);
    const size=last-first,target=write+27+size,next=target+payloadEnd-body;
    out[write+26]=size;out.set(original.subarray(first,last),write+27);out.set(original.subarray(body,payloadEnd),target);
    if(!sequence&&opusSeek){
      if(next<target+19||view.getUint32(target)!==0x4f707573||view.getUint32(target+4)!==0x48656164)throw Error('Missing Opus identification packet');
      view.setUint16(target+10,0,true);
    }
    out[write+5]=(flags&3)|(final?4:0);
    if(granule!==0)view.setBigInt64(write+6,BigInt(granule<0?-1:granule-base),true);
    view.setUint32(write+18,sequence++,true);view.setUint32(write+22,oggPageCrc(out,write,next),true);
    write=next;offset=end;
  }
  if(lastGranule<0)throw Error('Indexed Ogg window contains no audio data');
  return write===out.length?out.buffer:out.buffer.slice(0,write);
}
