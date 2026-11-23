import { psbRecord } from '../../src/formats/psb-value.ts';
import { NativeChoiceRaster } from './native-choice-raster.ts';
import type { NativeChoiceItem } from './message-types.ts';
import type { Choice } from '../../src/scenario/flow.ts';
import type { PsbValue } from '../../src/formats/psb-value.ts';
export const choiceAppearanceKinds = [
    'enter',
    'leave',
    'focus',
    'blur',
    'press',
    'release',
    'cancel'
];
let choiceGeneration = 0;
function globalChoiceGeneration() {
    if (!Number.isSafeInteger(++choiceGeneration)) throw new Error('Choice generation exhausted');
    return choiceGeneration;
}
export class NativeChoices {
    root;
    now;
    role;
    session;
    inputReady;
    node = document.createElement('div');
    items: NativeChoiceItem[] = [];
    buttons: HTMLButtonElement[] = [];
    pixels;
    hovered = null;
    focused = null;
    pressed = null;
    phase = 'idle';
    began = 0;
    selected = null;
    sent = false;
    generation = 0;
    pending;
    pendingNow = 0;
    control = {
        visible: false,
        paintVisible: false,
        opacity: 1,
        enabled: true,
        invisibleByUser: false,
        visibleBeforeUserInvisible: false
    };
    assignBaseControl(source) {
        this.control = {
            ...source.control,
            paintVisible: source.control.visible
        };
    }
    constructor(resources, root, now, resourceRoot, role, session, inputReady, systemFontFamily?: string){
        this.root = root;
        this.now = now;
        this.role = role;
        this.session = session;
        this.inputReady = inputReady;
        this.pixels = new NativeChoiceRaster(resources, resourceRoot, systemFontFamily);
        this.node.className = 'native-choice-list';
        this.node.setAttribute('role', 'group');
        this.node.setAttribute('aria-label', '原剧情选择');
        Object.assign(this.node.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '902'
        });
        root.append(this.node);
    }
    prepareFonts() {
        return this.pixels.ready();
    }
    async preparePixels() {
        const items = this.pending?.items ?? this.items;
        if (items.length) await this.pixels.prepare(items);
    }
    face(index) {
        const item = this.items.find((item)=>item.index === index);
        if (this.phase !== 'ready' || !this.control.enabled || !item || item.disabled) return 'normal';
        if (this.pressed === index) return 'on';
        return this.hovered === index || this.focused === index ? 'over' : 'normal';
    }
    appearance(generation, index, kind) {
        if (generation !== this.generation || this.phase !== 'ready' || !this.control.enabled || this.role() !== 'fore' || !this.items.some((item)=>item.index === index && !item.disabled)) return;
        if (kind === 'enter') this.hovered = index;
        else if (kind === 'leave') {
            if (this.hovered === index) this.hovered = null;
            if (this.pressed === index) this.pressed = null;
        } else if (kind === 'focus') this.focused = index;
        else if (kind === 'blur') {
            if (this.focused === index) this.focused = null;
        } else if (kind === 'press') this.pressed = index;
        else if (kind === 'release' || kind === 'cancel') {
            if (this.pressed === index) this.pressed = null;
        } else throw new Error('Unknown original selection appearance request');
    }
    acquire(page) {
        const saved = this.pending, items = saved?.items ?? this.items;
        if (!items.length) return {
            planes: [],
            release () {}
        };
        const opacity = this.control.paintVisible && !this.control.invisibleByUser ? this.control.opacity : 0;
        return this.pixels.acquire(page, items, opacity, (offset)=>saved ? 'normal' : this.face(items[offset].index));
    }
    async show(choices, info) {
        if (info !== undefined && info !== null && Object.keys(psbRecord(info)).length) throw new Error('Unimplemented original selection option override');
        if (!choices.length || choices.length > 1000) throw new Error('Invalid native choice count');
        const identities = new Set();
        const items = choices.map((choice)=>{
            if (!Number.isSafeInteger(choice.index) || choice.index < 0 || identities.has(choice.index) || typeof choice.text !== 'string' || choice.text.length > 16384) throw new Error('Invalid or duplicate native choice identity/text');
            identities.add(choice.index);
            for (const key of Object.keys(choice.raw))if (![
                'type',
                'storage',
                'target',
                'eval',
                'exp',
                'text',
                'tag',
                'selidx',
                'render',
                'selected',
                'disabled'
            ].includes(key)) throw new Error('Unimplemented native choice field: ' + key);
            const disabled = choice.raw.disabled;
            if (disabled !== undefined && disabled !== null && disabled !== 0n && disabled !== 1n && disabled !== false && disabled !== true && disabled !== 0 && disabled !== 1) throw new Error('Invalid original disabled-choice state');
            const render = choice.raw.render;
            if (render !== undefined && render !== null && render !== 0n && render !== 1n && render !== 0 && render !== 1 && render !== false && render !== true) throw new Error('Invalid native choice text-render mode');
            const visited = choice.raw.selected;
            if (visited !== undefined && visited !== null && visited !== 0n && visited !== 1n && visited !== 0 && visited !== 1 && visited !== false && visited !== true) throw new Error('Invalid native previously-selected state');
            return {
                index: choice.index,
                text: choice.text,
                disabled: disabled === 1n || disabled === 1 || disabled === true,
                render: render === 1n || render === 1 || render === true,
                visited: visited === 1n || visited === 1 || visited === true
            };
        });
        const generation = this.generation = globalChoiceGeneration();
        const saved = this.pending;
        if (saved && (saved.items.length !== items.length || saved.items.some((item, index)=>item.index !== items[index].index || item.text !== items[index].text || item.disabled !== items[index].disabled || item.render !== items[index].render || item.visited !== items[index].visited))) throw new Error('Saved selection presentation differs from original source');
        const presentationItems = saved?.items ?? items;
        await this.pixels.prepare(presentationItems);
        this.hovered = this.focused = this.pressed = null;
        this.items = presentationItems;
        this.node.replaceChildren();
        this.buttons = [];
        this.phase = saved?.phase ?? 'in';
        this.began = this.now() - (saved?.age ?? 0);
        this.selected = saved?.selected ?? null;
        this.sent = false;
        this.pending = undefined;
        if (!saved) this.control = {
            visible: true,
            paintVisible: true,
            opacity: 0,
            enabled: true,
            invisibleByUser: false,
            visibleBeforeUserInvisible: false
        };
        for (const [offset, item] of items.entries()){
            const button = document.createElement('button'), label = document.createElement('span'), size = this.pixels.size, position = this.pixels.position(offset, items.length);
            button.type = 'button';
            button.className = 'native-choice-button';
            button.setAttribute('aria-label', item.text);
            label.textContent = item.text;
            button.append(label);
            Object.assign(button.style, {
                all: 'unset',
                boxSizing: 'border-box',
                position: 'absolute',
                left: position.x / 1920 * 100 + '%',
                top: position.y / 1080 * 100 + '%',
                width: size.width / 1920 * 100 + '%',
                height: size.height / 1080 * 100 + '%',
                cursor: 'pointer',
                pointerEvents: 'auto'
            });
            const request = (kind)=>this.root.dispatchEvent(new CustomEvent('senren-choice-appearance', {
                    detail: {
                        session: this.session,
                        generation,
                        index: item.index,
                        kind
                    }
                }));
            const hit = (event)=>{
                const rect = button.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                // The screen bounding box has swapped axes when the landscape stage turns clockwise.
                const turned = getComputedStyle(this.root).getPropertyValue('--native-choice-turn').trim() === '90deg';
                const x = turned ? (event.clientY - rect.top) * size.width / rect.height : (event.clientX - rect.left) * size.width / rect.width;
                const y = turned ? (rect.right - event.clientX) * size.height / rect.width : (event.clientY - rect.top) * size.height / rect.height;
                return this.pixels.hit(item, x, y, this.face(item.index));
            };
            let pointerInside = false;
            const move = (event)=>{
                if (button.disabled) return;
                const inside = hit(event);
                if (inside !== pointerInside) {
                    pointerInside = inside;
                    request(inside ? 'enter' : 'leave');
                    if (inside) button.focus();
                    else button.blur();
                }
            };
            button.onpointerenter = move;
            button.onpointermove = move;
            button.onpointerleave = ()=>{
                pointerInside = false;
                request('leave');
                button.blur();
            };
            button.onfocus = ()=>request('focus');
            button.onblur = ()=>request('blur');
            button.onpointerdown = (event)=>{
                if (event.button !== 0) return;
                if (!button.disabled && hit(event)) request('press');
                else event.preventDefault();
            };
            button.onpointerup = (event)=>{
                if (event.button === 0) request(hit(event) ? 'release' : 'cancel');
            };
            button.onpointercancel = ()=>request('cancel');
            const select = ()=>{
                this.root.dispatchEvent(new CustomEvent('senren-choice-input', {
                    detail: {
                        session: this.session,
                        generation,
                        index: item.index
                    }
                }));
            };
            button.onclick = (event)=>{
                event.stopPropagation();
                if (!event.detail || hit(event)) select();
            };
            button.onkeydown = (event)=>{
                if ([
                    'Enter',
                    'Space'
                ].includes(event.code)) {
                    event.preventDefault();
                    if (!event.repeat) select();
                } else if ([
                    'ArrowUp',
                    'ArrowDown'
                ].includes(event.code)) {
                    event.preventDefault();
                    let next = offset;
                    for(let count = 0; count < items.length; count++){
                        next = (next + (event.code === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
                        if (!items[next].disabled) {
                            this.buttons[next]?.focus();
                            break;
                        }
                    }
                }
            };
            this.buttons.push(button);
            this.node.append(button);
        }
        this.tick();
    }
    get animating(): boolean {
        if (this.pending) return this.pending.phase === 'in' || this.pending.phase === 'out' && this.pending.age < 200;
        return this.phase === 'in' || this.phase === 'out' && this.now() - this.began < 200;
    }
    tick() {
        if (this.pending) {
            const saved = this.pending;
            saved.age += Math.max(0, this.now() - this.pendingNow);
            this.pendingNow = this.now();
            if (saved.phase === 'in') {
                this.control.opacity = Math.min(1, saved.age / 200);
                if (saved.age >= 200) {
                    saved.phase = 'ready';
                    this.control.enabled = true;
                }
            } else if (saved.phase === 'out') this.control.opacity = Math.max(0, 1 - saved.age / 200);
            this.node.hidden = true;
            return;
        }
        if (this.phase === 'idle') {
            this.node.hidden = true;
            return;
        }
        const elapsed = Math.max(0, this.now() - this.began);
        if (this.phase === 'in') {
            this.control.opacity = Math.min(1, elapsed / 200);
            if (elapsed >= 200) {
                this.phase = 'ready';
                this.control.enabled = true;
            }
        } else if (this.phase === 'out') this.control.opacity = Math.max(0, 1 - elapsed / 200);
        const hidden = this.role() !== 'fore' || !this.control.paintVisible || this.control.invisibleByUser;
        if (this.node.hidden !== hidden) this.node.hidden = hidden;
        const opacity = String(this.control.opacity);
        if (this.node.style.opacity !== opacity) this.node.style.opacity = opacity;
        for (const [index, button] of this.buttons.entries()) {
            const disabled = this.phase !== 'ready' || !this.control.enabled || this.role() !== 'fore' || this.items[index].disabled;
            if (button.disabled !== disabled) button.disabled = disabled;
        }
        this.deliverCompletedChoice();
    }
    deliverCompletedChoice() {
        if (this.pending || !this.inputReady() || this.role() !== 'fore' || this.phase !== 'out' || this.now() - this.began < 200 || this.sent || this.selected === null) return;
        this.sent = true;
        this.root.dispatchEvent(new CustomEvent('senren-choice', {
            detail: {
                session: this.session,
                generation: this.generation,
                index: this.selected
            }
        }));
    }
    assertPixelReady() {
        const items = this.pending?.items ?? this.items;
        if (items.length) this.pixels.validate(items);
    }
    accept(generation, index) {
        if (generation !== this.generation || this.phase !== 'ready' || !this.control.enabled || this.role() !== 'fore') return;
        const offset = this.items.findIndex((item)=>item.index === index && !item.disabled);
        if (offset < 0) return;
        this.selected = index;
        this.phase = 'out';
        this.began = this.now();
        this.control.visible = false;
        this.hovered = this.focused = this.pressed = null;
        this.tick();
    }
    retire(generation, index) {
        if (generation !== this.generation || this.phase !== 'out' || !this.sent || this.selected !== index) return false;
        this.clear();
        return true;
    }
    clear() {
        this.generation = globalChoiceGeneration();
        this.control = {
            visible: false,
            paintVisible: false,
            opacity: 1,
            enabled: true,
            invisibleByUser: false,
            visibleBeforeUserInvisible: false
        };
        this.phase = 'idle';
        this.items = [];
        this.buttons = [];
        this.pending = undefined;
        this.hovered = this.focused = this.pressed = null;
        this.pixels.clear();
        this.node.replaceChildren();
        this.node.hidden = true;
    }
    capture() {
        if (this.pending) return {
            schemaVersion: 3n,
            active: true,
            control: {
                ...this.control
            },
            phase: this.pending.phase,
            selected: this.pending.selected,
            age: this.pending.age,
            items: this.pending.items.map((item)=>({
                    ...item
                }))
        };
        if (this.phase === 'idle') return {
            schemaVersion: 3n,
            active: false,
            control: {
                ...this.control
            }
        };
        return {
            schemaVersion: 3n,
            active: true,
            control: {
                ...this.control
            },
            phase: this.phase,
            selected: this.selected,
            age: Math.max(0, this.now() - this.began),
            items: this.items.map((item)=>({
                    ...item
                }))
        };
    }
    restore(value: PsbValue, waitingForChoice: boolean | undefined = undefined) {
        this.clear();
        const row = psbRecord(value);
        if (row.schemaVersion !== 3n || typeof row.active !== 'boolean') throw new Error('Invalid saved selection state');
        const control = psbRecord(row.control);
        if (typeof control.visible !== 'boolean' || typeof control.paintVisible !== 'boolean' || typeof control.enabled !== 'boolean' || typeof control.invisibleByUser !== 'boolean' || typeof control.visibleBeforeUserInvisible !== 'boolean' || typeof control.opacity !== 'number' || !Number.isFinite(control.opacity) || control.opacity < 0 || control.opacity > 1) throw new Error('Invalid saved selection base control');
        this.control = {
            visible: control.visible,
            paintVisible: control.paintVisible,
            opacity: control.opacity,
            enabled: control.enabled,
            invisibleByUser: control.invisibleByUser,
            visibleBeforeUserInvisible: control.visibleBeforeUserInvisible
        };
        if (waitingForChoice !== undefined && row.active !== waitingForChoice) throw new Error('Saved selection presentation and player wait owner differ');
        if (!row.active) return;
        if (![
            'in',
            'ready',
            'out'
        ].includes(String(row.phase)) || typeof row.age !== 'number' || !Number.isFinite(row.age) || row.age < 0 || !Array.isArray(row.items) || !row.items.length || row.items.length > 1000) throw new Error('Invalid saved selection phase');
        const items = row.items.map((item)=>{
            const value = psbRecord(item);
            if (typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0 || typeof value.text !== 'string' || typeof value.disabled !== 'boolean' || typeof value.render !== 'boolean' || typeof value.visited !== 'boolean') throw new Error('Invalid saved selection item');
            return {
                index: value.index,
                text: value.text,
                disabled: value.disabled,
                render: value.render,
                visited: value.visited
            };
        });
        if (new Set(items.map((item)=>item.index)).size !== items.length || items.some((item)=>item.text.length > 16384)) throw new Error('Invalid saved selection identity/text budget');
        if (row.selected !== null && (typeof row.selected !== 'number' || !items.some((item)=>item.index === row.selected && !item.disabled))) throw new Error('Saved selection target is unavailable');
        if (row.phase === 'out' !== (row.selected !== null)) throw new Error('Saved selection phase and pending choice differ');
        this.pending = {
            items,
            phase: row.phase,
            selected: row.selected,
            age: row.age
        };
        this.pendingNow = this.now();
    }
    close() {
        this.clear();
        this.node.remove();
        this.pixels.close();
    }
}
