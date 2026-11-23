import { psbRecord } from '../../src/formats/psb-value.ts';
import type { PsbValue } from '../../src/formats/psb-value.ts';
import { NativeChapter } from './native-chapter.ts';
import type { NativeWindow } from './native-window.ts';
import type { NativeMusicEventKind } from './message-types.ts';
import { sessionData } from '../session-data.ts';
function musicEvent(value: PsbValue | undefined): value is NativeMusicEventKind { return value === 'play' || value === 'stop' || value === 'pause' || value === 'resume'; }
export function captureNativeWindow(ui: NativeWindow): PsbValue {
return sessionData({
            schemaVersion: 10n,
            compositionProfile: ui.compositionProfile,
            page: ui.visualPage,
            frameOpacity: ui.frameOpacity,
            transition: ui.transition?.mode ?? null,
            messages: ui.messages.capture(),
            selections: {
                fore: ui.selections.fore.capture(),
                back: ui.selections.back.capture()
            },
            chapter: ui.chapter?.capture() ?? null,
            music: ui.music.capture(),
            musicEvents: ui.musicEvents.map((event)=>({
                    name: event.name,
                    event: event.event,
                    storage: event.storage ?? null
                }))
        });

}
export async function restoreNativeWindow(ui: NativeWindow, value: PsbValue, waitingForChoice: boolean, screenActive: boolean): Promise<void> {
const row = psbRecord(value);
        if (typeof row.frameOpacity !== 'number' || !Number.isFinite(row.frameOpacity) || row.frameOpacity < 0 || row.frameOpacity > 1) throw new Error('Invalid saved message window opacity');
        if (row.schemaVersion !== 10n || row.compositionProfile !== ui.compositionProfile || (row.page !== 'fore' && row.page !== 'back') || row.transition !== null && row.transition !== 'transition' || row.transition === 'transition' !== screenActive || row.page === 'back' !== screenActive) throw new Error('Unsupported/inconsistent native UI double-page/transition snapshot');
        const messagePages = psbRecord(row.messages), fore = psbRecord(messagePages.fore), back = psbRecord(messagePages.back);
        // Geometry/pixels are derived from the immutable original PIMG, not copied from a previous live session.
        if (fore.loaded === true || back.loaded === true) await ui.load('both');
        ui.messages.restore(row.messages);
        const selections = psbRecord(row.selections);
        ui.selections.fore.restore(selections.fore, waitingForChoice);
        ui.selections.back.restore(selections.back);
        ui.visualPage = row.page;
        ui.setWindowOpacity(row.frameOpacity);
        ui.transition = screenActive ? {
            mode: 'transition',
            token: ++ui.transitionSequence
        } : undefined;
        if (row.chapter !== null) {
            if (!ui.chapter) ui.chapter = await NativeChapter.open(ui.graphics, ui.root, ui.now);
            await ui.chapter.restore(row.chapter);
        } else {
            ui.chapter?.close();
            ui.chapter = undefined;
        }
        await ui.music.restore(row.music);
        if (!Array.isArray(row.musicEvents) || row.musicEvents.length > 10000) throw new Error('Invalid saved pending music events');
        ui.musicEvents = row.musicEvents.map((item)=>{
            const event = psbRecord(item);
            if (typeof event.name !== 'string' || !musicEvent(event.event) || event.storage !== null && typeof event.storage !== 'string') throw new Error('Invalid saved native music event');
            return {
                name: event.name,
                event: event.event,
                storage: typeof event.storage === 'string' ? event.storage : undefined
            };
        });
        await ui.prepare('fore', ui.now());
        await ui.prepare('back', ui.now());
        ui.tick();

}
