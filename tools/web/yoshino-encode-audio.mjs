import {spawn} from 'node:child_process';
import {mkdir,readFile,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {opusReceipt} from './yoshino-opus-inspect.mjs';
import {base as yosBase,cache as yosCache,encoded as yosEncoded,digest,preparePlan} from './yoshino-media-plan.mjs';
import {recoveredMakoAudio} from './mako-recovered-audio.mjs';
const [ffmpeg,firstText,countText,workersText='2',route='yos',...extra]=process.argv.slice(2),first=Number(firstText),count=Number(countText),workers=Number(workersText);
if(extra.length||!['yos','mak'].includes(route)||!ffmpeg||!path.isAbsolute(ffmpeg)||path.basename(ffmpeg)!=='ffmpeg.exe'||![first,count,workers].every(Number.isSafeInteger)||first<0||count<1||count>2500||workers<1||workers>4)throw Error('Expected approved absolute ffmpeg.exe, bounded start/count and worker count');
const plan=route==='mak'?await recoveredMakoAudio():{...await preparePlan(),base:yosBase,cache:yosCache,encoded:yosEncoded};
const {base,cache,encoded}=plan,all=plan.audio.slice(first,first+count);
if(!all.length)throw Error('Empty audio batch');
const pending=path.join(cache,'receipt','audio');await mkdir(pending,{recursive:true});
for(const dir of new Set(all.map(a=>path.dirname(a.src))))await mkdir(path.join(encoded,dir),{recursive:true});
function transcode(args){return new Promise((yes,no)=>{const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let text='';child.stderr.on('data',s=>{text=(text+s).slice(-1800);});child.on('error',no);child.on('exit',code=>code?no(Error('FFmpeg '+code+' '+text)):yes());});}
let cursor=0,done=0,skipped=0,error;
await Promise.all(Array.from({length:workers},async()=>{
  while(cursor<all.length&&!error){
    const row=all[cursor++],kbps=row.kind==='music'?64:32,dst=path.join(encoded,row.src),side=path.join(pending,row.src.replaceAll('/','-')+'.json');
    try{
      const previous=await readFile(side,'utf8').then(JSON.parse,e=>{if(e.code!=='ENOENT')throw e;});
      if(previous){if(previous.old===row.sha256&&previous.bytes===(await stat(dst)).size){skipped++;continue;}throw Error('Prior media batch receipt differs');}
      const src=path.join(base,row.src),raw=await readFile(src);
      if(raw.length!==row.bytes||digest(raw)!==row.sha256)throw Error('Audio source changed: '+row.src);
      const temp=dst+'.'+process.pid+'.tmp';
      try{
        await transcode(['-hide_banner','-loglevel','error','-nostdin','-threads','1','-i',src,'-map','0:a:0','-vn','-map_metadata','-1',
          '-filter_threads','1','-af','aresample=48000:async=0,asettb=1/48000,asetpts=N,apad=whole_len='+row.frames+',atrim=end_sample='+row.frames+',asetpts=N',
          '-c:a','libopus','-b:a',kbps+'k','-vbr','off','-ar','48000','-application','audio','-frame_duration','20','-compression_level','5','-fflags','+bitexact','-flags:a','+bitexact','-f','ogg',temp]);
        const audio=await readFile(temp),info=opusReceipt(audio,kbps,row.frames,row.channels);
        await rename(temp,dst);await writeFile(side,JSON.stringify({old:row.sha256,...info,bytes:audio.length,sha256:digest(audio)}),{flag:'wx'});
      }catch(e){await unlink(temp).catch(()=>{});throw e;}
      if(++done%200===0)console.log(JSON.stringify({first,completed:done,remaining:all.length-done-skipped}));
    }catch(e){error=Error(row.src+': '+e.message,{cause:e});}
  }
}));
if(error)throw error;console.log(JSON.stringify({first,done,skipped,planned:all.length,total:plan.audio.length}));
