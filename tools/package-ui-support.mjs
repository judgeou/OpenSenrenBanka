import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Private resource preparation only; no product module imports or evaluation.
export async function packageIo(work, resources, {planOnly=false} = {}) {
  const realWork = await realpath(work), inventory = [];
  const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
  const source = async relative => {
    const file = await realpath(path.resolve(work, relative)).catch(error => {
      throw new Error('无法读取本地准备资源：' + relative + '（输入根 ' + work + '）', { cause: error });
    });
    if (!within(realWork, file)) throw new Error('Resource input escaped prepared work tree');
    return file;
  };
  const target = relative => {
    const file = path.resolve(resources, relative);
    if (!within(resources, file) || file === resources) throw new Error('Resource output escaped private package');
    return file;
  };
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const bytes = async relative => readFile(await source(relative));
  const json = async relative => JSON.parse((await bytes(relative)).toString('utf8'));
  const write = async (relative, data) => {
    const file = target(relative); if (planOnly) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  };
  const writeJson = (relative, data) => write(relative, JSON.stringify(data));
  const copy = async (input, output) => {
    const data = await bytes(input); await write(output, data);
    const row = { source: input.replaceAll('\\', '/'), file: output.replaceAll('\\', '/'), bytes: data.length, sha256: hash(data) };
    inventory.push(row); return row;
  };
  return { source, bytes, json, hash, copy, write, writeJson, inventory };
}
export function basename(file, pattern) {
  if (typeof file !== 'string' || !pattern.test(file) || path.basename(file) !== file) throw new Error('Unsafe prepared filename');
  return file;
}
export async function packageOriginalTexts(io) {
  const wanted = new Set(['config.tjs', 'default.tjs', 'soundlist.csv']), resolved = new Set();
  for (const folder of ['base-script-views/r13-patch', 'base-script-views/r13-data']) {
    const manifest = await io.json(folder + '/manifest.json');
    if (!Array.isArray(manifest.views)) throw new Error('Missing original script views');
    const views = manifest.views.filter(row => wanted.has(row.name.replaceAll('\\', '/').split('/').at(-1).toLowerCase()));
    const names = new Set();
    for (const row of views) {
      const name = row.name.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
      if (names.has(name)) throw new Error('Ambiguous original script view: ' + name); names.add(name); resolved.add(name);
      const file = basename(row.view, /^[0-9]+[.]utf8[.]txt$/u);
      await io.copy(folder + '/' + file, folder + '/' + file);
    }
    await io.writeJson(folder + '/manifest.json', { schemaVersion: 1, views });
  }
  if ([...wanted].some(name => !resolved.has(name))) throw new Error('Original UI configuration is incomplete');
}
export async function packageOriginalFonts(io, linked) {
  const folder = 'native-font-r28-zh', profile = await io.json(folder + '/profile.json');
  if (profile.format !== 'senren-zh-font-profile-v1' || profile.originalFace !== '微软雅黑' || !Array.isArray(profile.fonts) || profile.fonts.length !== 2) throw new Error('Expected already-prepared Chinese-patch font profile');
  const fonts = [];
  for (const row of profile.fonts) {
    const file = basename(row.file, /^[a-z-]+[.]ttf$/u);
    const copied = await io.copy(folder + '/' + file, folder + '/' + file);
    if (copied.bytes !== row.bytes || row.embedding & (2 | 512)) throw new Error('Prepared font profile is inconsistent or embedding is restricted');
    fonts.push({ ...row, sha256: copied.sha256 });
  }
  await io.writeJson(folder + '/profile.json', { ...profile, fonts, ...(linked && { linked }) });
}
