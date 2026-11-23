import { clonePsbValue, psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import { decodeNativeData, nativeBoolean, nativeNumber } from './native-values.ts';
import type { EntityRegistry, WorldEntity } from './entity-world.ts';
export interface EntityClassDefinition { readonly name: string; readonly kind: WorldEntity['kind']; readonly volumeName: string | undefined; readonly tracks: number; readonly skipSound: boolean; readonly event: boolean; readonly raw: { [key: string]: PsbValue } }
export class EntityClasses {
  readonly definitions: readonly EntityClassDefinition[]; private readonly names = new Map<string, EntityClassDefinition>();
  constructor(value: PsbValue) {
    const root = psbRecord(value); if (!Array.isArray(root.list)) throw new Error('Invalid native class definition list');
    this.definitions = Object.freeze(root.list.map(item => {
      const raw = psbRecord(item), name = raw.name, kind = raw.type;
      if (typeof name !== 'string' || !name || !['music', 'sound', 'layer', 'dlayer'].includes(String(kind)) || this.names.has(name)) throw new Error('Invalid/duplicate native entity class');
      const tracks = nativeNumber(raw.track, 1); if (!Number.isSafeInteger(tracks) || tracks < 1 || tracks > 256) throw new Error('Invalid native sound track count');
      const volumeName = raw.volumeName; if (volumeName !== undefined && volumeName !== null && typeof volumeName !== 'string') throw new Error('Invalid native volume bus');
      const entry = Object.freeze({ name, kind: kind as WorldEntity['kind'], volumeName: typeof volumeName === 'string' ? volumeName : undefined, tracks, skipSound: nativeBoolean(raw.skipFlag), event: nativeBoolean(raw.eventFlag), raw: clonePsbValue(raw) as { [key: string]: PsbValue } });
      this.names.set(name, entry); return entry;
    }));
  }
  static async open(url: string | URL, signal?: AbortSignal): Promise<EntityClasses> { const response = await fetch(url, { signal }); if (!response.ok) throw new Error('Native class definition HTTP ' + response.status); return new EntityClasses(decodeNativeData(await response.text())); }
  get(name: string): EntityClassDefinition { const definition = this.names.get(name); if (!definition) throw new Error('Unknown native class: ' + name); return definition; }
  register(registry: EntityRegistry, create: (name: string, definition: EntityClassDefinition) => Promise<WorldEntity>): void {
    for (const definition of this.definitions) registry.register(definition.name, name => create(name, definition));
  }
}
