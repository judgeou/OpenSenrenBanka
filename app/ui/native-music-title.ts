import { delimitedRows } from '../../src/formats/delimited.ts';
import { psbRecord } from '../../src/formats/psb-value.ts';
import { originalText } from '../original-text.ts';
import { NativeIndicator } from './native-indicator.ts';
import { ImmutablePixels, pixelPlane } from './immutable-pixels.ts';
import type { NativePixelLease } from './message-types.ts';
import { NativeTextRaster } from './native-text-raster.ts';
export class NativeMusicTitle {
    resources;
    root;
    now;
    resourceRoot;
    node = document.createElement('div');
    base = document.createElement('img');
    black = document.createElement('img');
    text = document.createElement('div');
    indicator;
    titles = new Map();
    playing: string | null = null;
    displayed: string | null = null;
    basePixels;
    blackPixels;
    mainPixels;
    raster;
    definition;
    urls: string[] = [];
    loading;
    constructor(resources, root, now, resourceRoot, systemFontFamily?: string){
        this.resources = resources;
        this.root = root;
        this.now = now;
        this.resourceRoot = resourceRoot;
        this.raster = new NativeTextRaster(resourceRoot, systemFontFamily);
        this.node.className = 'native-music-title';
        this.node.setAttribute('aria-hidden', 'true');
        Object.assign(this.node.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '65'
        });
        for (const image of [
            this.black,
            this.base
        ]){
            image.alt = '';
            image.style.position = 'absolute';
        }
        Object.assign(this.text.style, {
            position: 'absolute',
            fontFamily: 'SenrenOriginal',
            fontSize: '1.25cqw',
            lineHeight: '1',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            WebkitTextStroke: '.15625cqw #000',
            paintOrder: 'stroke fill'
        });
        this.node.append(this.black, this.base, this.text);
        root.append(this.node);
        this.indicator = new NativeIndicator(now, 200, 5, 20);
        this.tick();
    }
    prepareFonts() {
        return this.raster.ready();
    }
    load() {
        if (!this.loading) this.loading = this.prepare().catch((error)=>{
            this.loading = undefined;
            throw error;
        });
        return this.loading;
    }
    async prepare() {
        const response = await fetch(new URL('native-ui-r24-v2/bgmtitle-sources.json', this.resourceRoot));
        if (!response.ok) throw new Error('原BGM标题UI定义尚未准备');
        const bundle = await response.json();
        if (bundle?.format !== 'senren-ui-source-preparation-v1' || !Array.isArray(bundle.entries)) throw new Error('Invalid native BGM UI source bundle');
        const source = bundle.entries.at(-1);
        if (!source || typeof source.text !== 'string' || source.text.length > 262144) throw new Error('Active native BGM UI definition is missing');
        let base, black, text, baseFile = '', blackFile = '';
        const rect = (cells, index)=>{
            const values = cells.slice(index, index + 4).map(Number);
            if (values.length !== 4 || values.some((value)=>!Number.isFinite(value)) || values[2] < 1 || values[3] < 1) throw new Error('Invalid native BGM UI rectangle');
            return {
                x: values[0],
                y: values[1],
                width: values[2],
                height: values[3]
            };
        };
        for (const { cells } of delimitedRows(source.text)){
            if (!cells[0] || cells[0].startsWith('#')) continue;
            if (cells[0] === 'type') {
                if (cells[1] === 'base') base = rect(cells, 3);
                else if (cells[1] === 'black') black = rect(cells, 3);
                else throw new Error('Unknown native BGM UI part');
            } else if (cells[0] === 'file') {
                if (cells[1] === 'base' && cells[7] === 'text') text = rect(cells, 3);
                else if (cells[1] === 'base' && !cells[7]) baseFile = cells[2].split(';')[0];
                else if (cells[1] === 'black' && !cells[7]) blackFile = cells[2].split(';')[0];
                else if (cells[7] !== 'nosave') throw new Error('Unknown native BGM UI state');
            } else throw new Error('Unimplemented native BGM UI directive: ' + cells[0]);
        }
        if (!base || !black || !text || !baseFile || !blackFile) throw new Error('Incomplete active BGM UI definition');
        this.definition = {
            base,
            black,
            text,
            baseFile,
            blackFile
        };
        const position = (node, rect)=>Object.assign(node.style, {
                left: rect.x / 1920 * 100 + '%',
                top: rect.y / 1080 * 100 + '%',
                width: rect.width / 1920 * 100 + '%',
                height: rect.height / 1080 * 100 + '%'
            });
        position(this.base, base);
        position(this.black, black);
        position(this.text, {
            ...text,
            x: base.x + text.x,
            y: base.y + text.y
        });
        const sources: [HTMLImageElement, string][] = [
            [
                this.base,
                baseFile
            ],
            [
                this.black,
                blackFile
            ]
        ];
        for (const [node, file] of sources) {
            const lease = await this.resources.images.acquire(file);
            try {
                const rect = node === this.base ? base : black;
                if (lease.bitmap.width !== rect.width || lease.bitmap.height !== rect.height) throw new Error('Original BGM image and rectangle dimensions differ');
                const pixels = await ImmutablePixels.copy(lease.bitmap);
                if (node === this.base) {
                    this.basePixels?.close();
                    this.basePixels = pixels;
                } else {
                    this.blackPixels?.close();
                    this.blackPixels = pixels;
                }
                const surface = new OffscreenCanvas(lease.bitmap.width, lease.bitmap.height), drawing = surface.getContext('2d');
                if (!drawing) throw new Error('BGM image preparation surface unavailable');
                drawing.drawImage(lease.bitmap, 0, 0);
                const url = URL.createObjectURL(await surface.convertToBlob());
                this.urls.push(url);
                node.src = url;
            } finally{
                lease.release();
            }
        }
        for (const { cells } of delimitedRows(await originalText(this.resourceRoot, 'soundlist.csv'))){
            let values = cells;
            if (values[0] === '#+') values = values.slice(1);
            if (values[0] && !values[0].startsWith('#') && values[1]?.trim()) this.titles.set(values[0].toLowerCase(), values[1].trim());
        }
    }
    title(storage) {
        return this.titles.get(storage.replaceAll('\\', '/').split('/').at(-1).replace(/[.][^.]+$/u, '').toLowerCase()) ?? '';
    }
    async draw(storage) {
        const title = this.title(storage);
        this.text.textContent = title;
        this.base.hidden = title === '';
        if (!title) {
            this.mainPixels?.close();
            this.mainPixels = undefined;
            this.displayed = storage;
            return;
        }
        const definition = this.definition;
        if (!definition || !this.basePixels) throw new Error('Original BGM pixel assets are unavailable');
        const text = await this.raster.singleLine(title, definition.text.width, definition.text.height, {
            size: 24,
            color: 0xffffff,
            edgeExtent: 3,
            edgeEmphasis: 1536,
            edgeColor: 0,
            align: -1,
            valign: 0
        });
        const baseLease = this.basePixels.pin(), textLease = text.pin();
        try {
            const surface = new OffscreenCanvas(definition.base.width, definition.base.height), drawing = surface.getContext('2d');
            if (!drawing) throw new Error('Original BGM title composition is unavailable');
            drawing.drawImage(baseLease.source, 0, 0);
            drawing.drawImage(textLease.source, definition.text.x, definition.text.y);
            const next = await ImmutablePixels.copy(surface), previous = this.mainPixels;
            this.mainPixels = next;
            previous?.close();
            this.displayed = storage;
        } finally{
            baseLease.release();
            textLease.release();
            text.close();
        }
    }
    validatePixels() {
        if (this.indicator.sample.visible && (!this.definition || !this.blackPixels || this.displayed === null || this.title(this.displayed) !== '' && !this.mainPixels)) throw new Error('Original BGM title publication is missing pixels');
    }
    acquire(page) {
        if (![
            'fore',
            'back'
        ].includes(page)) throw new Error('Unknown BGM UI page');
        this.validatePixels();
        const state = this.indicator.sample, definition = this.definition, leases: NativePixelLease[] = [];
        try {
            for (const [index, target] of [
                'fore',
                'back'
            ].entries()){
                const visible = state.visible && page === target;
                leases.push(pixelPlane(visible ? this.blackPixels : undefined, {
                    root: target === 'fore' ? 'fore.base' : 'back.base',
                    id: 'bgm-black/' + target,
                    left: (definition?.black.x ?? 0) + state.offsetX,
                    top: definition?.black.y ?? 0,
                    scaleX: 1,
                    scaleY: 1,
                    opacity: state.opacity,
                    visible,
                    order: {
                        kind: 'adapter',
                        adapterId: 'bgm-black/' + target,
                        orderzpos: 65,
                        absoluteBase: 0,
                        registrationOrder: index + 2,
                        localOrder: 0
                    }
                }));
            }
            const visible = state.visible && !!this.mainPixels;
            leases.push(pixelPlane(visible ? this.mainPixels : undefined, {
                root: 'uibase',
                id: 'bgm-title',
                left: (definition?.base.x ?? 0) + state.offsetX,
                top: definition?.base.y ?? 0,
                scaleX: 1,
                scaleY: 1,
                opacity: state.opacity,
                visible,
                order: {
                    kind: 'absolute',
                    absolute: 18000000,
                    localOrder: 0
                }
            }));
            return {
                planes: leases.map((lease)=>lease.plane),
                release () {
                    for (const lease of leases)lease.release();
                }
            };
        } catch (error) {
            for (const lease of leases)lease.release();
            throw error;
        }
    }
    async event(_name, event, storage) {
        if (event === 'stop' || event === 'pause') {
            this.playing = null;
            this.indicator.hide();
            this.tick();
            return;
        }
        if (!storage) throw new Error('Native BGM title event has no source');
        if (this.playing === storage) return;
        await this.load();
        await this.draw(storage);
        this.playing = storage;
        this.indicator.move();
        this.indicator.show(true);
        this.tick();
    }
    tick() {
        this.indicator.tick();
        const state = this.indicator.sample;
        this.node.hidden = !state.visible;
        this.node.style.opacity = String(state.opacity);
        this.node.style.transform = 'translateX(' + state.offsetX / 1920 * 100 + 'cqw)';
    }
    quickMenu(visible, time) {
        this.indicator.quickMenuVisible(visible, time);
        this.tick();
    }
    capture() {
        return {
            schemaVersion: 2n,
            playing: this.playing,
            displayed: this.displayed,
            indicator: this.indicator.capture()
        };
    }
    async restore(value) {
        const row = psbRecord(value);
        if (row.schemaVersion !== 2n || row.playing !== null && typeof row.playing !== 'string' || row.displayed !== null && typeof row.displayed !== 'string' || typeof row.displayed === 'string' && row.displayed.length > 4096 || row.playing !== null && row.playing !== row.displayed) throw new Error('Saved BGM state lacks an independent displayed title');
        if (typeof row.displayed === 'string') {
            await this.load();
            await this.draw(row.displayed);
        } else {
            this.text.textContent = '';
            this.base.hidden = true;
            this.displayed = null;
            this.mainPixels?.close();
            this.mainPixels = undefined;
        }
        this.playing = row.playing;
        this.indicator.restore(row.indicator);
        this.tick();
        this.validatePixels();
    }
    close() {
        this.node.remove();
        this.raster.close();
        this.mainPixels?.close();
        this.basePixels?.close();
        this.blackPixels?.close();
        this.mainPixels = this.basePixels = this.blackPixels = undefined;
        for (const url of this.urls)URL.revokeObjectURL(url);
        this.urls = [];
    }
}
