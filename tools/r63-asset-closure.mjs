import { decodeNativeData } from '../src/world/native-values.ts';
import { ImageDefinitions } from '../src/graphics/image-definitions.ts';
import { ImageResolutions } from '../src/graphics/image-resolutions.ts';
import { ImageMappings } from '../src/graphics/image-mappings.ts';
import { MotionDefinitions } from '../src/graphics/motion/definitions.ts';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { MtnDocument } from '../src/graphics/mtn-catalog.ts';
import { basename } from './package-ui-support.mjs';
import { sd001, sd002, sd003 } from './r63-source-scope.mjs';

export const leaf = value => value.replaceAll(String.fromCharCode(92), '/').split('/').at(-1).toLowerCase();
const keys = value => { const full = value.replaceAll(String.fromCharCode(92), '/').toLowerCase(); return [full, leaf(value), full.replace(/[.][^/.]+$/u, ''), leaf(value).replace(/[.][^.]+$/u, '')]; };
function unique(rows, label) {
  if (rows.length !== 1) throw new Error('Original ' + label + ' missing/ambiguous: ' + rows.map(row => row.name + '/' + row.id).join(', '));
  return rows[0];
}
export async function originalImageMulti(io) {
  const root = 'base-resources/r7-data', manifest = await io.json(root + '/manifest.json');
  const row = unique(manifest.entries.filter(row => row.name === 'main/imagemulti.txt'), 'imagemulti');
  if (row.state !== 'exported') throw new Error('Original imagemulti is missing');
  const source = root + '/' + basename(row.file, /^[0-9]+[.]bin$/u), data = await io.bytes(source);
  if (io.hash(data) !== row.sha256) throw new Error('Original imagemulti changed');
  return { source, data };
}
// Offline dependency planning: never starts the engine, invokes source expressions or decodes textures.
export async function r63GraphicsClosure(io, scope, regular, pimg, envinit) {
  const multi = await originalImageMulti(io);
  const read = async name => decodeNativeData((await io.bytes(name)).toString('utf8'));
  const definitions = new ImageDefinitions(await read('image-definitions-r13-v4.json'), await read('foreground-packs-r13-v2.json'), new ImageResolutions(multi.data.buffer.slice(multi.data.byteOffset, multi.data.byteOffset + multi.data.byteLength)));
  const mappings = ImageMappings.fromDefinitions(definitions.raw), motions = new MotionDefinitions(envinit);
  const regularByName = new Map(), byId = new Map();
  for (const row of regular.entries) {
    if (byId.has(row.id)) throw new Error('Duplicate regular image identity: ' + row.id);
    byId.set(row.id, row);
    for (const key of new Set([row.name, ...(row.aliases ?? [])].flatMap(keys))) { const list = regularByName.get(key) ?? []; list.push(row); regularByName.set(key, list); }
  }
  const images = new Set(), models = new Set(), stands = new Map(), animation = new Map(), aliases = new Map();
  const mappedNames = new Set();
  const addRegular = name => {
    const row = unique(regularByName.get(name.toLowerCase()) ?? [], 'image ' + name);
    images.add(row.id); return row.id;
  };
  for (const file of scope.imageUses.flatMap(({file})=>{
    const choices=motions.pictureAlternatives(file);
    if(choices.length)return [...choices];
    const conditional=mappings.conditions.get(file.toLowerCase());
    if(scope.milestone!=='R69'||!conditional?.length)return [file];
    const result=[];for(const candidate of conditional){if(candidate.file.startsWith('&'))throw Error('Conditional image expression needs an authored closure '+file+' '+candidate.file);result.push(candidate.file);if(!candidate.condition)return result;}
    return [...result,file];
  })) {
    if (mappedNames.has(file)) continue; mappedNames.add(file);
    const reject = source => { throw new Error('Unaccounted image expression for ' + file + ': ' + source); };
    if (scope.milestone!=='R69'&&mappings.conditions.has(file.toLowerCase())) throw new Error('Review every conditional image candidate for ' + file);
    const mapped = mappings.resolve(file, reject,scope.milestone==='R69'), name = mapped.file;
    if (motions.has(name) || /[.]mtn$/u.test(name)) {
      const resolved = motions.resolve({ file: name, options: {}, raw: { file: name } });
      animation.set(name, { model: resolved.file, object: resolved.options.chara, action: resolved.options.motion });
    } else if (name.endsWith('.stand')) {
      if (stands.has(name)) continue;
      const families = [];
      for (const base of definitions.stand(name)) {
        const variants = definitions.foregroundVariants(base.filename);
        for (const { pack, scale } of variants) {
          const rasters = pack.layout.layers.flatMap(layer => layer.imageName ? [addRegular(layer.imageName)] : []);
          families.push({ base: base.filename, pack: pack.name, scale, ids: [...new Set(rasters)] });
        }
      }
      stands.set(name, families);
    } else {
      const candidates = pimg.models.filter(row => keys(row.name).includes(name));
      if (candidates.length) { const row = unique(candidates, 'PIMG ' + name); models.add(row.name); aliases.set(file, { name, options: mapped.options, model: row.name }); }
      else aliases.set(file, { name, id: addRegular(name), options: mapped.options });
    }
  }
  const newRoots=['R67','R68','R69'].includes(scope.milestone)?[...new Map(scope.imageUses.filter(row=>(scope.milestone==='R69'?/^sd(?:00[3-9]|010|014|10[1-4])[a-z]{2}(?:2)?$/i:scope.milestone==='R68'?/^sd00[3-8][a-z]{2}(?:2)?$/i:/^sd00[45][a-z]{2}$/i).test(row.file)&&!sd003.some(([,alias])=>alias===row.file.toLowerCase())).map(row=>[row.file.toLowerCase(),[row.location.event,row.file.toLowerCase()]])).values()]:[];
  const expected = ['R66','R67','R68','R69'].includes(scope.milestone) ? [...sd001,...sd002,...sd003,...newRoots] : scope.milestone==='R64' ? [...sd001,...sd002] : sd001;
  if (!scope.edition && animation.size !== expected.length) throw new Error('Unexpected original MTN bindings: '+[...animation.keys()].join(', '));
  for (const [,alias] of (scope.edition ? [] : expected)) {
    const motion=animation.get(alias), object=alias.slice(0,5).toUpperCase();
    if (leaf(motion?.model??'')!==object.toLowerCase()+'.mtn'||motion.object!==object||motion.action!==alias.toUpperCase()) throw new Error('Unexpected original MTN identity: '+alias);
  }
  return { images, models, stands: Object.fromEntries(stands), aliases: Object.fromEntries(aliases), animation: Object.fromEntries(animation), multi };
}

export async function packageR63Motion(io, animation) {
  const base = 'mtn-textures/r9-v3', modelManifest = await io.json(base + '/motion-models.json'), imageManifest = await io.json(base + '/manifest.json');
  const resolved = new Set(Object.values(animation).map(row => leaf(row.model)));
  const models = [...resolved].map(name => unique(modelManifest.models.filter(row => leaf(row.name) === name && row.state === 'prepared'), 'MTN ' + name));
  const textureIds = new Set(), actions = {};
  for (const model of models) {
    const meta = basename(model.metadataFile, /^[0-9]+[.]psbmeta$/u), raw = await io.bytes(base + '/' + meta);
    if (raw.byteLength !== model.metadataBytes || io.hash(raw) !== model.metadataSha256) throw new Error('MTN metadata identity changed: ' + model.name);
    await io.copy(base + '/' + meta, 'mtn/' + meta);
    // Explicitly inventory original actions and their child references from the model. Copy the complete model texture set.
    const modelDoc = new MtnDocument(new Psb2Reader(raw, {}, model.sourceByteLength), model, undefined);
    for (const [alias, row] of Object.entries(animation)) if (leaf(row.model) === leaf(model.name)) {
      const program = modelDoc.motionProgram(row.object, row.action);
      actions[alias] = { ...row, lastTime: program.lastTime, tracks: program.tracks.length, textures: model.textures.length };
    }
    for (const texture of model.textures) {
      const row = unique(imageManifest.entries.filter(row => row.id === texture.imageId && row.file === texture.imageFile), 'MTN texture ' + texture.key);
      if (row.width !== texture.width || row.height !== texture.height || row.name.toLowerCase() !== (model.name + '/' + texture.key).toLowerCase()) throw new Error('MTN texture manifest disagrees: ' + texture.key);
      textureIds.add(row.id);
    }
  }
  const entries = imageManifest.entries.filter(row => textureIds.has(row.id));
  for (const row of entries) {
    const file = basename(row.file, /^[0-9]+[.]png$/u), copy = await io.copy(base + '/' + file, 'mtn/' + file);
    if (copy.bytes !== row.bytes || copy.sha256 !== row.sha256) throw new Error('Original MTN texture changed: ' + row.name);
  }
  await io.writeJson('mtn/models.json', { schemaVersion: 1, format: 'prepared-mtn-metadata-v1', failed: 0, models });
  await io.writeJson('mtn/images.json', { schemaVersion: 1, format: 'prepared-web-images-v1', failed: 0, assetBaseUrl: '.', entries });
  return { actions, models: models.length, textures: entries.length };
}
