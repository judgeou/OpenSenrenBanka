import { psbRecord } from '../../src/formats/psb-value.ts';
import { NativeTextConverter, captureTextConversion, restoreTextConversion } from './native-text-converter.ts';
import { NativeMessageFlow } from './native-message-flow.ts';
import { NativeMessageRaster } from './native-message-raster.ts';
import type { NativeTextAtom, NativeTextConversion, NativeMessagePresentation, NativeMessageGeometry, NativeMessageRect } from './message-types.ts';
import type { NativeUiPage } from '../../src/graphics/native-ui-planes.ts';
import type { NativeAutoPagePolicy } from './native-auto-page.ts';
import type { PlaybackMode } from '../../src/runtime/playback-gate.ts';
import type { RuntimeDialogue } from '../../src/runtime/types.ts';
export class NativeMessagePage {
    now;
    autoPolicy;
    loaded = false;
    visible = false;
    kind = 'default';
    key = '';
    presentation: NativeMessagePresentation | null = null;
    runs: readonly NativeTextAtom[] = [];
    units = 0;
    flow: NativeMessageFlow | undefined;
    conversion: NativeTextConversion | undefined;
    raster: NativeMessageRaster;
    constructor(root: URL, now: () => number, autoPolicy: NativeAutoPagePolicy, systemFontFamily?: string, pcDialogue = false){
        this.now = now;
        this.autoPolicy = autoPolicy;
        this.raster = new NativeMessageRaster(root, systemFontFamily, pcDialogue);
    }
    async show(dialogue: RuntimeDialogue, mode: Readonly<PlaybackMode>, wasRead: boolean, body: NativeMessageGeometry, nameRect: NativeMessageRect, conversion: NativeTextConversion) {
        if ((dialogue.flags & 256n) !== 0n) throw new Error('Native negative text indentation is not yet bound');
        if (!this.loaded) throw new Error('meswinload must precede dialogue on its target page');
        const name = dialogue.displayName ?? dialogue.speaker;
        if (name !== null && typeof name !== 'string') throw new Error('Unimplemented native display-name program');
        const program = conversion.program;
        const layout = await this.raster.prepare(program.atoms, name ?? '', body, nameRect, wasRead, (dialogue.flags & 128n) !== 0n ? 1 : 0, this.kind === 'another');
        const flow = new NativeMessageFlow(this.now, program.sourceLength, program.finalSize, this.autoPolicy);
        flow.start(layout, mode, (dialogue.flags & 4n) !== 0n);
        this.conversion = conversion;
        this.runs = program.atoms;
        this.units = layout.units;
        this.flow = flow;
        this.presentation = {
            body: dialogue.body,
            displayName: name ?? '',
            flags: dialogue.flags,
            wasRead
        };
        this.key = dialogue.key;
        this.visible = true;
    }
    count() {
        return this.flow?.units ?? 0;
    }
    get bodyPage() {
        return this.flow?.page ?? 0;
    }
    get cursor() {
        return this.flow?.cursor ?? 0;
    }
    get complete() {
        return !this.presentation || this.flow?.done === true;
    }
    get typing() {
        return !!this.flow?.active && !this.flow.done;
    }
    clear() {
        this.key = '';
        this.presentation = null;
        this.runs = [];
        this.units = 0;
        this.flow = undefined;
        this.conversion = undefined;
        this.raster.clear();
    }
    reveal() {
        this.flow?.finish();
    }
    input(mode, normalVoicePlaying) {
        if (!this.flow) return true;
        return this.flow.input(mode, normalVoicePlaying);
    }
    mirrorPrefixFrom(source) {
        if (this.key === source.key && this.sameConversion(source) && this.presentation?.body === source.presentation?.body) this.flow = source.flow?.clone(false);
    }
    sameConversion(source) {
        const a = this.conversion, b = source.conversion;
        return a?.sequence === b?.sequence && a?.program.pendingBefore === b?.program.pendingBefore && a?.program.pendingAfter === b?.program.pendingAfter;
    }
    async prepare(body, name) {
        if (!this.presentation) return;
        const layout = await this.raster.prepare(this.runs, this.presentation.displayName, body, name, this.presentation.wasRead, (this.presentation.flags & 128n) !== 0n ? 1 : 0, this.kind === 'another');
        if (!this.flow || !this.conversion || layout.units !== this.units) throw new Error('Native message program/flow is missing');
        this.flow.bind(layout);
    }
    capture() {
        return {
            schemaVersion: 5n,
            loaded: this.loaded,
            visible: this.visible,
            type: this.kind,
            key: this.key,
            presentation: this.presentation && {
                ...this.presentation
            },
            conversion: this.conversion ? captureTextConversion(this.conversion) : null,
            flow: this.flow?.capture() ?? null
        };
    }
    restore(value) {
        const row = psbRecord(value);
        if (row.schemaVersion !== 5n || typeof row.loaded !== 'boolean' || typeof row.visible !== 'boolean' || (row.type !== 'default' && row.type !== 'another') || typeof row.key !== 'string') throw new Error('Unsupported native message page: saved conversion and cursor are required');
        const p = row.presentation === null ? null : psbRecord(row.presentation);
        if (p && (typeof p.body !== 'string' || p.body.length > 1048576 || typeof p.displayName !== 'string' || p.displayName.length > 4096 || typeof p.wasRead !== 'boolean') || !p && (row.key !== '' || row.flow !== null || row.conversion !== null)) throw new Error('Invalid message page presentation');
        if (p) {
            if (typeof p.body !== 'string' || typeof p.displayName !== 'string' || typeof p.flags !== 'bigint' || (p.flags & 256n) !== 0n) throw new Error('Invalid saved message strings/indentation');
            // A saved page keeps its captured tint; live monotonic read flags still govern newly shown pages.
            this.presentation = { body: p.body, displayName: p.displayName, flags: p.flags, wasRead: p.wasRead === true };
        } else this.presentation = null;
        this.conversion = this.presentation ? restoreTextConversion(row.conversion, this.presentation.body) : undefined;
        const program = this.conversion?.program;
        this.runs = program?.atoms ?? [];
        this.units = this.runs.reduce((n, run)=>n + run.text.replace(/\n/gu, '').length, 0);
        this.flow = program ? new NativeMessageFlow(this.now, program.sourceLength, program.finalSize, this.autoPolicy) : undefined;
        if (this.flow) this.flow.restore(row.flow);
        this.loaded = row.loaded;
        this.visible = row.visible;
        this.kind = row.type;
        this.key = row.key;
        this.raster.clear();
    }
    copyFrom(source, continueWriter = false) {
        const owned = continueWriter ? this.flow?.clone() : undefined;
        this.loaded = source.loaded;
        this.visible = source.visible;
        this.kind = source.kind;
        this.key = source.key;
        this.presentation = source.presentation && {
            ...source.presentation
        };
        this.conversion = source.conversion;
        this.runs = source.runs;
        this.units = source.units;
        this.flow = owned ?? source.flow?.clone(false);
        this.raster.clear();
    }
    close() {
        this.raster.close();
    }
}
export class NativeMessagePages {
    now;
    isRead;
    pages: Record<NativeUiPage, NativeMessagePage>;
    current: NativeUiPage = 'fore';
    withBack = false;
    converter = new NativeTextConverter();
    constructor(root: URL, now: () => number, isRead: (key: string) => boolean, autoPolicy: NativeAutoPagePolicy, systemFontFamily?: string, pcDialogue = false){
        this.now = now;
        this.isRead = isRead;
        this.pages = {
            fore: new NativeMessagePage(root, now, autoPolicy, systemFontFamily, pcDialogue),
            back: new NativeMessagePage(root, now, autoPolicy, systemFontFamily, pcDialogue)
        };
    }
    get writer() {
        return this.pages[this.current];
    }
    other(page: NativeUiPage): NativeUiPage {
        return page === 'fore' ? 'back' : 'fore';
    }
    async show(dialogue: RuntimeDialogue, mode: Readonly<PlaybackMode>, body: NativeMessageGeometry, name: NativeMessageRect) {
        if ((dialogue.flags & (2n | 32n)) !== 0n) throw new Error('Dialogue ' + dialogue.key + ': C3 noer/textwrite-disabled message lifecycle is not bound');
        let conversion;
        try {
            conversion = this.converter.prepare(dialogue.body);
        } catch (error) {
            throw new Error('Dialogue ' + dialogue.key + ': ' + (error instanceof Error ? error.message : String(error)));
        }
        await this.writer.show(dialogue, mode, this.isRead(dialogue.key), body, name, conversion);
        this.converter.commit(conversion);
        const other = this.pages[this.other(this.current)];
        if (this.withBack) {
            other.copyFrom(this.writer);
            await other.prepare(body, name);
        } else if (other.flow?.active) other.flow = other.flow.clone(false);
    }
    tick(mode?: Readonly<PlaybackMode>, normalVoicePlaying = false) {
        if (mode) this.writer.flow?.advance(mode, normalVoicePlaying);
        if (this.withBack) this.pages[this.other(this.current)].mirrorPrefixFrom(this.writer);
    }
    preflightReveal(key) {
        if (this.writer.key !== key) throw new Error('Reveal token targets another message page');
        this.writer.flow?.preflightFinish();
    }
    reveal(key) {
        this.preflightReveal(key);
        this.writer.reveal();
        this.tick();
    }
    input(key, mode, normalVoicePlaying) {
        if (this.writer.key !== key) throw new Error('Dialogue input targets another message page');
        const done = this.writer.input(mode, normalVoicePlaying);
        this.tick();
        return done;
    }
    preflightCopy(from, to) {
        if (from === to) return;
        const source = this.pages[from], target = this.pages[to], active = to === this.current && target.typing;
        source.flow?.preflightFinish();
        target.flow?.preflightFinish();
        if (active && (source.key !== target.key || !source.sameConversion(target) || source.presentation?.body !== target.presentation?.body || source.cursor !== target.cursor || source.bodyPage !== target.bodyPage)) throw new Error('C3 copying a different cursor over an active message conductor requires original event transfer');
    }
    copy(from, to) {
        this.preflightCopy(from, to);
        if (from !== to) this.pages[to].copyFrom(this.pages[from], to === this.current && this.pages[to].typing);
    }
    select(page, withBack) {
        if (page !== this.current && this.writer.typing) throw new Error('C3 current-page change during active message conductor is not yet bound');
        this.current = page;
        this.withBack = withBack;
    }
    preflightExchange() {
        const writer = this.writer, other = this.pages[this.other(this.current)];
        for (const page of Object.values(this.pages))page.flow?.preflightFinish();
        if (writer.typing && (!this.withBack || other.key !== writer.key || !other.sameConversion(writer) || other.presentation?.body !== writer.presentation?.body || other.cursor !== writer.cursor || other.bodyPage !== writer.bodyPage)) throw new Error('C3 transition during non-mirrored inline conductor requires original event transfer');
    }
    exchangeAfterNativeTransition() {
        this.preflightExchange();
        const writer = this.writer, active = writer.typing, clock = writer.flow?.clone();
        this.pages.fore.copyFrom(this.pages.back);
        const before = this.pages.fore;
        this.pages.fore = this.pages.back;
        this.pages.back = before;
        if (active) this.writer.flow = clock;
        const other = this.pages[this.other(this.current)];
        if (other.flow?.active) other.flow = other.flow.clone(false);
    }
    capture() {
        return {
            schemaVersion: 4n,
            current: this.current,
            withBack: this.withBack,
            converter: this.converter.capture(),
            fore: this.pages.fore.capture(),
            back: this.pages.back.capture()
        };
    }
    restore(value) {
        const row = psbRecord(value);
        if (row.schemaVersion !== 4n || (row.current !== 'fore' && row.current !== 'back') || typeof row.withBack !== 'boolean') throw new Error('Unsupported native message page selector/converter schema');
        this.converter.restore(row.converter);
        this.pages.fore.restore(row.fore);
        this.pages.back.restore(row.back);
        this.current = row.current;
        this.withBack = row.withBack;
        for (const page of Object.values(this.pages))this.converter.validate(page.conversion);
        const fore = this.pages.fore, back = this.pages.back;
        if (fore.conversion && fore.conversion.sequence === back.conversion?.sequence && (!fore.sameConversion(back) || fore.key !== back.key || fore.presentation?.body !== back.presentation?.body)) throw new Error('Saved copies disagree about one text conversion');
        if (this.pages[this.other(this.current)].flow?.active) throw new Error('Saved non-writer message page owns future events');
    }
    close() {
        this.pages.fore.close();
        this.pages.back.close();
    }
}
