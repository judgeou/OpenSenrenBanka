import type { Psb2Reader } from '../formats/psb2/reader.ts';

export interface PimgLayer {
  readonly id: number; readonly layerId: number; readonly parentId?: number; readonly sourceParentId?: number; readonly name: string; readonly layerType: 0 | 2; readonly drawType: number;
  readonly left: number; readonly top: number; readonly width: number; readonly height: number;
  readonly opacity: number; readonly visible: boolean; readonly sameImageId?: number; readonly sourceRef: number; readonly imageName?: string;
}
export interface PimgLayout { readonly width: number; readonly height: number; readonly layers: readonly PimgLayer[]; readonly roots: readonly number[]; readonly children: ReadonlyMap<number, readonly number[]>; readonly byId: ReadonlyMap<number, PimgLayer> }

export function pimgLayout(reader: Psb2Reader): PimgLayout {
  function integer(ref: number, key: string, optional = false): number | undefined {
    const at = reader.property(ref, key);
    if (at === undefined || reader.node(at).kind === 'null') { if (optional) return undefined; throw new Error('Missing PIMG ' + key); }
    const node = reader.node(at);
    if (node.kind !== 'integer' || node.value < -2147483648n || node.value > 2147483647n) throw new Error('Invalid PIMG ' + key);
    return Number(key === 'left' || key === 'top' ? node.nativeValue : node.value);
  }
  const root = reader.header.root, width = integer(root, 'width')!, height = integer(root, 'height')!;
  if (width < 1 || height < 1 || width * height > 64 * 1024 * 1024) throw new Error('PIMG canvas budget exceeded');
  const layersAt = reader.property(root, 'layers'), source = layersAt === undefined ? undefined : reader.node(layersAt);
  if (source?.kind !== 'array') throw new Error('PIMG layer list is missing');
  const records: PimgLayer[] = [], byId = new Map<number, PimgLayer>();
  for (const ref of source.items) {
    const node = reader.node(ref); if (node.kind !== 'object') throw new Error('PIMG layer record is not a dictionary');
    const layerId = integer(ref, 'layer_id')!, id = records.length, layerType = integer(ref, 'layer_type')!, nameAt = reader.property(ref, 'name');
    const name = nameAt === undefined ? undefined : reader.node(nameAt);
    if ((layerType !== 0 && layerType !== 2) || name?.kind !== 'string') throw new Error('Invalid PIMG layer identity');
    const sameImageId = integer(ref, 'same_image', true), imageId = sameImageId ?? layerId;
    let imageName: string | undefined;
    for (const extension of ['.tlg', '.png', '.jpg', '.jpeg', '.bmp']) {
      const key = imageId + extension, at = reader.property(root, key);
      if (at !== undefined && reader.node(at).kind === 'resource') { imageName = key; break; }
    }
    const opacity = integer(ref, 'opacity')!, visible = integer(ref, 'visible')!;
    const left = integer(ref, 'left')!, top = integer(ref, 'top')!, layerWidth = integer(ref, 'width')!, layerHeight = integer(ref, 'height')!;
    if (opacity < 0 || opacity > 255 || (visible !== 0 && visible !== 1) || layerWidth < 0 || layerHeight < 0) throw new Error('Invalid PIMG layer appearance');
    const layer: PimgLayer = { id, layerId, sourceParentId: integer(ref, 'group_layer_id', true), name: name.value, layerType,
      drawType: integer(ref, 'type')!, left, top, width: layerWidth, height: layerHeight, opacity, visible: visible === 1,
      sameImageId, sourceRef: ref, imageName };
    records.push(layer); byId.set(id, layer);
  }
  const groups = new Map<number, number>();
  for (const layer of records) if (layer.layerType === 2) {
    if (groups.has(layer.layerId)) throw new Error('Ambiguous PIMG group identity');
    groups.set(layer.layerId, layer.id);
  }
  for (const layer of records) {
    const parentId = layer.sourceParentId === undefined ? undefined : groups.get(layer.sourceParentId);
    Object.assign(layer, { parentId }); Object.freeze(layer);
  }
  const roots: number[] = [], children = new Map<number, number[]>();
  for (const layer of records) {
    if (layer.parentId !== undefined && byId.has(layer.parentId)) {
      const values = children.get(layer.parentId) ?? []; values.push(layer.id); children.set(layer.parentId, values);
    } else roots.push(layer.id);
    const seen = new Set<number>(); let cursor: PimgLayer | undefined = layer;
    while (cursor) {
      if (seen.has(cursor.id) || seen.size > 256) throw new Error('Cyclic/over-budget PIMG group hierarchy');
      seen.add(cursor.id); cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
  }
  return { width, height, layers: Object.freeze(records), roots: Object.freeze(roots), children, byId };
}
