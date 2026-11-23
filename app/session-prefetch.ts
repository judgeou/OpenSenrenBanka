import type {AudioCatalog} from '../src/audio/audio-catalog.ts';
import type {ImageCatalog} from '../src/graphics/image-catalog.ts';
import type {ScenePlayer} from '../src/runtime/scene-player.ts';
import type {ResourcePrefetch,PrefetchRequest} from '../src/runtime/resource-prefetch.ts';
import type {PsbValue} from '../src/formats/psb-value.ts';

export class SessionPrefetch {
  private location='';
  constructor(private readonly pool:ResourcePrefetch,private readonly audio:AudioCatalog,private readonly pictures:ImageCatalog,
    private readonly startOffset:(storage:string,start:PsbValue|undefined)=>number){}
  stats(){return this.pool.stats;}
  limit(bytes:number):void {
    if(bytes!==this.pool.stats.limit){this.location='';this.pool.setLimit(bytes);if(!bytes)this.cancel();}
  }
  pause():void {this.pool.pause(true);}
  cancel():void {this.location='';this.pool.reset();}
  scan(player:ScenePlayer,canUseIdle:boolean):void {
    if(!this.pool.stats.limit||player.playback.skip!=='none'||player.waiting.kind!=='dialogue'){
      if(this.location)this.cancel();return;
    }
    if(!canUseIdle||document.hidden||player.clock.snapshot().paused){this.pause();return;}
    const p=player.position,k=p.asset+'/'+p.scene+'/'+p.cursor;
    if(k!==this.location){
      this.location=k;
      const requests:PrefetchRequest[]=[];
      // This is an optimization, never a second scenario interpreter or a
      // reason to fail a valid foreground load.
      try{
        for(const asset of player.forecast())try{
          if(asset.kind==='audio')requests.push(...this.audio.stream!.warmRequests(this.audio.resolve(asset.storage),this.startOffset(asset.storage,asset.start)));
          else {const request=this.pictures.warmRequest(asset.storage);if(request)requests.push(request);}
        }catch{/* Ambiguous or unsupported references are foreground only. */}
      }catch{/* A future source shape is not a prefetch candidate. */}
      this.pool.setPlan(requests);
    }
    this.pool.pause(false);
  }
}
