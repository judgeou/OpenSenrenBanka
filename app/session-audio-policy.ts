import type { AudioCatalog } from '../src/audio/audio-catalog.ts';
import type { WebAudioEngine } from '../src/audio/web-audio-engine.ts';
import { nativeLoopRange } from '../src/audio/native-loop-range.ts';
import type { AudioEntityPolicy } from '../src/world/audio-entity.ts';
import type { NativeProperties } from '../src/world/native-properties.ts';
import type { EntityClasses } from '../src/world/class-catalog.ts';
import { nativeNumber } from '../src/world/native-values.ts';
import { delimitedRows } from '../src/formats/delimited.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
import type { NativeMusicEventKind } from './ui/message-types.ts';
import type { SessionSettings } from './session-settings.ts';
import { originalText } from './original-text.ts';
export interface SessionAudioPolicy extends AudioEntityPolicy { voiceGain(storage: string, name: string): number }
function gains(source: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const { cells, line } of delimitedRows(source)) {
    const name = cells[0]?.trim(); if (!name || name.startsWith('#')) continue;
    const db = Number(cells[1]); if (!Number.isFinite(db) || Math.abs(db) > 96) throw new Error('Invalid original gain at line ' + line);
    const key = name.toLowerCase(); result.set(key, 10 ** (db / 20)); // Original tables apply later rows last.
  } return result;
}
function stem(value: string): string { return value.replaceAll('\\', '/').split('/').at(-1)!.replace(/[.](ogg|opus)$/iu, '').toLowerCase(); }
export async function sessionAudioPolicy(root: URL, catalog: AudioCatalog, engine: WebAudioEngine,
  properties: NativeProperties, now: () => number, evaluate: (source: string) => PsbValue,
  mode: () => Readonly<PlaybackMode>, settings: SessionSettings, classes: EntityClasses,
  musicEvent: (name: string, event: NativeMusicEventKind, storage?: string) => void): Promise<SessionAudioPolicy> {
  const [fileSource, busSource] = await Promise.all([originalText(root, 'filegain.csv'), originalText(root, 'soundgain.csv')]);
  const files = gains(fileSource), buses = gains(busSource);
  // An explicit per-file correction REPLACES the category/character correction; it does not multiply both.
  const correction = (storage: string, category?: string) => files.get(stem(storage)) ?? buses.get(category?.toLowerCase() ?? '') ?? 1;
  return { engine, properties, now, evaluate, musicEvent,
    resolve: storage => catalog.resolve(storage).name,
    enabled: definition => !(definition.skipSound && settings.noSeWhenSkip && mode().skip !== 'none'),
    busGain(name) { const key = name?.toLowerCase() ?? 'wave'; if (!Object.hasOwn(settings.volumes, key)) throw new Error('Unbound original audio volume bus: ' + name); return settings.volumes[key]; },
    fileGain: (storage, className) => correction(storage, classes.get(className).volumeName),
    voiceGain: (storage, name) => settings.volumes.voice * correction(storage, name),
    startOffset(storage, start) { if (start === undefined || start === null || start === '') return 0;
      if (typeof start === 'string' && !/^[0-9]+(?:[.][0-9]+)?$/u.test(start)) { const label = catalog.resolve(storage).loops.find(block => block.kind === 'Label' && block.fields.Name === start); if (!label || typeof label.fields.Position !== 'number') throw new Error('Unknown original audio start label: ' + start); const asset=catalog.resolve(storage);return label.fields.Position/(asset.loopSampleRate??asset.sampleRate); }
      const seconds = nativeNumber(start) / 1000; if (seconds < 0 || seconds > catalog.resolve(storage).duration) throw new Error('Native audio start offset exceeds duration'); return seconds; },
    loopRange: (storage, looping) => nativeLoopRange(catalog.resolve(storage), looping) };
}
