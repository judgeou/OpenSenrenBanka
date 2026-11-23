import { psbRecord } from '../formats/psb-value.ts';
import type { PsbValue } from '../formats/psb-value.ts';
import type { AudioPlay, AudioTrackSnapshot } from './web-audio-engine.ts';
function number(value: PsbValue | undefined, name: string, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error('Invalid saved audio ' + name);
  return value;
}
function string(value: PsbValue | undefined, name: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Invalid saved audio ' + name); return value;
}
function ramp(value: PsbValue | undefined, name: string, low: number, high: number): { to: number; remaining: number } | undefined {
  if (value === undefined || value === null) return undefined; const row = psbRecord(value);
  return { to: number(row.to, name, low, high), remaining: number(row.remaining, name + ' duration', 0, 86400) };
}
/** Parse untrusted saved transport as data; no casts to AudioNode/engine state. */
export function audioTrackSnapshot(value: PsbValue): AudioTrackSnapshot {
  const row = psbRecord(value), source = psbRecord(row.request);
  const request: AudioPlay = { channel: string(source.channel, 'channel'), token: string(source.token, 'token'), storage: string(source.storage, 'storage'),
    offset: source.offset === undefined ? undefined : number(source.offset, 'offset', 0, 86400),
    gain: source.gain === undefined ? undefined : number(source.gain, 'request gain', 0, 16),
    pan: source.pan === undefined ? undefined : number(source.pan, 'request pan', -1, 1),
    rate: source.rate === undefined ? undefined : number(source.rate, 'rate', Number.MIN_VALUE, 32) };
  if (source.loop !== undefined && source.loop !== null) {
    const loop = psbRecord(source.loop), start = number(loop.start, 'loop start', 0, 86400), end = number(loop.end, 'loop end', 0, 86400);
    if (end <= start) throw new Error('Invalid saved audio loop range');
    return finish({ ...request, loop: { start, end } });
  }
  return finish(request);
  function finish(request: AudioPlay): AudioTrackSnapshot {
    if (typeof row.paused !== 'boolean') throw new Error('Invalid saved audio pause state');
    return { request, position: number(row.position, 'position', 0, 86400), paused: row.paused,
      gain: number(row.gain, 'gain', 0, 16), pan: number(row.pan, 'pan', -1, 1), gainRamp: ramp(row.gainRamp, 'gain ramp', 0, 16), panRamp: ramp(row.panRamp, 'pan ramp', -1, 1) };
  }
}
