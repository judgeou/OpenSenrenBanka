import path from 'node:path';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {audioKind,cache as mediaCache} from './yoshino-media-plan.mjs';
import {work} from './web-paths.mjs';
export async function recoveredMakoAudio(){
  const base=path.join(work,'mako-audio-original'),cache=path.join(mediaCache,'mako-audio'),encoded=path.join(cache,'encoded');
  if(await realpath(base)!==base)throw Error('Invalid Mako original audio input');
  await mkdir(cache,{recursive:true});if(await realpath(cache)!==cache)throw Error('Invalid Mako media cache');
  const manifest=JSON.parse(await readFile(path.join(base,'manifest.json'),'utf8'));
  if(manifest.format!=='prepared-web-audio-v1'||manifest.failed!==0||!Array.isArray(manifest.files)||!manifest.files.some(r=>r.name.toLowerCase()==='songed2.opus'))throw Error('Mako original audio is incomplete');
  const audio=[],effects=[],seen=new Set();
  for(const r of manifest.files){
    const frames=Math.round(r.duration*48000),kind=audioKind(r.name),src=r.file;
    if(!/^\d+[.]ogg$/u.test(src)||seen.has(src)||!Number.isSafeInteger(frames)||frames<1||!Number.isSafeInteger(r.bytes)||r.bytes<1||!(/^[a-f0-9]{64}$/u.test(r.sha256))||r.state!=='prepared')throw Error('Invalid original audio '+r.name);
    seen.add(src);(kind==='effect'?effects:audio).push({src,kind,frames,channels:r.channels,sha256:r.sha256,bytes:r.bytes,name:r.name});
  }
  return {base,cache,encoded,audio,effects,manifest};
}
