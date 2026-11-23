import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { psbValue } from '../src/formats/psb-value.ts';
import { newOutputDirectory } from './resources/output-directory.ts';
const [gameRoot, manifestFile, requestedOutput] = process.argv.slice(2); if (!gameRoot || !manifestFile || !requestedOutput) throw new Error('Expected game root, scenario manifest and new output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), output = await newOutputDirectory(gameRoot, requestedOutput);
const bracketTokens: Record<string, number> = Object.create(null), controls: Record<string, number> = Object.create(null), samples: object[] = []; let messages = 0;
for (const asset of manifest.files) {
  if (!/^[0-9]+$/u.test(asset.id) || !/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe scenario asset path');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile)))), rows = [];
  for (const [sceneIndex, scene] of document.index.scenes.entries()) for (const [textIndex, text] of scene.texts.entries()) {
    const slots = text.slots.map(ref => psbValue(document.reader, ref)), body = slots[2]; if (typeof body !== 'string') throw new Error('Non-string message body'); messages++;
    for (const match of body.matchAll(/\[([^\]\r\n]{0,512})\]/gu)) { const token = match[1].split(/\s/u)[0]; bracketTokens[token] = (bracketTokens[token] ?? 0) + 1; }
    for (const char of body) if (char.charCodeAt(0) < 32) controls[char.charCodeAt(0)] = (controls[char.charCodeAt(0)] ?? 0) + 1;
    if (samples.length < 16 && (body.includes('[') || body.includes('<') || body.includes('{') || body.includes('|'))) samples.push({ asset: asset.id, scene: sceneIndex, body });
    rows.push({ scene: sceneIndex, text: textIndex + 1, textIndex, sourceRef: text.sourceRef, slots });
  }
  await writeFile(path.join(output, asset.id + '.messages.json'), JSON.stringify({ id: asset.id, rows }, (_key, value) => typeof value === 'bigint' ? { $integer: String(value) } : value), { flag: 'wx' });
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files: manifest.files.length, messages, bracketTokens, controls, samples }, null, 2), { flag: 'wx' });
console.log('Prepared original message data: files=' + manifest.files.length + '; messages=' + messages);
