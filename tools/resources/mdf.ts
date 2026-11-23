import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

/** Offline mdf\0 envelope decoding; does not interpret or execute PSB/TJS. */
export function unwrapMdf(input: Buffer, maximumBytes = 32 * 1024 * 1024): Buffer {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Invalid MDF output budget');
  }
  if (input.length < 10 || input.toString('hex', 0, 4) !== '6d646600') {
    throw new Error('Expected mdf envelope with a zlib body');
  }
  const declaredBytes = input.readUInt32LE(4);
  if (declaredBytes === 0 || declaredBytes > maximumBytes) {
    throw new Error('MDF declared size exceeds the offline decode budget');
  }
  const result = inflateSync(input.subarray(8), { maxOutputLength: maximumBytes });
  if (result.length !== declaredBytes) {
    throw new Error('MDF declared size differs from its decoded body');
  }
  return result;
}
