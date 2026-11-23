import { deflateSync } from 'node:zlib';
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let value = i; for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; crcTable[i] = value >>> 0; }
function chunk(type: string, payload: Buffer): Buffer {
  const data = Buffer.alloc(payload.length + 12); data.writeUInt32BE(payload.length, 0); data.write(type, 4, 4, 'ascii'); payload.copy(data, 8);
  let crc = 0xffffffff; for (let i = 4; i < payload.length + 8; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  data.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length - 4); return data;
}
export function rgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('Invalid PNG extent');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++) scanlines.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
