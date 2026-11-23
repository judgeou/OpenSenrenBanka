import {psbRecord} from '../../formats/psb-value.ts';
import type {PsbValue} from '../../formats/psb-value.ts';
import type {MtnTrack} from '../mtn-program.ts';

export const meshBit = 0x2000000;
const exact = (v: PsbValue | undefined, n: number) => v === n || v === BigInt(n);

/** A root raster can select the mesh path without supplying any control-point
 * displacement. With no child synchronization or inherited mesh the mesh is
 * then the unmoved image rectangle. Actual deformations remain unsupported. */
export function identityMeshTrack(t: MtnTrack, field: (key: string) => PsbValue | undefined): boolean {
  return exact(field('type'), 0) && t.parent === undefined && t.children.length === 0 &&
    exact(field('meshTransform'), 1) && exact(field('meshSyncChildMask'), 0) && exact(field('meshDivision'), 10);
}

export function identityMeshFrame(content: Record<string, PsbValue>): boolean {
  const m = psbRecord(content.mesh);
  return exact(content.mask, Number(content.mask) | meshBit) && Object.keys(m).length === 2 && m.bp === null && m.cc === null;
}
