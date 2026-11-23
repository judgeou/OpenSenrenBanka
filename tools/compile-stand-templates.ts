import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Psb2Reader } from '../src/formats/psb2/reader.ts';
import { decodeNativeData } from '../src/world/native-values.ts';
import { standBase, selectStand } from '../src/graphics/stand-selection.ts';
import { pimgLayout } from '../src/graphics/pimg-layout.ts';
import { PimgPaths } from '../src/graphics/pimg-paths.ts';
import { foregroundPack } from '../src/graphics/foreground-pack.ts';
const [definitionFile, modelFile, output] = process.argv.slice(2); if (!definitionFile || !modelFile || !output) throw new Error('Expected image definitions, PIMG metadata and new template output');
const bundle: any = decodeNativeData(await readFile(definitionFile,'utf8')), manifest = JSON.parse(await readFile(modelFile,'utf8'));
if (bundle.failed !== 0 || manifest.failed > 0 || !['prepared-pimg-metadata-v1','prepared-foreground-packs-v1'].includes(manifest.format)) throw new Error('Incomplete image definitions');
const tables = new Map(bundle.tables.map((table:any) => [table.name.toLowerCase(),table.rows])), models = new Map<string,any>();
for (const entry of manifest.models ?? manifest.packs) { const name = entry.name.replaceAll('\\','/').split('/').at(-1).replace(/[.](pimg|txt)$/iu,'').toLowerCase(); models.set(name,entry); }
let stands = 0, bases = 0, templates = 0, references = 0, groupReferences = 0; const errors: object[] = [], records: object[] = [];
for (const definition of bundle.definitions) if (/[.]stand$/iu.test(definition.name)) { stands++;
  if (!Array.isArray(definition.value)) throw new Error('Invalid stand root');
  for (const value of definition.value) { bases++;
    try { const table: any = tables.get((value.filename+'_info.txt').toLowerCase()); if (!table) throw new Error('Missing stand table');
      const base = standBase(value,table), model = models.get(base.filename.toLowerCase()); if (!model) throw new Error('Missing stand layer pack');
      if (manifest.format === 'prepared-pimg-metadata-v1' && !/^[0-9]+[.]psbmeta$/u.test(model.metadataFile)) throw new Error('Unsafe stand metadata');
      const layout = manifest.format === 'prepared-foreground-packs-v1' ? foregroundPack(model.name,model.text).layout : pimgLayout(new Psb2Reader(await readFile(path.join(path.dirname(modelFile),model.metadataFile)),{},model.sourceByteLength));
      const paths = new PimgPaths(layout), entries = [];
      for (const dress of base.dresses.values()) for (const pose of dress.poses.values()) for (const face of base.faces.keys()) {
        const selected = selectStand([base],{ dress: dress.name, pose: pose.name, face }); const layers = selected.layers.map(layer => { const id = paths.resolve(layer.path); references++; if (layout.byId.get(id)!.layerType === 2) groupReferences++; return { id, ...layer }; }); templates++; entries.push({ dress: dress.name, pose: pose.name, face, layers });
      }
      records.push({ stand: definition.name, filename: base.filename, width: layout.width, height: layout.height, xoffset: base.xoffset, yoffset: base.yoffset, leveloffset: base.leveloffset, entries });
    } catch (error) { errors.push({ stand: definition.name, filename: value.filename, error: error instanceof Error ? error.message : String(error) }); }
  }
}
await writeFile(output,JSON.stringify({ schemaVersion:1, stands,bases,templates,references,groupReferences,failed:errors.length,errors,records },(_key,value)=>typeof value==='bigint'?{$integer:String(value)}:value,2),{flag:'wx'});
console.log('Prepared stand templates: stands='+stands+'; bases='+bases+'; templates='+templates+'; references='+references+'; groups='+groupReferences+'; failed='+errors.length); if(errors.length)process.exitCode=1;
