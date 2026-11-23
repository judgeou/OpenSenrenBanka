import { psbValue } from '../../formats/psb-value.ts';
import { motionNumber } from './leaf-program.ts';
import type { MtnDocument } from '../mtn-catalog.ts';
import type { MtnProgram } from '../mtn-program.ts';
import type { LeafTrack } from './leaf-program.ts';
import type { ChildTrack } from './nested-program.ts';
import { sd002baActionDefinition } from './sd002ba-action-cursor.ts';

/** Actual finite topology, not general inactive-parent support. All node fields,
 * textures, curves, zero-Z/normal blend and full inheritance are still decoded
 * by the existing raster/child decoder before this additional profile guard.
 */
export function sd002baLayout(document: MtnDocument, source: MtnProgram, tracks: readonly LeafTrack[], children: readonly ChildTrack[]): void {
  sd002baActionDefinition(document, source);
  const types = [0, 0, 0, 0, 3, 2, 0, 2];
  for (const track of source.tracks) {
    const at = document.reader.property(track.sourceRef, 'type');
    if (at === undefined || motionNumber(psbValue(document.reader, at), 'SD002BA node type') !== types[track.id] || track.frames[0]?.time !== 0) throw new Error('Unsupported SD002BA node type/start boundary');
  }
  const parents = [undefined, 0, 1, 1, 0, 0, 5, undefined], labels = ['bg', 'murasame', 'hair', 'face', 'ef', 'レイヤ1', 'masa', 'se'];
  if (source.tracks.length !== 8 || source.tracks.some((track, id) => track.id !== id || track.parent !== parents[id] || track.label !== labels[id]) || tracks.length !== 7 || children.length !== 1 || children[0].id !== 4) throw new Error('Unsupported SD002BA layer/child topology');
  const layout = tracks.find(track => track.id === 5), masa = tracks.find(track => track.id === 6), bg = tracks.find(track => track.id === 0), se = tracks.find(track => track.id === 7);
  if (!layout || !masa || !bg || !se || layout.frames.length !== 4 || masa.frames.length !== 6 || bg.frames.length !== 2) throw new Error('Unsupported SD002BA layout slot topology');
  const shape = (track: LeafTrack, times: readonly number[], types: readonly number[]) => {
    if (track.frames.length !== times.length || track.frames.some((frame, index) => frame.time !== times[index] || frame.type !== types[index])) throw new Error('Unsupported SD002BA finite active intervals');
  };
  shape(layout, [0, 30, 45, 90], [0, 3, 3, 0]);
  shape(masa, [0, 30, 60, 63, 66, 90], [0, 3, 2, 2, 2, 0]);
  shape(bg, [0, 90], [2, 0]);
  for (const frame of layout.frames) if ('scaleX' in frame) {
    if (!('layout' in frame) || frame.x !== 0 || frame.y !== 0 || frame.ox !== 0 || frame.oy !== 0 || frame.angle !== 0 || frame.scaleX !== 1 || frame.scaleY !== 1 || frame.positionCurve || frame.angleCurve || frame.zoomCurve || frame.opacity !== (frame.time === 30 ? 0 : 1)) throw new Error('Unsupported SD002BA layout pose');
  }
  for (const frame of bg.frames) if ('texture' in frame && (frame.x !== 0 || frame.y !== 0 || frame.angle !== 0 || frame.scaleX !== 1 || frame.scaleY !== 1 || frame.opacity !== 1)) throw new Error('Unsupported SD002BA base/child root transform');
  if (se.frames.some(frame => 'scaleX' in frame && !('layout' in frame))) throw new Error('SD002BA event node unexpectedly draws a raster');
  // Both layout and masa are blank before30, and neither promotes its terminal
  // slot beyond count-2. Thus no active raster crosses a blank layout parent.
  // The child Player must remain the existing event-free efAA leaf path.
  for (const frame of children[0].frames) if (frame.child && (frame.child.source.objectName !== 'SD002' || frame.child.source.motionName !== 'efAA' || frame.child.tracks.some(track => track.frames.some(slot => 'layout' in slot)))) throw new Error('Unsupported SD002BA child action/layout');
}
