import { sceneFlow } from '../src/scenario/flow.ts';
import { invocation } from '../src/scenario/invocation.ts';
import { resolveStateReference } from '../src/scenario/semantics.ts';
import { psbValue, PsbResourceLiteral } from '../src/formats/psb-value.ts';
import { createHash } from 'node:crypto';
const keyFor=(id,scene)=>id+'/'+scene;
const sourceHash=value=>createHash('sha256').update(value).digest('hex');

export function scanOriginalScenes(scenes, extended) {
  const flows=[];
  const texts = [], commands = [], imageUses = [], audio = new Map(), states = new Map(), shapes = new Map(), markers = [];
    const directImages = new Set(), directAudio = new Set(), expressions=[];
    function scan(value, location, source, pointer = '') {
      if (Array.isArray(value)) { for (const [i, v] of value.entries()) scan(v, location, source, pointer + '/' + i); return; }
      if (value === null || typeof value !== 'object' || value instanceof PsbResourceLiteral) return;
      for (const [key, item] of Object.entries(value)) {
        const at = pointer + '/' + key;
        if (key === 'imageFile' && item && typeof item === 'object' && !Array.isArray(item) && typeof item.file === 'string') {
          imageUses.push({ ...item, source, location, pointer: at }); if (source === 'command') directImages.add(item.file);
        } else if (typeof item === 'string' && item && (key === 'filename' || key === 'voice' || key === 'storage' && source === 'voice')) {
          if (!audio.has(item)) audio.set(item, { value: item, source, location, pointer: at });
          if (source === 'voice' || source === 'command') directAudio.add(item);
        }
        if (extended && typeof item==='string' && ['condition','expression','eval','exp','evalstorage','script','redrawExp'].includes(key) && item) expressions.push({value:item,location,source,pointer:at});
        if (['handler', 'method'].includes(key) && typeof item === 'string') {
          const id = key + '/' + item; let shape = shapes.get(id); if (!shape) { shape = { key, value: item, count: 0, location }; shapes.set(id, shape); } shape.count++;
        }
        scan(item, location, source, at);
      }
    }
    function state(asset, scene, slot, location, source) {
      const {doc}=asset;
      if (slot === undefined) return;
      const ref = resolveStateReference(doc, scene, slot);
      const id = extended ? asset.id+'/'+ref : ref;
      if (ref === undefined || states.has(id)) return;
      states.set(id, { ref, location, source }); scan(psbValue(doc.reader, ref), location, source);
    }
    for (const {asset,scene,limit} of scenes) {
      const {doc}=asset, spec=doc.index.scenes[scene];
      if (!spec) throw new Error('Missing original scene ' + keyFor(asset.id,scene));
      const flow=sceneFlow(doc,scene); flows.push({ ...(extended && {asset:asset.id}), scene,label:spec.label,...flow });
      if (extended) {
        const location={asset:asset.id,scene,sourceRef:spec.sourceRef};
        for (const [side,commands] of [['before',flow.before],['after',flow.after]]) for (const cmd of commands) {
          if (cmd.kind==='program') expressions.push({value:cmd.source,location,source:side});
          else scan(cmd.value,location,side,cmd.path);
        }
        scan(flow.next,location,'next'); scan(flow.choices,location,'choice');
      }
      for (const event of spec.events) {
        if (event.sourceIndex > limit) break;
        const location = { asset: asset.id, scene, event: event.sourceIndex, sourceRef: event.sourceRef };
        if (event.kind === 'opaque') throw new Error('Unmapped original event at ' + scene + '/' + event.sourceIndex);
        if (event.kind === 'marker') markers.push(location);
        if (event.kind === 'record') state(asset, scene, event.stateSlot, location, 'checkpoint');
        if (event.kind === 'command') { const command = invocation(doc, event, location); commands.push(command); scan(command.parameters, location, 'command'); }
        if (event.kind === 'text') {
          const dialogue = doc.dialogue(scene, event.textIndex);
          if (dialogue.body?.kind !== 'string') throw new Error('Nonliteral source body at ' + scene + '/' + event.sourceIndex);
          const voice = dialogue.voiceData ? psbValue(doc.reader, dialogue.voiceData.offset) : null;
          scan(voice, location, 'voice'); state(asset, scene, spec.texts[event.textIndex].slots[5], location, 'text-state');
          texts.push({ ...location, key: asset.id + '/' + scene + '/' + event.externalId, textId: event.externalId, textRef: event.textRef, flags: Number(psbValue(doc.reader, spec.texts[event.textIndex].slots[4])), body: dialogue.body.value, bodySha256: sourceHash(dialogue.body.value), voice });
        }
      }
    }
  return {texts,commands,imageUses,audio,states,shapes,markers,flows,directImages,directAudio,expressions};
}
