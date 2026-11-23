import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [manifestFile] = process.argv.slice(2); if (!manifestFile) throw new Error('Expected execution metadata manifest');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')), root = path.dirname(manifestFile);
const expressions = new Map<string, number>(), assignments = new Map<string, number>();
const frameTypes: Record<string, number> = Object.create(null), frameFields: Record<string, number> = Object.create(null);
const contentFields: Record<string, number> = Object.create(null), layerFields: Record<string, number> = Object.create(null), nextTypes: Record<string, number> = Object.create(null);
let layers = 0, frames = 0, motionCount = 0;
function expression(text: unknown) { if (typeof text === 'string' && text) expressions.set(text, (expressions.get(text) ?? 0) + 1); }
for (const asset of manifest.sceneFiles) {
  const data = JSON.parse(await readFile(path.join(root, asset.file), 'utf8'));
  for (const scene of data.scenes) {
    for (const name of ['preevals', 'postevals']) for (const value of scene.fields[name] ?? []) {
      if (typeof value === 'string') expression(value);
      else if (Array.isArray(value) && typeof value[0] === 'string') assignments.set(value[0], (assignments.get(value[0]) ?? 0) + 1);
    }
    for (const record of [...(scene.fields.nexts ?? []), ...(scene.fields.selects ?? [])]) {
      for (const name of ['eval', 'exp', 'evalstorage']) expression(record[name]);
    }
    for (const next of scene.fields.nexts ?? []) nextTypes[next.type] = (nextTypes[next.type] ?? 0) + 1;
  }
}
function layer(value: any) {
  layers++; for (const name of Object.keys(value)) layerFields[name] = (layerFields[name] ?? 0) + 1;
  for (const frame of value.frameList ?? []) {
    frames++; frameTypes[frame.type] = (frameTypes[frame.type] ?? 0) + 1;
    for (const name of Object.keys(frame)) frameFields[name] = (frameFields[name] ?? 0) + 1;
    if (frame.content) for (const name of Object.keys(frame.content)) contentFields[name] = (contentFields[name] ?? 0) + 1;
  }
  for (const child of value.children ?? []) layer(child);
}
for (const asset of manifest.motionFiles) {
  const data = JSON.parse(await readFile(path.join(root, asset.file), 'utf8'));
  for (const object of Object.values(data.objects) as any[]) for (const motion of Object.values(object.motion ?? {}) as any[]) {
    motionCount++; for (const child of motion.layer ?? []) layer(child);
  }
}
const summary = { scenarioFiles: manifest.scenarioCount, motionModels: manifest.motionCount, motionCount, layers, frames,
  nextTypes, frameTypes, frameFields, contentFields, layerFields,
  expressions: [...expressions].map(([text, count]) => ({ text, count })), assignments: [...assignments].map(([path, count]) => ({ path, count })) };
await writeFile(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log('Execution metadata: motions=' + motionCount + '; layers=' + layers + '; frames=' + frames + '; expressions=' + expressions.size);
