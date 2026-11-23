import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {oggAudioInfo} from '../src/formats/ogg-audio.ts';
import {parseSli} from '../src/formats/sli.ts';
import {xp3Index} from './resources/xp3-index.ts';
const [root,out]=process.argv.slice(2),report=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
if(report.scope!=='r69-yos-voices'||path.basename(report.source)!=='voice.xp3'||report.cipher!=='GameRes.Formats.KiriKiri.SenrenCxCrypt')throw Error('Wrong voice archive');
const index=await xp3Index(report.source), rows=report.entries.filter(x=>x.state==='exported');
const cases=[['len011_030.ogg',535761339,144162541,30975,'len011_030_ref.ogg.sli'],['len011_031.ogg',3648250624,144193764,10571,'len011_031_ref.ogg.sli'],['yas104_038.ogg',3770494528,1327167015,43348,'yas104_038.ogg.sli']];
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=async x=>{const b=await readFile(path.join(root,x.file));if(sha(b)!==x.sha256||b.length!==x.bytes)throw Error('Unverified original payload');return b;};
await mkdir(out);const files=[];
for(const [slot,[name,hash,offset,bytes,sidecar]] of cases.entries()){
 if(!index.names.some(x=>x.name===name&&x.hash===hash)||!index.files.some(x=>x.hash===hash&&x.unpackedBytes===bytes))throw Error('Original archive identity changed '+name);
 const matches=rows.filter(x=>x.offset===offset&&x.bytes===bytes), links=rows.filter(x=>x.name===sidecar), row=matches[0], side=links[0];
 if(!row||matches.some(x=>x.sha256!==row.sha256)||!side||links.some(x=>x.sha256!==side.sha256))throw Error('Ambiguous original payload '+name);
 const audio=await original(row), labels=await original(side), info=oggAudioInfo(audio), id=String(90001+slot), file=id+'.ogg';
 const loops=parseSli(new TextDecoder('shift_jis',{fatal:true}).decode(labels));
 await writeFile(path.join(out,file),audio,{flag:'wx'});
 files.push({ id,file,name,...info,samples:String(info.samples),state:'prepared',bytes:audio.length,sha256:row.sha256,loops,loopSha256:side.sha256,loopEncoding:'shift_jis',source:{archive:'voice.xp3',offset,hash,exportedName:row.name} });
}
await writeFile(path.join(out,'manifest.json'),JSON.stringify({format:'senren-r69-original-voices-v1',files},null,2),{flag:'wx'});
