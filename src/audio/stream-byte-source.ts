/** Pull from a single HTTP body; only the remainder of one transport chunk is retained. */
export class ResponseByteReader {
  private reader?: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
  private tail=new Uint8Array(0);
  private cursor:number;
  constructor(body:ReadableStream<Uint8Array<ArrayBuffer>>,start:number,readonly end:number){
    this.reader=body.getReader();this.cursor=start;
  }
  get position(){return this.cursor;}
  async take(limit:number):Promise<Uint8Array<ArrayBuffer>>{
    const reader=this.reader;
    if(limit<1||this.cursor>=this.end||!reader)throw Error('Media stream has no more bytes');
    while(!this.tail.length){
      const data=await reader.read();
      if(reader!==this.reader)throw new DOMException('Media stream cancelled','AbortError');
      if(data.done)throw Error('Truncated game media stream');
      if(data.value.length>this.end-this.cursor)throw Error('Game media stream exceeded its declared range');
      this.tail=data.value;
    }
    const piece=this.tail.subarray(0,limit);this.tail=this.tail.subarray(piece.length);this.cursor+=piece.length;
    if(this.cursor===this.end){reader.releaseLock();this.reader=undefined;this.tail=new Uint8Array(0);}
    return piece;
  }
  cancel():Promise<void>{
    const reader=this.reader;this.reader=undefined;this.tail=new Uint8Array(0);
    return reader?.cancel().catch(()=>{}).finally(()=>reader.releaseLock())??Promise.resolve();
  }
}

/** One open-ended Range for a contiguous playback run, with a timeout only while waiting for data. */
export class AudioByteRun {
  private readonly owner=new AbortController();
  private readonly signal:AbortSignal;
  private input?:ResponseByteReader;
  constructor(private readonly url:string,private readonly start:number,private readonly end:number,caller:AbortSignal){
    this.signal=AbortSignal.any([caller,this.owner.signal]);
    this.signal.addEventListener('abort',()=>void this.input?.cancel(),{once:true});
  }
  get position(){return this.input?.position??this.start;}
  async read(from:number,to:number,front:boolean):Promise<Uint8Array<ArrayBuffer>>{
    this.signal.throwIfAborted();
    if(from<this.position||from>=to||to>this.end)throw Error('Audio read falls outside the active response');
    const timer=setTimeout(()=>this.owner.abort(Error('Audio response stalled')),25000);
    try{
      if(!this.input){
        const reply=await fetch(this.url,{headers:{Range:'bytes='+this.start+'-'},signal:this.signal,priority:front?'high':'low'});
        const range=reply.headers.get('Content-Range'),encoding=reply.headers.get('Content-Encoding'),length=reply.headers.get('Content-Length');
        if(!reply.body||(encoding&&encoding!=='identity')||(length!==null&&Number(length)!==this.end-this.start)||
          !(reply.status===206&&range==='bytes '+this.start+'-'+(this.end-1)+'/'+this.end||this.start===0&&reply.status===200)){
          await reply.body?.cancel();throw Error('静态站必须支持原音频 HTTP Range：'+new URL(this.url).pathname);
        }
        this.signal.throwIfAborted();this.input=new ResponseByteReader(reply.body,this.start,this.end);
      }
      while(this.input.position<from)await this.input.take(from-this.input.position);
      const data=new Uint8Array(to-from);
      for(let offset=0;offset<data.length;){const chunk=await this.input.take(data.length-offset);data.set(chunk,offset);offset+=chunk.length;}
      this.signal.throwIfAborted();return data;
    }finally{clearTimeout(timer);}
  }
  close():void{this.owner.abort();}
}
