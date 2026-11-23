import { readFile } from 'node:fs/promises';
import path from 'node:path';

function sfntFace(input, index) {
  const offset = input.toString('ascii', 0, 4) === 'ttcf' && index < input.readUInt32BE(8) ? input.readUInt32BE(12 + 4 * index) : -1;
  if (offset < 0 || input.readUInt32BE(offset) !== 0x00010000) throw new Error('Missing original TrueType font-link face');
  const count = input.readUInt16BE(offset + 4), tables = new Map();
  if (count < 1 || count > 128) throw new Error('Invalid font-link table count');
  let next = 12 + count * 16;
  for (let i = 0; i < count; ++i) {
    const at = offset + 12 + 16 * i, tag = input.toString('ascii', at, at + 4), start = input.readUInt32BE(at + 8), size = input.readUInt32BE(at + 12);
    if (tables.has(tag) || start + size > input.length || !size) throw new Error('Invalid font-link table directory');
    tables.set(tag, { at, start, size, out: next }); next += Math.ceil(size / 4) * 4;
  }
  const head = tables.get('head'), cmap = tables.get('cmap'), os2 = tables.get('OS/2');
  if (!head || !cmap || !os2 || next > 32 * 1024 * 1024 || tables.has('DSIG')) throw new Error('Unsupported font-link input');
  const embedding = input.readUInt16BE(os2.start + 8);
  if (embedding & (2 | 512)) throw new Error('Original font-link embedding is restricted');
  const output = Buffer.alloc(next); input.copy(output, 0, offset, offset + 12 + count * 16);
  for (const table of tables.values()) {
    const record = table.at - offset;
    input.copy(output, table.out, table.start, table.start + table.size);
    output.writeUInt32BE(table.out, record + 8);
  }
  // TrueType collection offsets are absolute; relocate tables without changing outlines or metrics.
  output.writeUInt32BE(0, head.out + 8); let sum = 0;
  for (let at = 0; at < output.length; at += 4) sum = (sum + output.readUInt32BE(at)) >>> 0;
  output.writeUInt32BE((0xb1b0afba - sum) >>> 0, head.out + 8);
  return { output, embedding, cmap: cmap.out };
}
function hasBmpGlyph(data, cmap, point) {
  const count = data.readUInt16BE(cmap + 2);
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + 8 * i, table = cmap + data.readUInt32BE(record + 4);
    if (data.readUInt16BE(record) !== 3 || data.readUInt16BE(table) !== 4) continue;
    const segments = data.readUInt16BE(table + 6) / 2, ends = table + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
    for (let j = 0; j < segments; j++) {
      const start = data.readUInt16BE(starts + j * 2);
      if (point < start || point > data.readUInt16BE(ends + j * 2)) continue;
      const offset = data.readUInt16BE(offsets + j * 2), delta = data.readInt16BE(deltas + j * 2);
      const glyph = offset ? data.readUInt16BE(offsets + j * 2 + offset + (point - start) * 2) : point;
      if (glyph !== 0 && ((glyph + delta) & 65535) !== 0) return true;
    }
  }
  return false;
}
export async function packageR63FontLink(io, scope) {
  const base = 'native-font-r28-zh/', profile = await io.json(base + 'profile.json');
  const needed = [...new Set(scope.texts.flatMap(row => [...row.body].map(char => char.codePointAt(0))))].filter(point => point >= 32 && profile.fonts.some(face => !face.coverage.some(([a, b]) => a <= point && point <= b))).sort((a, b) => a - b);
  if (!needed.length) return;
  if (needed.length !== 1 || needed[0] !== 0x266a) throw new Error('Unreviewed original font-link characters: ' + needed.map(p => 'U+' + p.toString(16)).join(', '));
  // Windows Microsoft YaHei FontLink: Segoe UI, SimSun, JhengHei precede Meiryo; on the prepared host only Meiryo covers U+266A in that prefix.
  const root = process.env.SystemRoot;
  if (!root || !path.isAbsolute(root)) throw new Error('Building the original font-link requires the local Windows font installation');
  const faces = [];
  for (const [weight, collection] of [[400, 'meiryo.ttc'], [700, 'meiryob.ttc']]) {
    const source = await readFile(path.join(root, 'Fonts', collection)), face = sfntFace(source, 0);
    if (!hasBmpGlyph(face.output, face.cmap, 0x266a)) throw new Error('Original Meiryo link lacks U+266A');
    const file = weight === 400 ? 'linked-regular.ttf' : 'linked-bold.ttf';
    await io.write(base + file, face.output);
    io.inventory.push({ file: base + file, source: 'local Windows Fonts/' + collection + '#0', sha256: io.hash(face.output), bytes: face.output.length });
    faces.push({ weight, file, sha256: io.hash(face.output), bytes: face.output.length, embedding: face.embedding });
  }
  return { format: 'senren-yahei-linked-symbol-v1', codepoint: 0x266a, faces };
}
