import { EntityRegistry } from './entity-world.ts';
import { AudioEntity } from './audio-entity.ts';
import type { AudioEntityPolicy } from './audio-entity.ts';
import { GraphicEntity } from './graphic-entity.ts';
import type { GraphicEntityPort } from './graphic-entity.ts';
import type { EntityClasses } from './class-catalog.ts';
import type { NativeProperties } from './native-properties.ts';
/** Bind original class names to actual audio and graphic entities; all presentation policies are required. */
export function nativeEntityRegistry(classes: EntityClasses, audio: AudioEntityPolicy, graphics: GraphicEntityPort, properties: NativeProperties): EntityRegistry {
  if (audio.properties !== properties) throw new Error('Native entities must share the world property clock');
  const registry = new EntityRegistry();
  classes.register(registry, async (name, definition) => definition.kind === 'music' || definition.kind === 'sound' ? new AudioEntity(name, definition, audio) : new GraphicEntity(name, definition, graphics, properties));
  return registry;
}
