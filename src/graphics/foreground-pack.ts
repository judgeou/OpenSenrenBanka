import { delimitedRows } from '../formats/delimited.ts';
import { parseTjsData } from '../formats/tjs-data.ts';
import type { PimgLayout, PimgLayer } from './pimg-layout.ts';
export interface ForegroundPack { readonly name: string; readonly pageWidth: number; readonly pageHeight: number; readonly offsetX: number; readonly offsetY: number; readonly layout: PimgLayout; readonly imageFragments: ReadonlyMap<number,unknown> }
/** Original 13-column text-backed PSD metadata; scalar and image-list parsing never executes TJS. */
export function foregroundPack(name: string, text: string): ForegroundPack {
  const rows = delimitedRows(text,'\t').filter(row => row.cells.some(cell=>cell!=='') && !row.cells[0].startsWith('#'));
  const numeric = (value: string | undefined, fallback?: number): number => { if (value === undefined || value === '') { if (fallback !== undefined) return fallback; throw new Error('Missing foreground numeric column'); } const number = Number(value); if (!Number.isSafeInteger(number) || Math.abs(number)>2147483647) throw new Error('Invalid foreground numeric column'); return number; };
  let pageWidth = 0, pageHeight = 0; const input: { cells: readonly string[]; line: number }[] = [];
  for (const row of rows) { if (!row.cells[0]) { pageWidth = numeric(row.cells[4]); pageHeight = numeric(row.cells[5]); } else input.push(row); }
  if (pageWidth < 1 || pageHeight < 1 || pageWidth*pageHeight > 128*1024*1024) throw new Error('Foreground page exceeds budget');
  let left = pageWidth-1, top = pageHeight-1, right = 0, bottom = 0;
  for (const row of input) if (numeric(row.cells[0]) === 0) { const x=numeric(row.cells[2]), y=numeric(row.cells[3]), w=numeric(row.cells[4]), h=numeric(row.cells[5]); if (w>0 && h>0) { left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x+w); bottom=Math.max(bottom,y+h); } }
  left=Math.max(0,left); top=Math.max(0,top); right=Math.min(pageWidth,right); bottom=Math.min(pageHeight,bottom);
  if (right <= left || bottom <= top) throw new Error('Foreground has no raster bounds');
  const imageFragments = new Map<number,unknown>(), layers: PimgLayer[] = [], byId = new Map<number,PimgLayer>(), groups = new Map<number,number>();
  for (const row of input) { const cells = row.cells, layerType = numeric(cells[0]); if (layerType !== 0 && layerType !== 2) throw new Error('Unknown foreground layer kind');
    const id = layers.length, sourceId = cells[9] ?? '', numericId = /^-?[0-9]+$/u.test(sourceId) ? numeric(sourceId) : -1, drawType = numeric(cells[6],13), opacity=numeric(cells[7],255), visible=numeric(cells[8],1);
    if (opacity<0 || opacity>255 || visible!==0 && visible!==1) throw new Error('Invalid foreground appearance');
    const imageName = layerType===2 || sourceId==='' || /^-/u.test(sourceId) || numeric(cells[4],0)===0 || numeric(cells[5],0)===0 ? undefined : /^[1-9][0-9]*$/u.test(sourceId) ? name.replace(/[.]txt$/iu,'')+'_'+sourceId : sourceId;
    const layer: PimgLayer = { id, layerId: numericId, name: cells[1], layerType, sourceParentId: cells[10] ? numeric(cells[10]) : undefined, drawType, opacity, visible: visible===1, left: numeric(cells[2],0)-left, top: numeric(cells[3],0)-top, width:numeric(cells[4],0),height:numeric(cells[5],0),sourceRef:row.line,imageName };
    if (cells[12]) imageFragments.set(id,parseTjsData(cells[12])); layers.push(layer); byId.set(id,layer); if(layerType===2) { if(groups.has(numericId))throw new Error('Duplicate foreground group'); groups.set(numericId,id); }
  }
  const roots: number[] = [], children = new Map<number,number[]>();
  for(const layer of layers) { const parentId = layer.sourceParentId===undefined?undefined:groups.get(layer.sourceParentId); Object.assign(layer,{parentId}); if(parentId===undefined) roots.push(layer.id); else { const list=children.get(parentId)??[];list.push(layer.id);children.set(parentId,list); }
    const seen=new Set<number>();let current:PimgLayer|undefined=layer;while(current){if(seen.has(current.id)||seen.size>256)throw new Error('Cyclic foreground groups');seen.add(current.id);current=current.parentId===undefined?undefined:byId.get(current.parentId);} }
  return {name,pageWidth,pageHeight,offsetX:left,offsetY:top,layout:{width:right-left,height:bottom-top,layers,roots,children,byId},imageFragments};
}
