import type {PsbValue} from '../../formats/psb-value.ts';
export const makoPlaced203=(model:string,ref:number):boolean=>
  model.toLowerCase()==='sd203.mtn'&&[11356,15205,47229,47397,47563].includes(ref);
const flowers:Readonly<Record<number,readonly [number,number]>>={47229:[-291.75,83.25],47397:[-300,-26.25],47563:[-285,-136.5]};
export function makoPose203(ref:number,type:number,mask:number,row:Record<string,PsbValue>):readonly [number,number,number,number]{
  if(!(mask&2)){
    if(row.coord!==undefined||!(ref===11356&&type===3&&[0x80401,0x80001].includes(mask)||ref===15205&&type===2&&mask===0x80001))throw Error('Unsupported SD203 default child pose');
    return [0,0,1,1];
  }
  const c=row.coord,xy=flowers[ref]??(ref===11356?[42,18]:[-67.5,24.75]);
  if(!Array.isArray(c)||c.length!==3||Number(c[0])!==xy[0]||Number(c[1])!==xy[1]||Number(c[2])!==0)throw Error('Unsupported SD203 child translation');
  const z=ref===11356?1.100000023841858:1;
  if(!(ref===11356&&type===3&&mask===0x80063&&Number(row.zx)===z&&Number(row.zy)===z||ref===15205&&type===3&&mask===0x80c03||!!flowers[ref]&&type===2&&mask===0x80003))throw Error('Unsupported SD203 child mask');
  return [xy[0],xy[1],z,z];
}
