import { ScenarioCatalog } from '../src/scenario/catalog.ts';
import { GraphicsResources } from '../src/graphics/resources.ts';
import { decodeNativeData } from '../src/world/native-values.ts';
import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import { ImageDefinitions } from '../src/graphics/image-definitions.ts';
import { ImageMappings } from '../src/graphics/image-mappings.ts';
import { EnvironmentGeometry } from '../src/graphics/environment-geometry.ts';
import { StageDefinition } from '../src/graphics/stage-definition.ts';
import { EntityClasses } from '../src/world/class-catalog.ts';
import { loadBranchRules } from '../src/world/branch-flags.ts';
import type { BranchRules } from '../src/world/branch-flags.ts';
export interface SessionPackage {
  readonly identity: string; readonly previousResourceIdentity?:string; readonly label: string; readonly width: 1920; readonly height: 1080;
  readonly entry: { readonly storage: string; readonly target: string };
  readonly audio: URL; readonly envinit: URL; readonly systemVoice?: URL; readonly movie?:URL; readonly ending?:URL; readonly endingMako?:URL; readonly motionActionProfile?: 'r66-motion-se-v1'; readonly originalRoot: URL;
}
export interface SessionAssets {
  readonly root: URL; readonly package: SessionPackage; readonly scenarios: ScenarioCatalog;
  readonly graphics: GraphicsResources; readonly definitions: ImageDefinitions; readonly mappings: ImageMappings;
  readonly geometry: EnvironmentGeometry; readonly stages: ReadonlyMap<string, StageDefinition>; readonly classes: EntityClasses;
  readonly branches: BranchRules; readonly motionDefinitions: string;
  dataset(key: 'nativeMasks' | 'nativeExtendedTables'): URL;
  close(): void;
}
export function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected package object');
  const result: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: item, enumerable: true });
  return result;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Missing/invalid package ' + field); return value;
}
/** Absolute disk references, external URLs and escapes out of the self-contained resource root are forbidden. */
export function packageUrl(root: URL, relative: unknown, base = root): URL {
  const value = requiredString(relative, 'relative resource path');
  if (value.includes('\\') || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(value) || value.includes('#') || value.includes('?')) throw new Error('Non-relative package resource path');
  const result = new URL(value, base);
  if (!['http:', 'https:'].includes(root.protocol) || result.origin !== root.origin || !result.pathname.startsWith(root.pathname)) throw new Error('Resource escaped private package');
  return result;
}
export async function nativeData(url: URL): Promise<PsbValue> {
  const response = await fetch(url); if (!response.ok) throw new Error('Native data HTTP ' + response.status + ': ' + url.pathname);
  const source = await response.text(); if (source.length > 32 * 1024 * 1024) throw new Error('Native metadata exceeds budget'); return decodeNativeData(source);
}
async function json(url: URL): Promise<unknown> {
  const response = await fetch(url); if (!response.ok) throw new Error('Package HTTP ' + response.status + ': ' + url.pathname);
  const text = await response.text(); if (text.length > 8 * 1024 * 1024) throw new Error('Package descriptor exceeds budget');
  return JSON.parse(text);
}
/** Only the new production package contract is accepted; never executes old generated app code. */
import type {ResourcePrefetch} from '../src/runtime/resource-prefetch.ts';
export async function openSessionAssets(root: URL,compactCaches=false,prefetch?:ResourcePrefetch): Promise<SessionAssets> {
  if (!root.pathname.endsWith('/')) throw new Error('Session package root must end in /');
  const manifest = jsonRecord(await json(new URL('session.json', root)));
  if (manifest.format !== 'senren-native-session-v1' || manifest.language !== 'zh-Hans' || manifest.width !== 1920 || manifest.height !== 1080 || manifest.coordinateBasis !== '1280x720' || manifest.resourceProfile !== '1080') throw new Error('Unsupported production session package profile');
  const identity = requiredString(manifest.identity, 'identity'); if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Invalid package identity digest');
  const previousResourceIdentity=manifest.previousResourceIdentity;
  const entry = jsonRecord(manifest.entry), datasets = jsonRecord(manifest.datasets);
  if(previousResourceIdentity!==undefined&&(typeof previousResourceIdentity!=='string'||!/^[a-f0-9]{64}$/u.test(previousResourceIdentity)||previousResourceIdentity===identity||datasets.ending===undefined))throw Error('Invalid append-only resource identity');
  const descriptorUrl = packageUrl(root, datasets.graphics), descriptor = jsonRecord(await json(descriptorUrl));
  if (descriptor.resourceProfile !== '1080') throw new Error('Graphics profile differs from application');
  const virtual = jsonRecord(descriptor.nativeVirtualSurface);
  if (virtual.width !== 1920 || virtual.height !== 1080 || virtual.primaryType !== 'opaque') throw new Error('Graphics virtual-surface identity differs');
  const dataset = (key: string) => packageUrl(root, jsonRecord(descriptor[key]).url, descriptorUrl);
  for (const key of ['regularImages', 'pimgImages', 'pimgModels', 'mtnImages', 'mtnModels']) if (descriptor[key] !== undefined) dataset(key);
  // Active leases keep their original pixels; only the spare decoded cache is bounded here.
  const graphics = await GraphicsResources.open(descriptorUrl,{decodedPixelBudget:(compactCaches?8:datasets.movie!==undefined?16:32)*1024*1024,prefetch});
  try {
    const scenarioManifest = packageUrl(root, datasets.scenarios);
    if (!scenarioManifest.pathname.endsWith('/manifest.json')) throw new Error('Scenario dataset must identify its manifest.json');
    // The live player owns its current SCN. Keep no second decoded previous chapter in the cache.
  const scenarios = await ScenarioCatalog.open(new URL('.', scenarioManifest),{maxCachedDocuments:1});
    const definitions = await ImageDefinitions.open(dataset('imageDefinitions'), dataset('foregroundPacks'), undefined, dataset('imageMultiResolution'));
    const mappings = ImageMappings.fromDefinitions(definitions.raw);
    const geometry = new EnvironmentGeometry(await nativeData(dataset('environmentGeometry')));
    const scale = geometry.baseScale(1920, 1080);
    if (scale.x !== 1.5 || scale.y !== 1.5) throw new Error('Original environment coordinate basis differs');
    const stages = new Map<string, StageDefinition>(), rows = definitions.raw.definitions;
    if (!Array.isArray(rows)) throw new Error('Missing original image source definitions');
    for (const item of rows) { const row = psbRecord(item); if (typeof row.name === 'string' && /[.]stage$/iu.test(row.name)) stages.set(row.name.toLowerCase(), new StageDefinition(row.value)); }
    const classes = await EntityClasses.open(packageUrl(root, datasets.classes));
    const branches = await loadBranchRules(packageUrl(root, datasets.branches));
    const envinit = packageUrl(root, datasets.envinit), response = await fetch(envinit);
    if (!response.ok) throw new Error('Missing original envinit text');
    const motionDefinitions = await response.text(); if (motionDefinitions.length > 2 * 1024 * 1024) throw new Error('Original envinit exceeds budget');
    if(manifest.motionActionProfile!==undefined&&(manifest.motionActionProfile!=='r66-motion-se-v1'||datasets.systemVoice===undefined))throw new Error('Unbound motion SE package profile');
    const motionActionProfile=manifest.motionActionProfile==='r66-motion-se-v1'?manifest.motionActionProfile:undefined;
    let closed = false;
    return { root, graphics, scenarios, definitions, mappings, geometry, stages, classes, branches, motionDefinitions,
      package: { identity, previousResourceIdentity:typeof previousResourceIdentity==='string'?previousResourceIdentity:undefined, motionActionProfile, label: requiredString(manifest.label, 'label'), width: 1920, height: 1080,
        entry: { storage: requiredString(entry.storage, 'original start storage'), target: typeof entry.target === 'string' ? entry.target : '' },
        audio: packageUrl(root, datasets.audio), envinit, movie:datasets.movie===undefined?undefined:packageUrl(root,datasets.movie), ending:datasets.ending===undefined?undefined:packageUrl(root,datasets.ending), endingMako:datasets.endingMako===undefined?undefined:packageUrl(root,datasets.endingMako), systemVoice: datasets.systemVoice===undefined?undefined:packageUrl(root,datasets.systemVoice), originalRoot: root },
      dataset: key => dataset(key), close() { if (!closed) { closed = true; scenarios.clear(); graphics.close(); } } };
  } catch (error) { graphics.close(); throw error; }
}
