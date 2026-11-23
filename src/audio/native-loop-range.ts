import { audioTimeline } from './audio-timeline.ts';
import type { AudioAsset } from './audio-catalog.ts';
import type { AudioLink } from './audio-timeline.ts';
export interface NativeLoopRange { readonly start: number; readonly end: number }
function condition(link: AudioLink, flags: ReadonlyMap<number, number>): boolean {
  const value = flags.get(link.variable) ?? 0;
  if (!Number.isSafeInteger(value) || link.variable > 15) throw new Error('Invalid native SLI flag state');
  switch (link.condition.toLowerCase()) {
    case 'no': return true;
    case 'eq': return value === link.reference;
    case 'ne': return value !== link.reference;
    case 'lt': return value < link.reference;
    case 'le': return value <= link.reference;
    case 'gt': return value > link.reference;
    case 'ge': return value >= link.reference;
    default: throw new Error('Unsupported native SLI condition: ' + link.condition);
  }
}
/** R62's fresh WaveSoundBuffers retain zero-initialized flags: no flag-mutating command is enabled.
 * Supports the original one-backward-link loop (including BGM01's eq flag[0]==0), not a guessed EOF loop.
 * A mutable/complex transport or smoothing remains an explicit unsupported capability, never an approximation. */
export function nativeLoopRange(asset: AudioAsset, looping: boolean, flags: ReadonlyMap<number, number> = new Map()): NativeLoopRange | undefined {
  const timeline = audioTimeline(asset); if (!looping) return undefined;
  if (!timeline.links.length) return { start: 0, end: asset.duration };
  if (timeline.links.some(link => link.smooth)) throw new Error('Native smooth SLI transport is not bound: ' + asset.name);
  const selected = timeline.links.filter(link => condition(link, flags));
  if (selected.length !== 1 || timeline.links.length !== 1) throw new Error('Native conditional/multilink SLI topology is not bound: ' + asset.name);
  const link=selected[0],rate=asset.loopSampleRate??asset.sampleRate,start=link.to/rate,end=link.from/rate;
  if (link.from <= link.to || start < 0 || end > asset.duration || end <= start) throw new Error('Original loop is outside decoded timeline: ' + asset.name);
  return { start, end };
}
