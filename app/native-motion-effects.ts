import type { NativeGraphics } from '../src/graphics/native-graphics.ts';
import type { EntityWorld } from '../src/world/entity-world.ts';
import type { WorldCommands } from '../src/world/commands.ts';
import { AudioEntity } from '../src/world/audio-entity.ts';
import type { ScenePlayer } from '../src/runtime/scene-player.ts';

export function originalMotionSound(envinit:string, extended=false,route=false) {
  const owner=[...envinit.matchAll(/^\s*"motionseobj",\s*"([^"]+)",\s*$/gmu)];
  const map=envinit.split(/^[ \t]*"motionse",[ \t]*%\[[ \t]*\r?\n/mu)[1]?.split(/^[ \t]*\],[ \t]*\r?$/mu)[0];
  if(owner.length!==1||owner[0][1]!=='se')throw new Error('Missing original motionseobj');
  const wanted=['001',...(extended?['003','004']:[]),...(route?['007','009','010']:[])];
  const routes=new Map<string,{storage:string;volume:number}>();
  if(map)for(const row of map.matchAll(/^\s*"([0-9]{3})",\s*%\[storage:"([^"]+)",\s*"volume",\s*(\d+)\],\s*$/gmu)){
    if(!wanted.includes(row[1]))continue;
    if(routes.has('se'+row[1])||Number(row[3])>100)throw new Error('Ambiguous original motionse entry');
    routes.set('se'+row[1],{storage:row[2],volume:Number(row[3])});
  }
  if(routes.size!==wanted.length)throw new Error('Missing original motionse entries');
  return {owner:owner[0][1],routes};
}

/** Serial production owner: deliver each staged callback before advancing or painting another drawable. */
export class NativeMotionEffects {
  private readonly auditRows: object[]=[];
  constructor(private readonly graphics:NativeGraphics, private readonly world:EntityWorld,
    private readonly player:ScenePlayer, private readonly commands:WorldCommands,
    private readonly sound:ReturnType<typeof originalMotionSound>) {}
  get audit(): readonly object[] { return this.auditRows.slice(); }
  async paint(now:number,advance:boolean):Promise<boolean> {
    if(!this.graphics.motionActionOwners().length) return this.graphics.frame(now,advance);
    let result=await this.graphics.stageFrame(now,advance);
    while(result.kind==='motion-event') {
      const {ticket,deliveryId}=result;
      try {
        const event=this.graphics.peekMotionEvent(), owner=this.graphics.motionEventOwner();
        if (!event||event.deliveryId!==deliveryId||!owner||!this.world.get(owner.name)) throw new Error('Original motion lost its current world owner');
        // This profile permits only the proven original SE and ml1 notifications, with no receiver
        // changing graphical state while the ticket is yielded. Unknown delayed consumers fail closed.
        const labels=[event.action,'ml'+event.actionOrdinal];
        if(this.commands.captureDeferred().some(row=>row.deferred?.kind==='label'&&labels.includes(row.deferred.value))) throw new Error('Unbound original motion-label subscriber in active frame');
        for(const label of labels) for(const block of await this.commands.signal(label)) this.player.acceptHostWait(block);
        const cue=this.sound.routes.get(event.action);
        if(!cue)throw new Error('No original sound route for '+event.action);
        const audio=this.world.get(this.sound.owner);
        if(!(audio instanceof AudioEntity) || audio.kind!=='sound') throw new Error('Original motion SE object is absent: '+this.sound.owner);
        const played=await audio.playMotionEffect(cue.storage,cue.volume);
        this.auditRows.push({...event,owner:owner.name,receiver:this.sound.owner,storage:cue.storage,played,labels});
      } catch(error) { this.graphics.failMotionEvent(ticket,deliveryId); throw error; }
      this.graphics.ackMotionEvent(deliveryId);
      result=await this.graphics.resumeFrame(ticket);
    }
    return result.kind==='painted';
  }
}
