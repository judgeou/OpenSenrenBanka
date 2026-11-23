import {openWindowFrame} from './native-window-frame.ts';
import { psbRecord } from '../../src/formats/psb-value.ts';
import { appendNativeText } from './rich-text.ts';
import { NativeChapter, chapterPixelLease } from './native-chapter.ts';
import { type ImmutablePixels, pixelPlane } from './immutable-pixels.ts';
import {pcDisplayName} from './native-message-raster.ts';
import { NativeMusicTitle } from './native-music-title.ts';
import { NativeChoices } from './native-choices.ts';
import { NativeMessagePages } from './native-message-pages.ts';
import { nativeNumber } from '../../src/world/native-values.ts';
import type { NativeUiSource, NativeUiPage, NativeUiPageLease, NativeUiPlane } from '../../src/graphics/native-ui-planes.ts';
import type { NativeUiGraphics } from './resources.ts';
import { nativeAutoPagePolicy } from './native-auto-page.ts';
import type { NativeAutoPagePolicy } from './native-auto-page.ts';
import type { PsbValue } from '../../src/formats/psb-value.ts';
import type { PlaybackMode } from '../../src/runtime/playback-gate.ts';
import type { NativeMessageGeometry, NativeMessageRect, NativeMusicEvent } from './message-types.ts';
import {indicatorDue,timedPlaneState} from './native-window-work.ts';
import { captureNativeWindow, restoreNativeWindow } from './native-window-state.ts';
/** Open the production window at the authored stage size. */
export async function openSessionWindow(graphics: NativeUiGraphics, root: HTMLElement, now: () => number, resourceRoot: URL,
    isRead: (key: string) => boolean, perspective: boolean, systemFontFamily?: string, pcOpacity?: () => number): Promise<NativeWindow> {
    return new NativeWindow(graphics, root, now, resourceRoot, 1920, 1080, isRead, await nativeAutoPagePolicy(resourceRoot), perspective, systemFontFamily, pcOpacity);
}

export class NativeWindow implements NativeUiSource {
    graphics: NativeUiGraphics;
    root: HTMLElement;
    now: () => number;
    surfaceWidth: number;
    surfaceHeight: number;
    compositionProfile = 'kag-layer-nond3d-v1' as const;
    inputSession = Object.freeze({});
    inputPublished = false;
    publishInputs() {
        if (this.closed) throw new Error('Cannot publish inputs of closed UI');
        if (this.inputPublished) return;
        this.inputPublished = true;
        this.selections.fore.deliverCompletedChoice();
    }
    retireInputs() {
        this.inputPublished = false;
    }
    publicationGeneration = 0;
    prepared = new Map<NativeUiPage, { generation: number; now: number }>();
    framePixels: ImmutablePixels | undefined;
    private alternatePixels?:ImmutablePixels;
    frameOpacity = 1;
    playerHidden = false;
    get activeMessage() { return this.messages.pages[this.visualPage]; }
    setPlayerHidden(value: boolean) { this.playerHidden = value; this.root.classList.toggle('pc-message-hidden', value); this.tick(); }
    setWindowOpacity(value: number): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid original window opacity'); this.frameOpacity = value; this.publish(); }
    closed = false;
    visualPage: NativeUiPage = 'fore';
    transition;
    transitionSequence = 0;
    worldCommand;
    async withWorldCommand(parameters, operation) {
        if (this.worldCommand) throw new Error('Nested world UI command is not supported');
        this.worldCommand = parameters;
        try {
            return await operation();
        } finally{
            this.worldCommand = undefined;
        }
    }
    messages: NativeMessagePages;
    selections: Record<NativeUiPage, NativeChoices>;
    messageGeometry: NativeMessageGeometry | undefined;
    nameRect: NativeMessageRect | undefined;
    layer = document.createElement('div');
    name = document.createElement('div');
    body = document.createElement('div');
    semanticPresentation;
    private semanticCount = -1;
    private lastTickPixels: readonly unknown[] = [];
    get frameAnimation(): boolean {
        const now = this.now();
        return indicatorDue(this) <= now || this.selections.fore.animating || this.selections.back.animating;
    }
    get nextVisualChange(): number {
        return Math.min(this.messages.writer.flow?.nextChange ?? Infinity, indicatorDue(this));
    }
    chapter: NativeChapter | undefined;
    musicEvents: NativeMusicEvent[] = [];
    music: NativeMusicTitle;
    constructor(graphics: NativeUiGraphics, root: HTMLElement, now: () => number, resourceRoot: URL, surfaceWidth: number, surfaceHeight: number, isRead: (key: string) => boolean, autoPolicy: NativeAutoPagePolicy,private readonly perspective=false,systemFontFamily?: string,private readonly pcOpacity?: () => number){
        this.graphics = graphics;
        this.root = root;
        this.now = now;
        this.surfaceWidth = surfaceWidth;
        this.surfaceHeight = surfaceHeight;
        root.classList.add('native-pixel-ui');
        this.layer.className = 'native-message';
        this.layer.hidden = true;
        this.name.className = 'native-name';
        this.body.className = 'native-text';
        this.layer.append(this.name, this.body);
        root.append(this.layer);
        this.messages = new NativeMessagePages(resourceRoot, now, isRead, autoPolicy, systemFontFamily, !!pcOpacity);
        this.music = new NativeMusicTitle(graphics, root, now, resourceRoot, systemFontFamily);
        let fore, back;
        fore = new NativeChoices(graphics, root, now, resourceRoot, ()=>this.selections.fore === fore ? 'fore' : 'back', this.inputSession, ()=>this.inputPublished && !this.closed, systemFontFamily);
        back = new NativeChoices(graphics, root, now, resourceRoot, ()=>this.selections.fore === back ? 'fore' : 'back', this.inputSession, ()=>this.inputPublished && !this.closed, systemFontFamily);
        this.selections = {
            fore,
            back
        };
    }
    preflightPublication() {
        if (this.closed || !Number.isSafeInteger(this.publicationGeneration + 1)) throw new Error('Native UI publication is closed/exhausted');
    }
    publish() {
        this.preflightPublication();
        this.publicationGeneration++;
        this.prepared.clear();
    }
    publication() {
        return Object.freeze({
            generation: this.publicationGeneration,
            page: this.visualPage
        });
    }
    async prepareFonts() {
        await Promise.all([
            this.music.prepareFonts(),
            ...Object.values(this.messages.pages).map((page)=>page.raster.ready()),
            ...Object.values(this.selections).map((selection)=>selection.prepareFonts())
        ]);
    }
    async prepare(page: NativeUiPage, now: number): Promise<void> {
        if (this.closed || ![
            'fore',
            'back'
        ].includes(page) || !Number.isFinite(now) || now !== this.now()) throw new Error('Native UI page/time is unavailable');
        const message = this.messages.pages[page];
        if (message.presentation) {
            if (!this.messageGeometry || !this.nameRect) throw new Error('Original message rectangles are missing');
            await message.prepare(this.messageGeometry, this.nameRect);
        }
        await this.selections[page].preparePixels();
        this.selections[page].assertPixelReady();
        this.music.validatePixels();
        this.prepared.set(page, {
            generation: this.publicationGeneration,
            now
        });
    }
    acquire(page: NativeUiPage, now: number): NativeUiPageLease {
        const prepared = this.prepared.get(page);
        if (this.closed || !prepared || prepared.generation !== this.publicationGeneration || prepared.now !== now) throw new Error('Native UI page is not prepared for this publication');
        const releases: (() => void)[] = [], planes: NativeUiPlane[] = [];
        try {
            const chapter = this.chapter?.acquire(page) ?? chapterPixelLease(page);
            releases.push(chapter.release);
            planes.push(...chapter.planes);
            const music = this.music.acquire(page);
            releases.push(music.release);
            planes.push(...music.planes);
            const selection = this.selections[page].acquire(page);
            releases.push(selection.release);
            planes.push(...selection.planes);
            const message = this.messages.pages[page], visible = message.loaded && message.visible && !this.playerHidden;
            const frame = pixelPlane(visible ? (message.kind==='another'?this.alternatePixels:this.framePixels) : undefined, {
                root: page === 'fore' ? 'fore.base' : 'back.base',
                id: 'message-frame',
                left: 0,
                top: 0,
                scaleX: 1,
                scaleY: 1,
                opacity: (this.pcOpacity?.() ?? 1) * this.frameOpacity,
                visible,
                clipRectangle: [
                    0,
                    0,
                    this.surfaceWidth,
                    this.surfaceHeight
                ],
                order: {
                    kind: 'absolute',
                    absolute: 1000000,
                    localOrder: 0
                }
            });
            planes.push(frame.plane);
            releases.push(frame.release);
            const text = message.raster.acquire(page, message.count(), visible && message.presentation !== null, this.surfaceWidth, this.surfaceHeight, message.bodyPage, message.cursor);
            planes.push(...text.planes);
            releases.push(text.release);
            let released = false;
            return {
                page,
                generation: this.publicationGeneration,
                planes: Object.freeze(planes),
                release () {
                    if (!released) {
                        released = true;
                        for (const release of releases.reverse())release();
                    }
                }
            };
        } catch (error) {
            for (const release of releases.reverse())release();
            throw error;
        }
    }
    async load(page: NativeUiPage | 'both') {
        if (![
            'both',
            'fore',
            'back'
        ].includes(page)) throw new Error('Unknown message page: ' + page);
        if (!this.framePixels) {
            const {frame,alternate,name,body}=await openWindowFrame(this.graphics,this.perspective,!!this.pcOpacity);
            this.framePixels=frame;this.alternatePixels=alternate;this.nameRect=name;this.messageGeometry=body;
        }
        for (const target of [
            'fore',
            'back'
        ] as const)if (page === 'both' || page === target) this.messages.pages[target].loaded = true;
        this.publish();
    }
    async show(dialogue, mode) {
        if (!this.messageGeometry || !this.nameRect) throw new Error('Original message geometry must be loaded before dialogue');
        await this.messages.show(dialogue, mode, this.messageGeometry, this.nameRect);
        this.selections.fore.clear();
        this.selections.back.clear();
        this.tick();
    }
    revealed(key) {
        return this.messages.writer.key !== key || this.messages.writer.complete;
    }
    preflightReveal(key) {
        this.preflightPublication();
        this.messages.preflightReveal(key);
    }
    reveal(key) {
        this.preflightReveal(key);
        this.messages.reveal(key);
        this.tick();
    }
    continueDialogue(key, mode, normalVoicePlaying) {
        const done = this.messages.input(key, mode, normalVoicePlaying);
        this.tick();
        return done;
    }
    validateDialogueWait(key, pendingReveal) {
        const page = this.messages.writer;
        if (page.key !== key || page.complete) return;
        if (pendingReveal !== !!page.flow?.active) throw new Error('Saved dialogue token and continuing message writer differ');
    }
    revealCount() {
        return this.messages.writer.count();
    }
    tick(mode?: Readonly<PlaybackMode>, normalVoicePlaying = false) {
        this.messages.tick(mode, normalVoicePlaying);
        const message = this.messages.writer;
        if (this.semanticPresentation !== message.presentation) {
            this.semanticPresentation = message.presentation;
            const name = message.presentation?.displayName ?? '';
            this.name.textContent = this.pcOpacity ? pcDisplayName(name) : name;
            appendNativeText(this.body, message.runs);
            this.semanticCount = -1;
        }
        const hidden = !message.visible || this.playerHidden;
        if (this.layer.hidden !== hidden) this.layer.hidden = hidden;
        const shown = message.count();
        if (shown !== this.semanticCount) {
            this.semanticCount = shown;
            let count = 0;
            for (const child of this.body.children) {
                if (!(child instanceof HTMLElement)) throw new Error('Native UI semantic child is not an HTML element');
                count += Number(child.dataset.units);
                const visibility = count <= shown ? 'visible' : 'hidden';
                if (child.style.visibility !== visibility) child.style.visibility = visibility;
            }
        }
        this.chapter?.tick();
        this.music.tick();
        this.selections.fore.tick();
        this.selections.back.tick();
        const state = timedPlaneState(this,this.pcOpacity?.());
        if (state.length !== this.lastTickPixels.length || state.some((value, i) => value !== this.lastTickPixels[i])) {
            this.lastTickPixels = state;
            this.publish();
        }
    }
    hide() {
        for (const page of Object.values(this.messages.pages)){
            page.visible = false;
            page.clear();
        }
        this.tick();
    }
    eraseText(): void { for (const page of Object.values(this.messages.pages)) page.clear(); this.tick(); }
    resetTextContext(): void {
        if (this.transition) throw new Error('Cannot reset text during world UI transition');
        this.hide(); this.messages.converter.reset();
    }
    change(type) {
        if(type!=='default'&&(type!=='another'||!this.perspective||!this.alternatePixels))throw Error('Unbound original message-window type: '+type);
        this.messages.pages.fore.kind = type;
        this.messages.pages.back.kind = type;
        this.publish();
    }
    selectCurrent(page, withBack) {
        this.messages.select(page, withBack ?? this.messages.withBack);
        this.tick();
    }
    copyUi(from, to, scope) {
        this.messages.copy(from, to);
        if (scope === 'all') this.selections[to].assignBaseControl(this.selections[from]);
        this.tick();
    }
    prepareWorldUi() {
        if (this.transition) this.completeWorldUi(this.transition.token);
        this.copyUi('fore', 'back', 'all');
    }
    beginWorldUi(value, mode) {
        const raw = psbRecord(value), effect = mode.skip === 'none' && raw.method !== '' && nativeNumber(raw.time, 0) > 0;
        this.transition = {
            mode: effect ? 'transition' : 'copy',
            token: ++this.transitionSequence
        };
        this.visualPage = 'back';
        this.publish();
    }
    finishWorldUi() {
        const command = this.worldCommand;
        if (command?.msgchange !== undefined) {
            const back = this.messages.pages.back;
            back.visible = nativeNumber(command.msgchange, 0) !== 0;
            if (!back.visible) back.clear();
        }
        const wait = command?.wait, list = wait !== undefined && wait !== null ? psbRecord(wait).list : undefined;
        if (command && !(Array.isArray(list) && (list[0] === null || list[0] === undefined))) this.messages.withBack = true;
        if (this.transition?.mode === 'copy') {
            this.copyUi('back', 'fore', 'all');
            this.transition = undefined;
            this.visualPage = 'fore';
        }
        this.publish();
    }
    get worldTransitionToken() {
        return this.transition?.token;
    }
    get hasWorldTransition() {
        return this.transition !== undefined;
    }
    preflightCompleteWorldUi(token) {
        if (this.closed) throw new Error('Native UI is closed');
        if (!this.transition) return;
        if (this.transition.token !== token) throw new Error('UI completion token is stale');
        this.preflightPublication();
        if (this.transition.mode === 'transition') this.messages.preflightExchange();
        else this.messages.preflightCopy('back', 'fore');
    }
    completeWorldUi(token) {
        if (!this.transition || this.transition.token !== token) return;
        this.preflightCompleteWorldUi(token);
        if (this.transition.mode === 'transition') {
            this.messages.exchangeAfterNativeTransition();
            const previous = this.selections.fore;
            this.selections.fore = this.selections.back;
            this.selections.back = previous;
        } else {
            this.messages.copy('back', 'fore');
            this.selections.fore.assignBaseControl(this.selections.back);
        }
        this.transition = undefined;
        this.visualPage = 'fore';
        this.publish();
    }
    async chapterCommand(parameters, order, skip) {
        if (!this.chapter) this.chapter = await NativeChapter.open(this.graphics, this.root, this.now);
        await this.chapter.command(parameters, order, skip);
        this.publish();
    }
    queueMusic(name, event, storage) {
        if (this.musicEvents.length >= 10000) throw new Error('Native music event backlog exceeded');
        this.musicEvents.push({
            name,
            event,
            storage
        });
    }
    async synchronize() {
        while(this.musicEvents.length){
            const event = this.musicEvents[0];
            await this.music.event(event.name, event.event, event.storage);
            this.musicEvents.shift();
            this.publish();
        }
    }
    async showChoices(choices, info) {
        this.hide();
        await this.selections.fore.show(choices, info);
        await this.selections.back.show(choices, info);
        this.publish();
    }
    choiceAppearance(generation, index, kind) {
        this.selections.fore.appearance(generation, index, kind);
        this.publish();
    }
    choiceInput(generation, index) {
        this.selections.fore.accept(generation, index);
        this.publish();
    }
    choiceDone(generation, index) {
        const retired = this.selections.fore.retire(generation, index);
        if (retired) {
            this.selections.back.clear();
            this.publish();
        }
        return retired;
    }
    quickMenu(visible, time) {
        this.chapter?.quickMenu(visible, time);
        this.music.quickMenu(visible, time);
        this.publish();
    }
    capture(_waitingForChoice = false): PsbValue { return captureNativeWindow(this); }
    async restore(value: PsbValue, waitingForChoice: boolean, screenActive: boolean): Promise<void> { return restoreNativeWindow(this, value, waitingForChoice, screenActive); }
    restoreDialogue(dialogue, _mode) {
        const m = this.messages.writer;
        if (m.key === dialogue.key && (!m.presentation || dialogue.body !== m.presentation.body || (dialogue.displayName ?? dialogue.speaker ?? '') !== m.presentation.displayName)) throw new Error('Saved dialogue page and original source differ');
        this.tick();
    }
    close() {
        this.retireInputs();
        this.closed = true;
        this.prepared.clear();
        this.root.classList.remove('native-pixel-ui', 'pc-message-hidden');
        this.alternatePixels?.close();this.alternatePixels=undefined;
        this.framePixels?.close();
        this.framePixels = undefined;
        this.layer.remove();
        this.chapter?.close();
        this.music.close();
        this.messages.close();
        this.selections.fore.close();
        this.selections.back.close();
    }
}
