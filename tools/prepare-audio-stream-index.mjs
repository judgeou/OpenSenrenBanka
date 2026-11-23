import {createHash} from 'node:crypto';
import {readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function plan(bytes,item){
  if(bytes.length!==item.bytes||digest(bytes)!==item.sha256)throw Error('Original audio content changed: '+item.file);
  let at=0,header=0,packets=0,prev=0,sequence,ended=false;
  const need=item.codec==='opus'?2:3,points=[];
  while(at<bytes.length){
    if(ended||at+27>bytes.length||bytes.toString('ascii',at,at+4)!=='OggS'||bytes[at+4]!==0)throw Error('Invalid Ogg page: '+item.file);
    const flags=bytes[at+5],serial=bytes.readUInt32LE(at+14),seq=bytes.readUInt32LE(at+18),g=Number(bytes.readBigInt64LE(at+6));
    const lace=bytes[at+26],start=at+27,end=start+lace;let next=end;
    if(serial!==item.serial||sequence!==undefined&&seq!==((sequence+1)>>>0)||end>bytes.length)throw Error('Invalid Ogg page bounds: '+item.file);
    for(let i=start;i<end;i++){
      next+=bytes[i];if(bytes[i]<255)packets++;
    }
    if(next>bytes.length)throw Error('Truncated Ogg page: '+item.file);
    if(!header&&packets>=need){
      if(packets!==need||g!==0||!lace||bytes[end-1]===255)throw Error('Shared Ogg header/data page is unbound: '+item.file);
      header=next;
    }
    const sample=g-item.preSkip;
    if(header&&at>=header&&g>=0&&lace&&bytes.subarray(start,end).some(size=>size<255)&&sample>prev){
      ended=(flags&4)!==0;
      // Prefer the first natural page for cold start, then group to ~1.4 seconds.
      if(ended||!points.length||sample-prev>=Math.round(item.sampleRate*1.4)){
        points.push([next,sample]);prev=sample;
      }
    }else if(flags&4)ended=true;
    at=next;sequence=seq;
  }
  if(!ended||!header||points.at(-1)?.[0]!==bytes.length||points.at(-1)[1]!==Math.round(item.duration*item.sampleRate))throw Error('Incomplete Ogg stream index: '+item.file);
  return [header,points];
}
/** Metadata only: no codec re-encode and no duplicate copy of original sounds. */
export async function prepareAudioStreamIndex(directory){
  const raw=await readFile(path.join(directory,'manifest.json')),manifest=JSON.parse(raw), tracks={};
  if(manifest.format!=='prepared-web-audio-v1'||manifest.failed!==0||manifest.files?.length!==manifest.entries)throw Error('Unexpected audio manifest');
  let units=0,maxFirstBytes=0,maxUnitBytes=0;
  for(const item of manifest.files){
    if(!/^[0-9]+[.]ogg$/u.test(item.file)||Object.hasOwn(tracks,item.file)||!['opus','vorbis'].includes(item.codec))throw Error('Invalid stream asset entry');
    const data=await readFile(path.join(directory,item.file));const result=plan(data,item);tracks[item.file]=result;
    units+=result[1].length;maxFirstBytes=Math.max(maxFirstBytes,result[1][0][0]);
    let from=result[0];for(const [byte] of result[1]){maxUnitBytes=Math.max(maxUnitBytes,byte-from);from=byte;}
  }
  const result={format:'senren-ogg-range-v2',manifestSha256:digest(raw),tracks};
  const output=path.join(directory,'stream-index.json'),temporary=output+'.tmp';
  await writeFile(temporary,JSON.stringify(result));await rename(temporary,output);
  return {directory,tracks:manifest.files.length,units,maxFirstBytes,maxUnitBytes};
}
