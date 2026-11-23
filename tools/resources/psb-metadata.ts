import { Buffer } from 'node:buffer';
import { Psb2Reader } from '../../src/formats/psb2/reader.ts';
import { ByteReader } from './byte-reader.ts';
import { unwrapMdf } from './mdf.ts';

async function bytes(reader: ByteReader, length: number): Promise<Buffer> {
  const output = Buffer.alloc(length);
  for (let done = 0; done < length;) {
    const count = Math.min(1024 * 1024, length - done);
    const part = await reader.read(done, count); part.copy(output, done); done += part.length;
  }
  return output;
}
function metadataLength(header: Buffer, total: number, budget: number): number {
  if (header.length < 40 || header.readUInt32LE(0) !== 0x00425350) throw new Error('Expected PSB metadata header');
  const length = header.readUInt32LE(32);
  const minimum = header.readUInt16LE(4) === 3 ? 44 : 40;
  if (length < minimum || length > total || length > budget) throw new Error('Invalid/over-budget PSB metadata span');
  return length;
}

export async function readPsbMetadata(file: string, budget = 64 * 1024 * 1024) {
  const source = await ByteReader.open(file);
  try {
    const header = await source.read(0, Math.min(44, source.size));
    let data: Buffer, completeBytes: number, envelope: 'raw' | 'mdf';
    if (header.toString('hex', 0, 4) === '6d646600') {
      if (source.size > budget) throw new Error('MDF compressed-input budget exceeded');
      const body = unwrapMdf(await bytes(source, source.size), budget);
      completeBytes = body.length; envelope = 'mdf';
      data = Buffer.from(body.subarray(0, metadataLength(body, completeBytes, budget)));
    } else {
      completeBytes = source.size; envelope = 'raw';
      data = await bytes(source, metadataLength(header, completeBytes, budget));
    }
    await source.requireUnchanged();
    return { reader: new Psb2Reader(data, { maxInputBytes: budget }, completeBytes),
      metadata: data, metadataBytes: data.length, completeBytes, packedBytes: source.size, envelope };
  } finally { await source.close(); }
}
