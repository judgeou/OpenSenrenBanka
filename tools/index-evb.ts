import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { indexInlineEvb } from './resources/evb-index.ts';
import type { EvbIndex } from './resources/evb-index.ts';

const PACKAGES = ['scenario.pck', 'Script.pck', 'image.pck', 'video.pck'] as const;

function usage(): string {
  return [
    'Offline EVB directory index only; no game execution or resource extraction.',
    'Requires Node >=22.18.0 with native erasable TypeScript support.',
    'node tools/index-evb.ts --source <game-directory> [--output <new-catalog.json>]',
    'Output is exclusive-create; an existing report is never overwritten.',
  ].join('\n');
}

function argumentsFor(argv: string[]): { source: string; output?: string } | null {
  let source: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i];
    if (option === '--help') return null;
    if (option !== '--source' && option !== '--output') {
      throw new Error('Unknown option: ' + option);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + option);
    if (option === '--source') {
      if (source !== undefined) throw new Error('Repeated --source');
      source = value;
    } else {
      if (output !== undefined) throw new Error('Repeated --output');
      output = value;
    }
  }
  if (!source) throw new Error('An explicit --source directory is required');
  return { source, output };
}

// Resolve existing symlinks/junctions before creating any output directories.
async function prospectiveRealPath(file: string): Promise<string> {
  let ancestor = path.resolve(file);
  const missing: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(ancestor), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function main(): Promise<void> {
  const args = argumentsFor(process.argv.slice(2));
  if (args === null) {
    console.log(usage());
    return;
  }
  const source = await realpath(path.resolve(args.source));
  if (!(await stat(source)).isDirectory()) throw new Error('--source must be a directory');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const requestedOutput = args.output ?? path.join('work', 'resource-index', 'evb-' + stamp + '.json');
  const output = await prospectiveRealPath(requestedOutput);
  if (path.extname(output).toLowerCase() !== '.json') throw new Error('Output must be a JSON file');
  if (isInside(source, output)) throw new Error('Output must not be inside the game source directory');

  const packages: EvbIndex[] = [];
  for (const name of PACKAGES) {
    packages.push(await indexInlineEvb(path.join(source, name)));
  }
  const catalog = {
    schemaVersion: 1,
    producer: 'offline-evb-index',
    createdAt: new Date().toISOString(),
    sourceDirectory: source,
    scope: 'directory-metadata-only',
    packages,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
  const count = packages.reduce((sum, pack) => sum + pack.fileCount, 0);
  console.log('Indexed ' + packages.length + ' packages / ' + count + ' file entries.');
  console.log('Catalog: ' + output);
  console.log('Payload contents and trailers were not interpreted. This is not game verification.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
