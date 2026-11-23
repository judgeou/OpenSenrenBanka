import type { NativeWindow } from './native-window.ts';
/** Logical signature of exactly the writer/glyph prefix drawn by NativeUiSource. Non-message animation cannot forge it. */
export function messageReceipt(ui: NativeWindow): string | undefined {
  const page = ui.messages.writer, flow = page.flow;
  if (!page.presentation || !flow || !page.visible) return undefined;
  return [page.key, ui.messages.current, ui.visualPage, page.conversion?.sequence, page.presentation.wasRead, flow.page, flow.cursor, flow.units, flow.sourceOffset, flow.phase].join('/');
}
