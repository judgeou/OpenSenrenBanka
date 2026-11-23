import type {MtnDocument} from '../mtn-catalog.ts';
import type {StageTexture,WebGlStage} from '../webgl-stage.ts';

interface Entry { holds:number; pending:Promise<StageTexture>; texture?:StageTexture }
export interface MotionAtlasLease { readonly texture:StageTexture; release():void }

/** Shared immutable stage textures. Motion poses, targets and cursors remain per instance. */
export class MotionAtlasLeases {
  private readonly documents=new Map<MtnDocument,Map<string,Entry>>();
  private closed=false;
  constructor(private readonly stage:WebGlStage) {}
  async acquire(document:MtnDocument,key:string,width:number,height:number):Promise<MotionAtlasLease>{
    if(this.closed)throw new Error('Motion atlas is closed');
    let entries=this.documents.get(document);
    if(!entries){entries=new Map();this.documents.set(document,entries);}
    let entry=entries.get(key);
    if(!entry){
      const created:Entry={holds:0,pending:Promise.resolve().then(async()=>{
        const image=await document.acquireTexture(key);
        try{
          if(this.closed)throw new Error('Motion atlas closed during decode');
          if(image.bitmap.width!==width||image.bitmap.height!==height)throw new Error('Prepared MTN texture extent mismatch');
          return created.texture=this.stage.upload(image.bitmap,width,height);
        }finally{image.release();}
      })};
      entries.set(key,created);entry=created;
    }
    const row=entry, table=entries;row.holds++;
    let live=true;
    const release=()=>{
      if(!live)return;live=false;
      if(--row.holds!==0)return;
      table.delete(key);if(!table.size)this.documents.delete(document);
      if(row.texture)this.stage.release(row.texture);
    };
    try{
      const texture=await row.pending;
      if(this.closed||texture.width!==width||texture.height!==height)throw new Error('Shared MTN texture surface is unavailable');
      return {texture,release};
    }catch(error){release();throw error;}
  }
  close():void{this.closed=true;}
}
