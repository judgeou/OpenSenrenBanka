/** Verify physical Opus packets and immutable playback length, not just encoder args. */
export function opusReceipt(data,kbps,frames,channels){
  let at=0,packet=0,packetBytes=0,sections=0,serial,seq,preSkip=-1,last=-1,eos=false;
  while(at<data.length){
    if(eos||at+27>data.length||data.toString('ascii',at,at+4)!=='OggS'||data[at+4]!==0)throw Error('Bad encoded Ogg page');
    const id=data.readUInt32LE(at+14),n=data.readUInt32LE(at+18);serial??=id;
    if(id!==serial||(seq!==undefined&&n!==seq+1))throw Error('Unexpected Opus stream sequence');seq=n;
    const segments=data[at+26],body=at+27+segments;if(body>data.length)throw Error('Truncated Ogg Opus lacing');let p=body;
    for(let i=at+27;i<body;i++){
      const len=data[i];packetBytes+=len;
      if(p+len>data.length)throw Error('Truncated Ogg Opus packet');
      if(len<255){
        if(packet===0){if(data.toString('ascii',p,p+8)!=='OpusHead'||len<19||data[p+9]!==channels||data.readUInt32LE(p+12)!==48000)throw Error('Unexpected Opus identification');preSkip=data.readUInt16LE(p+10);}
        else if(packet>=2&&packetBytes!==kbps*20/8)throw Error('Opus payload is not '+kbps+' kbps CBR');
        packet++;packetBytes=0;
      }
      p+=len;
    }
    const g=Number(data.readBigInt64LE(at+6));if(g>=0)last=g;
    eos=!!(data[at+5]&4);at=p;sections++;
  }
  if(!eos||packet<3||packetBytes||!Number.isSafeInteger(last)||preSkip<0||last-preSkip!==frames)throw Error('Opus changed the presentation duration: '+(last-preSkip)+' / '+frames);
  return {codec:'opus',channels,sampleRate:48000,inputRate:48000,preSkip,samples:String(last),duration:frames/48000,serial,pages:sections,bitrateKbps:kbps};
}
