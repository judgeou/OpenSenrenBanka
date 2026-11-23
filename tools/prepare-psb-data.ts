import { readFile, writeFile } from 'node:fs/promises';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { psbValue } from '../src/formats/psb-value.ts';
const [sourceFile, output] = process.argv.slice(2); if (!sourceFile || !output) throw new Error('Expected source PSB data and new output');
const reader = new Psb2Reader(await readFile(sourceFile)), value = psbValue(reader, reader.header.root);
await writeFile(output, JSON.stringify(value, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value, 2), { flag: 'wx' });
console.log('Prepared original PSB definition data');
