export type MixBus = 'bgm'|'voice'|'se';
export type AudioMix = Record<MixBus,number> & {master?:number};

/** Apply user attenuation after original gain/curve/voice corrections, so saves
 * keep authored track gains and restoring them never restores obsolete settings. */
export class EditionMix {
  private readonly outputs=new Map<MixBus,GainNode>();
  private readonly master:GainNode;
  constructor(context:AudioContext,destination:AudioNode,private readonly levels:AudioMix){
    this.master=context.createGain();this.master.gain.value=levels.master??1;this.master.connect(destination);
    for(const key of ['bgm','voice','se'] as const){const n=context.createGain();n.gain.value=levels[key];n.connect(this.master);this.outputs.set(key,n);}
  }
  output(channel:string,storage:string):AudioNode{
    const name=storage.replaceAll('\\','/').split('/').at(-1)??'';
    const bus=channel.startsWith('voice/')?'voice':channel==='title/bgm'||/^(?:bgm|song)/iu.test(name)?'bgm':'se';
    return this.outputs.get(bus)!;
  }
  tick():void{
    const master=this.levels.master??1;if(this.master.gain.value!==master&&master>=0&&master<=1)this.master.gain.value=master;
    for(const [key,node] of this.outputs){const v=this.levels[key];if(node.gain.value!==v&&v>=0&&v<=1)node.gain.value=v;}
  }
}
