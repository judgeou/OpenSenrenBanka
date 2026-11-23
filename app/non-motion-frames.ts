import { PreparedFrames } from '../src/graphics/prepared-frames.ts';
import type { PreparedGraphicFrame, FrameEvaluation } from '../src/graphics/prepared-frames.ts';
import type { NativeImageRequest } from '../src/graphics/image-request.ts';
import { clonePsbValue, psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { SessionAssets } from './session-assets.ts';
/** Concrete original .stage image selector backed by real prepared pixels; unsupported retain/color programs fail, never substitute pictures. */
export class NonMotionFrames {
  private readonly pixels: PreparedFrames;
  constructor(private readonly assets: SessionAssets, private readonly evaluation: FrameEvaluation) {
    this.pixels = new PreparedFrames(assets.graphics, assets.definitions, evaluation, async request => { throw new Error('Nested original external image source is not bound: ' + request.file); });
  }
  async load(request: NativeImageRequest, scale: number, saved?: PsbValue): Promise<PreparedGraphicFrame> {
    const definition = this.assets.stages.get(request.file.toLowerCase()); if (!definition) throw new Error('Unsupported original external source: ' + request.file);
    let inner: PreparedGraphicFrame | undefined;
    if (saved !== undefined) { const row = psbRecord(saved); if (row.kind !== 'senren-stage-source-v1' || row.definition !== request.file) throw new Error('Stage frame identity differs from source'); inner = await this.pixels.load({}, scale, undefined, row.frame); }
    else {
      const stage = request.options.stage, time = request.options.time;
      if (typeof stage !== 'string' || typeof time !== 'string') throw new Error('Stage requires resolved original stage/time');
      const exists = (file: string): boolean => { const mapped = this.assets.mappings.resolve(file, source => this.evaluation.global(source), false, true).file;
        const key = (name: string) => name.toLowerCase().replace(/[.][^.]+$/u, '');
        return this.assets.graphics.images.entries.some(entry => [entry.name, ...(entry.aliases ?? [])].some(alias => key(alias) === key(mapped))) || this.assets.graphics.pimg.entries.some(entry => key(entry.name) === key(mapped)); };
      const selected = definition.select(stage, time, exists);
      if (selected.mode !== 'image' || !selected.file) throw new Error('Owner-aware stage retain/clear source is not enabled');
      if (selected.commands.length || Object.keys(selected.color).length) throw new Error('Stage original color/command program is not bound: ' + stage + '/' + time);
      const mapped = this.assets.mappings.resolve(selected.file, source => this.evaluation.global(source), false, true);
      inner = await this.pixels.load({ imageFile: { file: mapped.file, options: clonePsbValue(mapped.options) } }, scale);
    }
    if (!inner) throw new Error('Original stage did not provide pixels'); const frame = inner;
    return { ...frame, key: 'stage/' + request.file + '/' + frame.key,
      captureState: () => ({ kind: 'senren-stage-source-v1', definition: request.file, frame: frame.captureState() }), release: () => frame.release() };
  }
  close(): void { this.pixels.close(); }
}
