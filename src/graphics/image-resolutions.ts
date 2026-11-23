export interface ResolutionFile { readonly file: string; readonly scale: number | undefined }
export interface ResolutionPack { readonly name: string; readonly pageWidth: number }
export interface ResolvedImage<P extends ResolutionPack> { readonly pack: P; readonly scale: number }
const key = (name: string) => name.replaceAll('\\', '/').split('/').at(-1)!.replace(/\.(?:txt|psd|pimg)$/iu, '').toLowerCase();
/** Original MultiResolutionInformation (00835) and StandInfo (00845), not a guessed full/half ratio. */
export class ImageResolutions {
  private readonly rows = new Map<string, readonly ResolutionFile[]>();
  constructor(bytes?: ArrayBuffer) {
    if (!bytes) return; const data = new Uint8Array(bytes);
    if (data.length > 1024 * 1024 || data[0] !== 255 || data[1] !== 254) throw new Error('Original imagemulti must be bounded UTF16LE');
    const text = new TextDecoder('utf-16le', { fatal: true }).decode(data.subarray(2));
    for (const line of text.split(/\r?\n/u)) { const content = line.trim(); if (!content || content.startsWith('#')) continue;
      const fields = content.split('\t').map(field => field.trim()).filter(Boolean); if (fields.length < 2) throw new Error('Unsupported imagemulti row');
      const files = fields.map((field, index) => { const colon = field.indexOf(':'); const scale = colon < 0 ? index === 0 ? 1 : undefined : Number(field.slice(0, colon)) / 100;
        const file = colon < 0 ? field : field.slice(colon + 1); if (!file || file.includes('/') || file.includes('\\') || scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) throw new Error('Invalid imagemulti source/scale');
        return { file: key(file), scale }; });
      const name = files[0].file; if (this.rows.has(name)) throw new Error('Duplicate imagemulti source'); this.rows.set(name, files);
    }
  }
  resolve<P extends ResolutionPack>(name: string, lookup: (file: string) => P | undefined): readonly ResolvedImage<P>[] {
    const files = this.rows.get(key(name)); if (!files) { const pack = lookup(name); if (!pack) throw new Error('Missing foreground source: ' + name); return [{ pack, scale: 1 }]; }
    const result: ResolvedImage<P>[] = []; let base: P | undefined, baseScale = 1;
    for (const file of files) { const pack = lookup(file.file); if (!pack) { if (base) throw new Error('Original imagemulti alternative is missing: ' + file.file); continue; }
      if (!base) { base = pack; baseScale = file.scale ?? 1; }
      const scale = file.scale ?? Math.round(pack.pageWidth / base.pageWidth * baseScale * 100) / 100;
      if (result.length && scale >= result.at(-1)!.scale) throw new Error('Original imagemulti sources must descend in scale'); result.push({ pack, scale });
    }
    if (!result.length) throw new Error('No original imagemulti sources available'); return result;
  }
  select<P extends ResolutionPack>(variants: readonly ResolvedImage<P>[], scale: number): ResolvedImage<P> {
    if (!Number.isFinite(scale) || scale <= 0 || !variants.length) throw new Error('Invalid native requested source zoom');
    return variants.find((_, index) => index === variants.length - 1 || scale > variants[index + 1].scale)!;
  }
}
