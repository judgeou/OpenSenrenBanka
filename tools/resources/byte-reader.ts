import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

/** Bounded, positional, read-only access for offline resource metadata. */
export class ByteReader {
  readonly source: string;
  readonly size: number;
  readonly mtimeMs: number;
  private readonly handle: FileHandle;

  private constructor(source: string, handle: FileHandle, size: number, mtimeMs: number) {
    this.source = source;
    this.handle = handle;
    this.size = size;
    this.mtimeMs = mtimeMs;
  }

  static async open(file: string): Promise<ByteReader> {
    const source = await realpath(file);
    const handle = await open(source, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size)) {
        throw new Error('Input must be a regular file with a safe integer size: ' + source);
      }
      return new ByteReader(source, handle, stat.size, stat.mtimeMs);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || length > 1024 * 1024 ||
        !Number.isSafeInteger(offset + length) || offset + length > this.size) {
      throw new Error('Invalid bounded read at ' + offset + ' length ' + length);
    }
    const bytes = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const result = await this.handle.read(bytes, done, length - done, offset + done);
      if (result.bytesRead === 0) {
        throw new Error('Input ended during metadata read: ' + this.source);
      }
      done += result.bytesRead;
    }
    return bytes;
  }

  /** Best-effort change detection; not a content-integrity hash. */
  async requireUnchanged(): Promise<void> {
    const stat = await this.handle.stat();
    if (stat.size !== this.size || stat.mtimeMs !== this.mtimeMs) {
      throw new Error('Source changed while indexing: ' + this.source);
    }
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}
