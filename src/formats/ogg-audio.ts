export interface OggAudioInfo { readonly codec: 'opus' | 'vorbis'; readonly channels: number; readonly sampleRate: number; readonly inputRate: number; readonly preSkip: number; readonly samples: bigint; readonly duration: number; readonly serial: number; readonly pages: number }
export function oggAudioInfo(bytes: Uint8Array): OggAudioInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = 0, pages = 0, serial: number | undefined, sequence: number | undefined;
  const packet: number[] = []; let identified = false, ended = false, codec: OggAudioInfo['codec'] | undefined, channels = 0, rate = 0, inputRate = 0, preSkip = 0, samples = 0n;
  while (at < bytes.length) {
    if (at + 27 > bytes.length || bytes[at] !== 79 || bytes[at+1] !== 103 || bytes[at+2] !== 103 || bytes[at+3] !== 83 || bytes[at+4] !== 0) throw new Error('Invalid Ogg page header');
    const stream = view.getUint32(at + 14, true), currentSequence = view.getUint32(at + 18, true), segments = bytes[at + 26];
    if (serial === undefined) serial = stream; if (stream !== serial) throw new Error('Chained/multiplexed Ogg requires explicit preparation');
    if (sequence !== undefined && currentSequence !== ((sequence + 1) >>> 0)) throw new Error('Ogg sequence discontinuity'); sequence = currentSequence;
    if (at + 27 + segments > bytes.length) throw new Error('Truncated Ogg lacing'); let bodyLength = 0;
    for (let i = 0; i < segments; i++) bodyLength += bytes[at + 27 + i];
    const body = at + 27 + segments, end = body + bodyLength; if (end > bytes.length) throw new Error('Ogg body exceeds source');
    if (!identified) {
      let cursor = body;
      for (let i = 0; i < segments && !identified; i++) {
        const count = bytes[at + 27 + i]; for (let n = 0; n < count; n++) packet.push(bytes[cursor + n]); cursor += count;
        if (packet.length > 1024 * 1024) throw new Error('Ogg identification packet exceeds budget');
        if (count < 255) {
          const header = Uint8Array.from(packet), info = new DataView(header.buffer);
          const ascii = (offset: number, text: string) => [...text].every((char, index) => header[offset + index] === char.charCodeAt(0));
          if (header.length >= 19 && ascii(0, 'OpusHead')) { codec = 'opus'; channels = header[9]; preSkip = info.getUint16(10, true); rate = 48000; inputRate = info.getUint32(12, true); }
          else if (header.length >= 30 && header[0] === 1 && ascii(1, 'vorbis')) { codec = 'vorbis'; channels = header[11]; rate = inputRate = info.getUint32(12, true); }
          else throw new Error('Unsupported Ogg audio identification'); identified = true;
        }
      }
    }
    const granule = view.getBigUint64(at + 6, true); if (granule !== 0xffffffffffffffffn) samples = granule;
    if ((bytes[at + 5] & 4) !== 0) ended = true; at = end; pages++;
  }
  if (!codec || serial === undefined || !ended || channels < 1 || channels > 8 || rate < 1 || samples < BigInt(preSkip) || samples > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Incomplete Ogg audio metadata');
  const duration = Number(samples - BigInt(preSkip)) / rate;
  return { codec, channels, sampleRate: rate, inputRate, preSkip, samples, duration, serial, pages };
}
