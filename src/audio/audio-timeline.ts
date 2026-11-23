import type { AudioAsset } from './audio-catalog.ts';
export interface AudioLabel { readonly sample: number; readonly time: number; readonly name: string }
export interface AudioLink { readonly from: number; readonly to: number; readonly smooth: boolean; readonly condition: string; readonly variable: number; readonly reference: number }
export interface AudioTimeline { readonly labels: readonly AudioLabel[]; readonly links: readonly AudioLink[] }
function integer(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid audio timeline ' + field); return value; }
export function audioTimeline(asset: AudioAsset): AudioTimeline {
  const labels: AudioLabel[] = [], links: AudioLink[] = [];
  for (const block of asset.loops) {
    const value = block.fields;
    if (block.kind === 'Label') {
      const sample = integer(value.Position, 'label position'); if (typeof value.Name !== 'string') throw new Error('Invalid audio label name'); labels.push({ sample, time: sample / (asset.loopSampleRate??asset.sampleRate), name: value.Name });
    } else if (block.kind === 'Link') {
      const from = integer(value.From, 'link source'), to = integer(value.To, 'link destination');
      const smooth = typeof value.Smooth === 'boolean' ? value.Smooth : typeof value.Smooth === 'string' && /^(true|false)$/iu.test(value.Smooth) ? value.Smooth.toLowerCase() === 'true' : undefined;
      if (smooth === undefined || typeof value.Condition !== 'string') throw new Error('Invalid audio link settings');
      links.push({ from, to, smooth, condition: value.Condition, variable: integer(value.CondVar, 'condition variable'), reference: integer(value.RefValue, 'reference') });
    } else throw new Error('Unsupported original audio timeline block: ' + block.kind);
  }
  labels.sort((a,b) => a.sample-b.sample); return { labels, links };
}
export function crossedAudioLabels(timeline: AudioTimeline, fromSeconds: number, toSeconds: number, includeStart = false): readonly AudioLabel[] {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds) || fromSeconds < 0 || toSeconds < fromSeconds) throw new Error('Invalid audio label interval');
  return timeline.labels.filter(label => (includeStart ? label.time >= fromSeconds : label.time > fromSeconds) && label.time <= toSeconds);
}
