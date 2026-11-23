import { Buffer } from 'node:buffer';
import type { ByteReader } from './byte-reader.ts';
import type { EvbFile } from './evb-index.ts';

export async function readPlainEvbEntry(reader: ByteReader, entry: EvbFile,
  maximumBytes = 32 * 1024 * 1024): Promise<Buffer> {
  if (entry.requiresDecompression) throw new Error('EVB compressed payload requires a decoder');
  if (entry.storedBytes > maximumBytes) throw new Error('EVB entry exceeds the resource budget');
  const output = Buffer.alloc(entry.storedBytes);
  for (let done = 0; done < output.length;) {
    const length = Math.min(1024 * 1024, output.length - done);
    const bytes = await reader.read(entry.payloadOffset + done, length);
    bytes.copy(output, done); done += bytes.length;
  }
  return output;
}
