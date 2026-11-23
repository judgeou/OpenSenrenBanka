import type {NativeWindow} from './native-window.ts';

export function indicatorDue(ui:NativeWindow):number {
  return Math.min(ui.chapter?.indicator.nextChange??Infinity,ui.music.indicator.nextChange);
}

/** Compare every clock-driven plane input, not entire snapshots. In particular
 * the last inline glyph phase can change its receipt without adding visible units. */
export function timedPlaneState(ui:NativeWindow,pcOpacity: number|undefined): readonly unknown[] {
  const state: unknown[] = [ui.visualPage,ui.playerHidden,pcOpacity,ui.chapter?.indicator.sample.opacity??0,
    ui.music.indicator.sample.opacity,ui.music.indicator.sample.offsetX];
  for (const page of ['fore','back'] as const) {
    const m=ui.messages.pages[page],s=ui.selections[page];
    state.push(m.presentation,m.conversion,m.key,m.loaded,m.visible,m.kind,m.bodyPage,m.cursor,m.count(),m.flow?.phase,
      s.phase,s.control.paintVisible,s.control.invisibleByUser,s.control.opacity);
  }
  return state;
}
