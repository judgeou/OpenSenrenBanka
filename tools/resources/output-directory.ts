import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

async function prospectivePath(file: string): Promise<string> {
  let candidate = path.resolve(file);
  const missing: string[] = [];
  while (true) {
    try { return path.join(await realpath(candidate), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        const entry = await lstat(candidate);
        if (entry.isSymbolicLink()) throw new Error('Refusing dangling output symlink');
      } catch (lookupError) {
        if ((lookupError as NodeJS.ErrnoException).code !== 'ENOENT') throw lookupError;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.push(path.basename(candidate)); candidate = parent;
    }
  }
}

/** New output directory only. No archive entry names are used as output paths. */
export async function newOutputDirectory(sourceRoot: string, requested: string): Promise<string> {
  const source = await realpath(sourceRoot);
  const output = await prospectivePath(requested);
  const relative = path.relative(source, output);
  if (relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error('Offline output must be outside the game source directory');
  }
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  return output;
}
