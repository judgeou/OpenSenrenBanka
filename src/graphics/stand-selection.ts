import { psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import { nativeNumber } from '../world/native-values.ts';
import type { DelimitedRow } from '../formats/delimited.ts';
export interface StandLayerReference { readonly path: string; readonly condition?: string; readonly pose?: string; readonly dress?: string }
export interface StandPose { readonly name: string; readonly paths: readonly string[]; readonly faceFolder?: string }
export interface StandDress { readonly name: string; readonly base: readonly string[]; readonly poses: ReadonlyMap<string,StandPose> }
export interface StandBase { readonly filename: string; readonly xoffset: number; readonly yoffset: number; readonly leveloffset: PsbValue | undefined; readonly dresses: ReadonlyMap<string,StandDress>; readonly faces: ReadonlyMap<string,readonly StandLayerReference[]> }
export function standBase(value: PsbValue, rows: readonly DelimitedRow[]): StandBase {
  const source = psbRecord(value); if (typeof source.filename !== 'string' || !source.filename) throw new Error('Missing stand base filename');
  const dresses = new Map<string, { name: string; base: string[]; poses: Map<string,{ name: string; paths: string[]; faceFolder?: string }> }>(), faces = new Map<string, StandLayerReference[]>();
  for (const row of rows) { const cells = row.cells, type = cells[0].toLowerCase();
    if (type === 'dress') {
      if (cells.length < 4 || !cells[1]) throw new Error('Invalid stand dress row at ' + row.line); const name = cells[1].toLowerCase();
      const dress: { name: string; base: string[]; poses: Map<string, { name: string; paths: string[]; faceFolder?: string }> } = dresses.get(name) ?? { name, base: [], poses: new Map() }; dresses.set(name, dress); const kind = cells[2].toLowerCase();
      if (kind === 'base') dress.base.push(cells[3]);
      else if (kind === 'pose' || kind === 'diff') { if (cells.length < 5 || !cells[3] || !cells[4]) throw new Error('Invalid stand pose row');
        const key = cells[3].toLowerCase(), pose = dress.poses.get(key) ?? { name: key, paths: [] }; pose.paths.push(cells[4]); if (cells[5]) pose.faceFolder = cells[5]; dress.poses.set(key, pose);
      } else throw new Error('Unsupported stand dress subrecord: ' + kind);
    } else if (type === 'face') {
      if (cells.length < 3 || !cells[1]) throw new Error('Invalid stand face row'); const name = cells[1].toLowerCase(), marker = name.search(/[#@]/u), key = marker < 0 ? name : name.slice(0,marker), target = marker < 0 ? '' : name.slice(marker);
      let pose: string | undefined, dress: string | undefined; if (target.startsWith('#')) { const at = target.indexOf('@'); pose = at < 0 ? target.slice(1) : target.slice(1,at); if (at >= 0) dress = target.slice(at+1); } else if (target.startsWith('@')) dress = target.slice(1);
      const column = cells[2].toLowerCase() === 'base' ? 3 : 2; if (!cells[column]) throw new Error('Missing stand face layer');
      const list = faces.get(key) ?? []; list.push({ path: cells[column], condition: cells[column+1] || undefined, pose, dress }); faces.set(key,list);
    } else throw new Error('Unsupported stand table record: ' + type);
  }
  return { filename: source.filename, xoffset: nativeNumber(source.xoffset,0), yoffset: nativeNumber(source.yoffset,0), leveloffset: source.leveloffset, dresses, faces };
}
function matches(pattern: string | undefined, name: string): boolean {
  if (!pattern) return true; const invert = pattern.startsWith('!'), text = invert ? pattern.slice(1) : pattern; const result = text.endsWith('*') ? name.startsWith(text.slice(0,-1)) : name === text; return invert ? !result : result;
}
export interface StandSelection { readonly base: StandBase; readonly dress: string; readonly pose: string; readonly face: string; readonly layers: readonly StandLayerReference[] }
/** Selection is data planning. Conditional paths remain expressions for the bounded scene evaluator. */
export function selectStand(bases: readonly StandBase[], options: Readonly<{ [key: string]: PsbValue }>, previous?: StandSelection): StandSelection {
  if (!bases.length) throw new Error('Stand has no bases'); const dress = String(options.dress ?? previous?.dress ?? bases.flatMap(base => [...base.dresses.keys()])[0] ?? '').toLowerCase();
  const available = bases.filter(base => base.dresses.has(dress)); if (!available.length) throw new Error('Unknown stand dress: ' + dress);
  let pose = String(options.diff ?? options.pose ?? previous?.pose ?? available[0].dresses.get(dress)!.poses.keys().next().value ?? '').toLowerCase();
  let base = previous && available.includes(previous.base) && previous.base.dresses.get(dress)?.poses.has(pose) ? previous.base : available.find(base => base.dresses.get(dress)!.poses.has(pose));
  if (!base) throw new Error('Unknown stand pose: ' + pose);
  const face = String(options.face ?? previous?.face ?? base.faces.keys().next().value ?? '').toLowerCase();
  if (!base.faces.has(face)) { const other = available.find(item => item.faces.has(face)); if (other) { base = other; if (!base.dresses.get(dress)!.poses.has(pose)) pose = base.dresses.get(dress)!.poses.keys().next().value ?? ''; } }
  const table = base.dresses.get(dress)!, poseInfo = table.poses.get(pose)!, faceLayers = base.faces.get(face);
  if (!faceLayers) throw new Error('Unknown stand face: ' + face);
  if (options.add !== undefined && options.add !== null && options.add !== '') throw new Error('Stand addition has no defined add group');
  const layers: StandLayerReference[] = [...table.base, ...poseInfo.paths].map(path => ({ path }));
  for (const layer of faceLayers) if (matches(layer.pose,pose) && matches(layer.dress,dress)) layers.push({ ...layer, path: poseInfo.faceFolder ? poseInfo.faceFolder+'/'+layer.path : layer.path });
  return { base, dress, pose, face, layers };
}
