import type { NativeUiPlane, NativeUiPage, NativeUiRoot } from './native-ui-planes.ts';

/** One entry per original AbsoluteAdapter, not per glyph/child plane. */
export interface NativeUiAdapterOrder {
  readonly kind: 'adapter';
  readonly adapterId: string;
  readonly orderzpos: number;
  readonly absoluteBase: number;
  /** Original registration sequence among adapters, not a CSS z-index. */
  readonly registrationOrder: number;
  /** Child order inside this adapter's target; does not consume a world sort slot. */
  readonly localOrder: number;
}
export interface NativeUiAbsoluteOrder {
  readonly kind: 'absolute';
  /** Resolved original absolute within its parent root, never a cross-root z-index. */
  readonly absolute: number;
  readonly localOrder: number;
}
export type NativeUiOrder = NativeUiAdapterOrder | NativeUiAbsoluteOrder;
export interface NativeUiWorldOrder {
  readonly id: string;
  readonly orderzpos: number;
  readonly absoluteBase: number;
}
export type NativeUiOrderedLayer =
  | { readonly kind: 'world'; readonly id: string; readonly absolute: number }
  | { readonly kind: 'ui'; readonly plane: NativeUiPlane; readonly absolute: number };
export interface NativeUiComposition {
  /** Selected base plus world. Only this domain enters old/new transition targets. */
  readonly base: readonly NativeUiOrderedLayer[];
  /** Current uibase; draw once above the base/transition result. */
  readonly uibase: readonly Extract<NativeUiOrderedLayer, { kind: 'ui' }>[];
}
interface Adapter {
  readonly kind: 'adapter'; readonly id: string; readonly orderzpos: number;
  readonly root: NativeUiRoot; readonly absoluteBase: number;
  readonly registrationOrder: number; readonly planes: NativeUiPlane[];
}
function finite(value: number): void { if (!Number.isFinite(value)) throw new Error('Invalid native UI order depth'); }
function integer(value: number): void { if (!Number.isSafeInteger(value)) throw new Error('Invalid native UI absolute/order'); }
/**
 * Original onUpdateAbsolute: world then registered adapters, isUnder sort,
 * target.absolute = absoluteBase + sorted index. Keep hidden and opposite-page
 * adapters in this calculation. Sources: 00861.tjsasm:1360-1417,7374-7379,7794-7857.
 * Only AFTER resolving these original slots partition by parent root. The roots
 * are siblings in the default non-D3D KAG tree; uibase is above either base, not
 * another child in their absolute-index namespace. No implicit page switching.
 */
export function nativeUiOrder(world: readonly NativeUiWorldOrder[], planes: readonly NativeUiPlane[], page: NativeUiPage): NativeUiComposition {
  if (page !== 'fore' && page !== 'back') throw new Error('Unknown native UI selected base');
  const ids = new Set<string>(), adapters = new Map<string, Adapter>();
  for (const item of world) {
    if (!item.id || ids.has(item.id)) throw new Error('Duplicate native world order identity');
    ids.add(item.id); finite(item.orderzpos); integer(item.absoluteBase);
  }
  const planeIds = new Set<string>();
  for (const plane of planes) {
    if (!plane.id || planeIds.has(plane.id)) throw new Error('Duplicate native UI plane identity');
    planeIds.add(plane.id);
    if (plane.root !== 'fore.base' && plane.root !== 'back.base' && plane.root !== 'uibase') throw new Error('Unknown native UI parent root');
    const order = plane.order; integer(order.localOrder);
    if (order.kind === 'absolute') { integer(order.absolute); continue; }
    if (order.kind !== 'adapter' || !order.adapterId) throw new Error('Unknown native UI order kind');
    finite(order.orderzpos); integer(order.absoluteBase); integer(order.registrationOrder);
    const previous = adapters.get(order.adapterId);
    if (previous) {
      if (previous.root !== plane.root || previous.orderzpos !== order.orderzpos || previous.absoluteBase !== order.absoluteBase || previous.registrationOrder !== order.registrationOrder)
        throw new Error('Inconsistent native UI adapter children/root');
      previous.planes.push(plane);
    } else adapters.set(order.adapterId, { kind: 'adapter', id: order.adapterId, root: plane.root, orderzpos: order.orderzpos, absoluteBase: order.absoluteBase, registrationOrder: order.registrationOrder, planes: [plane] });
  }
  const registrations = new Set<number>();
  const sorted: (NativeUiWorldOrder | Adapter)[] = [...world];
  for (const adapter of [...adapters.values()].sort((a, b) => a.registrationOrder - b.registrationOrder)) {
    if (registrations.has(adapter.registrationOrder)) throw new Error('Ambiguous native adapter registration order');
    registrations.add(adapter.registrationOrder);
    let at = sorted.length;
    while (at > 0 && sorted[at - 1].orderzpos < adapter.orderzpos) at--;
    sorted.splice(at, 0, adapter);
  }
  type Ranked = { layer: NativeUiOrderedLayer; local: number; insertion: number };
  const ranked: Ranked[] = [];
  for (let at = 0; at < sorted.length; at++) {
    const item = sorted[at], absolute = item.absoluteBase + at; integer(absolute);
    if ('kind' in item) for (const plane of item.planes) ranked.push({ layer: { kind: 'ui', plane, absolute }, local: plane.order.localOrder, insertion: ranked.length });
    else ranked.push({ layer: { kind: 'world', id: item.id, absolute }, local: 0, insertion: ranked.length });
  }
  for (const plane of planes) if (plane.order.kind === 'absolute') ranked.push({ layer: { kind: 'ui', plane, absolute: plane.order.absolute }, local: plane.order.localOrder, insertion: ranked.length });
  const base: Ranked[] = [], overlay: Ranked[] = [], selected = page + '.base';
  for (const item of ranked) {
    if (item.layer.kind === 'world' || item.layer.plane.root === selected) base.push(item);
    else if (item.layer.plane.root === 'uibase') overlay.push(item);
  }
  const compare = (a: Ranked, b: Ranked) => a.layer.absolute - b.layer.absolute || a.local - b.local || a.insertion - b.insertion;
  base.sort(compare); overlay.sort(compare);
  return { base: base.map(item => item.layer), uibase: overlay.map(item => {
    if (item.layer.kind !== 'ui') throw new Error('World layer cannot belong to uibase');
    return item.layer;
  }) };
}
