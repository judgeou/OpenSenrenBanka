import { psbRecord } from '../../formats/psb-value.ts';
import type { PsbValue } from '../../formats/psb-value.ts';
export interface MotionCurve { readonly x: readonly number[]; readonly y: readonly number[] }
function numeric(value: PsbValue): number {
  const number = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(number)) throw new Error('Invalid MTN curve scalar'); return number;
}
/** Single-cubic native profile actually present on SD001AA's zcc.
 * The two-segment SD201 curve is opt-in; external spline/cp shapes still fail.
 */
export function motionCurve(value: PsbValue, twoSegments=false): MotionCurve {
  const row = psbRecord(value);
  const points=twoSegments?7:4, knots=twoSegments?[1,0,1]:[1,1];
  if (Object.keys(row).some(key => !['x', 'y', 'c'].includes(key)) || !Array.isArray(row.x) || !Array.isArray(row.y) ||
      row.x.length !== points || row.y.length !== points || !Array.isArray(row.c) || row.c.length !== knots.length || row.c.some((value,i) => numeric(value) !== knots[i])) throw new Error('Unsupported MTN curve topology');
  const x = row.x.map(numeric), y = row.y.map(numeric);
  if (x[0] !== 0 || x[points-1] !== 1 || y[0] !== 0 || y[points-1] !== 1 || (twoSegments && !(x[3]>0&&x[3]<1)) || [...x, ...y].some(value => value < 0 || value > 1)) throw new Error('Unsupported MTN curve domain/overshoot');
  return { x, y };
}
/** Follows the fixed reference PlayerInternal.h::evaluateBezierCurve profile:
 * x selects the cubic segment/endpoints; y is evaluated at the frame ratio.
 * This is intentionally NOT a CSS cubic-bezier inverse-x implementation.
 * Source provenance and the absence of native visual evidence are in README.
 */
export function motionEase(curve: MotionCurve | undefined, ratio: number): number {
  if (!Number.isFinite(ratio)) throw new Error('Invalid MTN curve ratio');
  if (!curve) return ratio;
  if (ratio <= curve.x[0]) return curve.y[0];
  const last=curve.x.length-1;
  if (ratio >= curve.x[last]) return curve.y[last];
  const first=last===6&&ratio>=curve.x[3]?3:0;
  const t=(ratio-curve.x[first])/(curve.x[first+3]-curve.x[first]);
  const u=1-t,y=curve.y;
  return u*u*u*y[first]+3*u*u*t*y[first+1]+3*u*t*t*y[first+2]+t*t*t*y[first+3];
}
