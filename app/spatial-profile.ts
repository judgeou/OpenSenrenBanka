import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
/** World/image matrices are derived; old raster/attachment semantics must not silently cross this boundary. */
export const spatialProfile = 'native-screen-center-rbase-imagemulti-flatpsd-visible-v4';
export function assertSpatialWorld(value: PsbValue, identity: string): void {
  const world = psbRecord(value);
  if (world.format !== 'senren-native-session-world-v1' || world.schemaVersion !== 1n || world.identity !== identity) throw new Error('快速槽不属于当前原资源／会话版本，原槽保留');
  if (world.spatialProfile !== spatialProfile) throw new Error('快速槽图形空间版本不兼容，原槽保留；请从原开始另存');
}
