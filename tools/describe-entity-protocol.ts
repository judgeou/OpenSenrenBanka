import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { ScenarioDocument } from '../src/scenario/document.ts';
import { invocation } from '../src/scenario/invocation.ts';
import { worldPlan } from '../src/world/plan.ts';
const [manifestFile, output] = process.argv.slice(2); if (!manifestFile || !output) throw new Error('Expected scenario manifest and new protocol output');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const classes: Record<string, any> = Object.create(null), properties: Record<string, any> = Object.create(null), sounds: Record<string, any> = Object.create(null);
const handlers: Record<string, any> = Object.create(null), primitives: Record<string, number> = Object.create(null); let updates = 0, commands = 0;
function kind(value: any): string { return value === null ? 'null' : Array.isArray(value) ? 'array:' + value.length : typeof value; }
for (const asset of manifest.files) {
  if (!/^[0-9]+[.]psb$/u.test(asset.binaryFile)) throw new Error('Unsafe source path');
  const document = new ScenarioDocument(new Psb2Reader(await readFile(path.join(path.dirname(manifestFile), asset.binaryFile)))), names = new Map<string, string>();
  for (let scene = 0; scene < document.index.scenes.length; scene++) for (const event of document.index.scenes[scene].events) {
    if (event.kind !== 'command') continue; const command = invocation(document, event, { asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef });
    if (command.name !== 'envupdate') continue; commands++; const plan = worldPlan(command.parameters);
    for (const op of [...plan.before, ...plan.updates, ...plan.reverseBefore, ...plan.reverse]) {
      if (op.kind === 'create') names.set(op.name, String(op.classSpec));
      if (op.kind !== 'update') continue; updates++; const data = op.parameters, name = typeof data.class === 'string' ? data.class : names.get(op.name) ?? op.name;
      const cls = classes[name] ??= { count: 0, fields: Object.create(null), samples: [] }; cls.count++;
      for (const key of Object.keys(data)) cls.fields[key] = (cls.fields[key] ?? 0) + 1; if (cls.samples.length < 2) cls.samples.push(data);
      if (data.replay && ['bgm', 'se', 'loopse', 'endsong'].includes(name)) { const row = sounds[name] ??= { count: 0, fields: Object.create(null), samples: [] }; row.count++; for (const key of Object.keys(data.replay)) row.fields[key] = (row.fields[key] ?? 0) + 1; if (row.samples.length < 4) row.samples.push(data.replay); }
      for (const source of [data.action, data.hideact]) if (Array.isArray(source)) for (const action of source) {
        if (!Array.isArray(action)) { const key = kind(action); primitives[key] = (primitives[key] ?? 0)+1; continue; }
        const key = String(action[0]), row = properties[key] ??= { count: 0, types: Object.create(null), samples: [] }; row.count++;
        const type = kind(action[1]); row.types[type] = (row.types[type] ?? 0)+1; if (row.samples.length < 3) row.samples.push(action);
        if (Array.isArray(action[1])) for (const part of action[1]) {
          if (!part || typeof part !== 'object' || Array.isArray(part)) continue; const name = String(part.handler), handler = handlers[name] ??= { count: 0, fields: Object.create(null), samples: [] }; handler.count++;
          for (const key of Object.keys(part)) handler.fields[key] = (handler.fields[key] ?? 0)+1; if (handler.samples.length < 3) handler.samples.push(part);
        }
      }
    }
  }
}
await writeFile(output, JSON.stringify({ commands, updates, classes, properties, sounds, primitives, handlers }, (_key, value) => typeof value === 'bigint' ? Number(value) : value, 2), { flag: 'wx' });
console.log('Prepared entity protocol: commands=' + commands + '; updates=' + updates + '; properties=' + Object.keys(properties).length);
