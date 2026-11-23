import {psbRecord} from '../formats/psb-value.ts';import type {PsbValue} from '../formats/psb-value.ts';import {nativeBoolean} from '../world/native-values.ts';
export interface NativeImageRequest{readonly file:string;readonly options:Readonly<{[key:string]:PsbValue}>;readonly raw:Readonly<{[key:string]:PsbValue}>}
/** Original candidate priority: first empty/true condition, otherwise the last candidate. */
export function imageRequest(value:PsbValue,evaluate:(source:string)=>PsbValue):NativeImageRequest{
  let selected=value;if(Array.isArray(value)){if(!value.length)throw new Error('Empty native image candidate list');selected=value[value.length-1];for(const item of value){const record=psbRecord(item),condition=record.eval;if(condition===undefined||condition===null||condition===''||typeof condition==='string'&&nativeBoolean(evaluate(condition))){selected=item;break;}if(typeof condition!=='string')throw new Error('Invalid image candidate condition');}}
  const raw=psbRecord(selected);if(typeof raw.file!=='string')throw new Error('Missing image filename');const file=raw.file.startsWith('&')?evaluate(raw.file.slice(1)):raw.file;if(typeof file!=='string')throw new Error('Image filename expression did not return text');
  return{file,options:raw.options===undefined||raw.options===null?Object.create(null):psbRecord(raw.options),raw};
}
