import type {PsbValue} from '../src/formats/psb-value.ts';
import type {RuntimeCommand} from '../src/scenario/invocation.ts';
import type {SourceProgress} from './source-progress.ts';

const opCall={file:'OP_',flag:'movie_op',bgmflag:'SongOP',begincolor:'0xFFFFFF',endcolor:'0xFFFFFF'} as const;
const edCall={file:'ED1_Yosh',flag:'ed1_yosh',bgmflag:'SongED1',begincolor:'0xFFFFFF',endcolor:'0xFFFFFF',noaudio:'false'} as const;
const makoCall={file:'ED2_Mako',flag:'ed2_mako',bgmflag:'SongED2',begincolor:'0',endcolor:'0',noaudio:'false'} as const;
export type NativeEnding='yos'|'mak';
interface Asset { readonly url:URL; readonly duration:number; readonly sha256:string; readonly call:typeof opCall|typeof edCall|typeof makoCall }
interface Active {
  token:number; video:HTMLVideoElement; cover:HTMLDivElement; source:MediaElementAudioSourceNode;
  gain:GainNode; abort:AbortController; attempt:number; paused:boolean; started:boolean;
  ended:boolean; canSkip:boolean; error?:Error; location:string;
}
export interface MovieStatus { readonly phase:'loading'|'playing'|'paused'|'ending'|'idle'; readonly time:number;readonly duration:number;readonly interruptible:boolean;readonly endedCount:number }

/** Authored OP only: the absent canskip is derived from the original seen flag after cancelskip. Media callbacks
 * record owner-local results, never call the player or write system progress. */
export class NativeOp {
  private generation=0;
  private current?:Active;
  private coverPending?:HTMLDivElement;
  private endedCount=0;
  private closed=false;
  private readonly normal:Asset;
  private constructor(private asset:Asset,private readonly endings:Readonly<Partial<Record<NativeEnding,Asset>>>,private readonly viewport:HTMLElement,private readonly context:AudioContext,
    private readonly level:number,private readonly progress:Pick<SourceProgress,'hasMarker'|'marker'>,private readonly wake?:()=>void) {this.normal=asset;}
  static async open(descriptor:URL,viewport:HTMLElement,context:AudioContext,level:number,progress:Pick<SourceProgress,'hasMarker'|'marker'>,ending?:URL,endingMako?:URL,wake?:()=>void):Promise<NativeOp>{
    const read=async(input:URL,heroine?:NativeEnding):Promise<Asset>=>{
      const response=await fetch(input);if(!response.ok)throw Error('原影片清单 HTTP '+response.status);
      const r=await response.json(), call=heroine==='mak'?makoCall:heroine==='yos'?edCall:opCall;
      if(r?.format!==(heroine?'senren-r69-ed-v1':'senren-r67-op-v1')||r.file!==call.file+'1080.mp4'||!Number.isFinite(r.duration)||r.duration<=0||r.video?.width!==1920||r.video.height!==1080||r.video.codec!=='h264'||r.audio?.codec!=='aac'||r.audio.channels!==2||!/^[0-9a-f]{64}$/.test(r.sha256)||!sameCall(r.command,call)||!Number.isFinite(level)||level<0||level>1)throw Error('原影片清单与生产合同不一致');
      const url=new URL(r.file,input);
      if(url.origin!==location.origin)throw Error('原影片必须来自同一个包');
      return {url,duration:r.duration,sha256:r.sha256,call};
    };
    const [op,yos,mak]=await Promise.all([read(descriptor),ending?read(ending,'yos'):undefined,endingMako?read(endingMako,'mak'):undefined]);
    return new NativeOp(op,{yos,mak},viewport,context,level,progress,wake);
  }
  view():MovieStatus | undefined {
    const a=this.current;
    if(!a&&!this.coverPending&&!this.endedCount)return;
    return {phase:a?(a.paused?'paused':a.started?'playing':'loading'):this.coverPending?'ending':'idle',time:a?.video.currentTime??(this.endedCount?this.asset.duration:0),duration:this.asset.duration,interruptible:!!a?.canSkip&&a.started&&!a.paused&&!a.ended,endedCount:this.endedCount};
  }
  get opaqueVideo():boolean{return !!this.current?.started;}
  get returningToGame():boolean{return !!this.coverPending;}
  get active():boolean{return !!this.current||!!this.coverPending;}
  // The converted ED sflag precedes the media gate. Commit it from complete(),
  // not from the source marker, so first viewing and failed media remain unseen.
  defersSeenMarker(value:string):boolean{return Object.values(this.endings).some(film=>film?.call.flag===value);}
  private film(command:RuntimeCommand):Asset|undefined{
    const list=[this.normal,...Object.values(this.endings)];return list.find(a=>a&&sameCall(command.parameters,a.call));
  }
  preflight(command:RuntimeCommand):void{
    if(this.closed||this.active||!this.film(command))throw Error('原 sysmovie 调用不可用或不在已核对的 OP 合同内');
  }
  startEndingReplay(heroine:NativeEnding='yos'):number {
    const film=this.endings[heroine];if(!film||!this.progress.hasMarker(film.call.flag))throw Error('这条路线的片尾尚未解锁');
    return this.start({name:'sysmovie',parameters:film.call,order:Object.keys(film.call),deferred:undefined,location:{asset:'replay.ks/*edmovie_'+heroine,scene:0,event:0,sourceRef:0}}).token;
  }
  start(command:RuntimeCommand):{token:number;interruptible:boolean} {
    this.preflight(command);
    const film=this.film(command)!;this.asset=film;
    const token=++this.generation;
    if(!Number.isSafeInteger(token)||this.context.state==='closed')throw Error('原 OP 音视频所有权已失效');
    const {asset,scene,event,sourceRef}=command.location;
    const at=asset+':'+scene+':'+event+' (source '+sourceRef+')';
    const cover=document.createElement('div'), video=document.createElement('video');
    cover.className='original-op';cover.setAttribute('role','region');cover.setAttribute('aria-label',film.call!==opCall?'原始片尾':'原始片头');
    if(film.call.begincolor==='0')cover.style.background='#000';
    video.playsInline=true;video.controls=false;video.disablePictureInPicture=true;video.disableRemotePlayback=true;
    video.preload='auto';video.style.visibility='hidden';cover.append(video);
    const source=this.context.createMediaElementSource(video),gain=this.context.createGain(),abort=new AbortController();
    const a:Active={token,video,cover,source,gain,abort,attempt:0,paused:document.hidden,started:false,ended:false,canSkip:this.progress.hasMarker(film.call.flag),location:at};
    this.current=a;
    try {
      gain.gain.value=this.level; source.connect(gain); gain.connect(this.context.destination);
      const on=(name:string,f:()=>void)=>video.addEventListener(name,()=>{if(this.current===a&&!a.error)f();},{signal:abort.signal});
      on('loadedmetadata',()=>{
        if(Math.abs(video.duration-this.asset.duration)>.16||video.videoWidth!==1920||video.videoHeight!==1080)this.fail(a,'画幅或时长与原片不符');
      });
      on('playing',()=>{if(a.paused||document.hidden){video.pause();return;}a.started=true;video.style.visibility='visible';this.wake?.();});
      on('ended',()=>{if(!a.started||!video.ended||video.currentTime<this.asset.duration-.18){this.fail(a,'未完成原片即结束');return;}a.ended=true;this.wake?.();});
      on('error',()=>this.fail(a,'媒体装载或解码错误 '+(video.error?.code??'')+' '+(video.error?.message??'')));
      this.viewport.append(cover);video.src=this.asset.url.href;
      if(!a.paused)this.play(a);
      return {token,interruptible:a.canSkip};
    }catch(error){this.release(a,false);throw Error('原 OP '+at+' 装配失败',{cause:error});}
  }
  private fail(a:Active, error:string):void{a.error=Error('原 OP '+a.location+' '+this.asset.url.pathname.split('/').at(-1)+'：'+error);a.video.pause();this.wake?.();}
  private play(a:Active):void{
    const key=++a.attempt;
    void a.video.play().catch((error:unknown)=>{if(this.current===a&&a.attempt===key&&!a.paused&&!a.ended)this.fail(a,error instanceof Error?error.message:String(error));});
  }
  pause(paused:boolean):void{
    const a=this.current;if(!a||a.error||a.paused===paused)return;
    a.paused=paused;
    if(paused){a.attempt++;a.video.pause();}
    else if(!a.ended)this.play(a);
  }
  ready(token:number):boolean {
    const a=this.current;
    if(!a||a.token!==token)throw Error('原 OP 等待属于已退役的播放者');
    if(a.error)throw a.error;
    if(!a.ended||a.paused||document.hidden)return false;
    this.complete(a);return true;
  }
  skip(token:number):void{
    const a=this.current;
    if(!a||a.token!==token||!a.canSkip||!a.started||a.paused||a.error)throw Error('原片头当前不可跳过');
    this.complete(a);
  }
  private complete(a:Active):void{
    this.release(a,true);this.endedCount++;
    // The authored sflags are committed exactly once, on successful playback.
    // While the media gate owns the player no intervening tag reads these flags.
    // Delayed commit prevents a failed browser playback from persisting "seen".
    this.progress.marker(this.asset.call.flag);this.progress.marker('bgm_'+this.asset.call.bgmflag.toUpperCase());
  }
  afterGamePaint():void{this.coverPending?.remove();this.coverPending=undefined;}
  private release(a:Active,keepWhite:boolean):void{
    if(this.current!==a)return;
    this.current=undefined;a.abort.abort();a.attempt++;a.video.pause();
    a.source.disconnect();a.gain.disconnect();a.video.removeAttribute('src');a.video.load();a.video.remove();
    if(keepWhite)this.coverPending=a.cover;else a.cover.remove();
  }
  close():void{if(this.closed)return;this.closed=true;if(this.current)this.release(this.current,false);this.afterGamePaint();}
}
function sameCall(v:Readonly<Record<string,PsbValue>>|undefined,call:Asset['call']):boolean{
  return !!v&&Object.keys(v).length===Object.keys(call).length&&Object.entries(call).every(([key,value])=>v[key]===value);
}
