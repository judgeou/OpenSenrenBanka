import { ImmutablePixels, pixelPlane } from './immutable-pixels.ts';
import { NativeTextRaster } from './native-text-raster.ts';
import type { NativePixelLease, NativeChoiceItem } from './message-types.ts';
function closeStates(states) {
    for (const state of states){
        state.normal.close();
        state.over.close();
        state.on.close();
    }
}
const keyFor = (item)=>JSON.stringify([
        item.text,
        item.render,
        item.visited
    ]);
export class NativeChoiceRaster {
    resources;
    text;
    images;
    loading;
    bank = new Map();
    prepared;
    closed = false;
    constructor(resources, root, systemFontFamily?: string){
        this.resources = resources;
        this.text = new NativeTextRaster(root, systemFontFamily);
    }
    ready() {
        return this.text.ready();
    }
    load() {
        if (this.closed) return Promise.reject(new Error('Original selection rasterizer is closed'));
        if (!this.loading) this.loading = (async ()=>{
            const pixels: ImmutablePixels[] = [];
            let width = 0, height = 0;
            try {
                for (const file of [
                    'select_normal',
                    'select_on'
                ]){
                    const lease = await this.resources.images.acquire(file);
                    try {
                        if (width && (width !== lease.bitmap.width || height !== lease.bitmap.height)) throw new Error('Original selection state dimensions differ');
                        width = lease.bitmap.width;
                        height = lease.bitmap.height;
                        if (width * height > 1048576) throw new Error('Original selection bitmap exceeds budget');
                        const surface = new OffscreenCanvas(width, height), context = surface.getContext('2d', {
                            willReadFrequently: true
                        });
                        if (!context) throw new Error('Original selection bitmap surface is unavailable');
                        context.drawImage(lease.bitmap, 0, 0);
                        pixels.push(await ImmutablePixels.copy(surface));
                    } finally{
                        lease.release();
                    }
                }
                if (this.closed) throw new Error('Original selection bitmap preparation was closed');
                this.images = {
                    normal: pixels[0],
                    on: pixels[1],
                    width,
                    height
                };
            } catch (error) {
                for (const pixel of pixels)pixel.close();
                throw error;
            }
        })();
        return this.loading;
    }
    get size() {
        if (!this.images) throw new Error('Original selection geometry is not prepared');
        return this.images;
    }
    position(offset, count) {
        const { width, height } = this.size;
        return {
            x: 960 - width / 2,
            y: Math.trunc(90 + 600 / 2 + height * (offset - (count - 1) / 2)) - height / 2
        };
    }
    hit(item, x, y, face) {
        const image = this.images, states = this.bank.get(keyFor(item));
        if (!image || !states || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
        return states.alpha[face][y * image.width + x] > 0;
    }
    async prepare(items) {
        if (this.closed) throw new Error('Original selection rasterizer is closed');
        if (this.prepared === items) return;
        for (const item of items)if (item.render && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9 　。、，！？「」『』（）ー—…・“”]+$/u.test(item.text)) throw new Error('C3 original selection TextRender markup/profile is not yet bound');
        await this.load();
        await this.text.ready();
        const image = this.images, bank = new Map();
        if (items.length * image.width * image.height * 12 > 33554432) throw new Error('Original selection pixel states exceed budget');
        try {
            for (const item of items){
                const key = keyFor(item);
                if (bank.has(key)) continue;
                const pixels: ImmutablePixels[] = [], alpha: Partial<Record<'normal' | 'over' | 'on', Uint8Array>> = {};
                try {
                    for (const face of [
                        'normal',
                        'over',
                        'on'
                    ]){
                        const color = face === 'over' ? 0xff8880 : face === 'on' ? 0xffffff : item.visited ? 0xefdfff : 0xffffff;
                        const edge = 0xb75e74 >> 2 & 0x3f3f3f;
                        const label = await this.text.singleLine(item.text, image.width, image.height, {
                            size: 39,
                            weight: 400,
                            align: 0,
                            valign: 0,
                            color,
                            edgeExtent: 1,
                            edgeEmphasis: 1024,
                            edgeColor: edge,
                            shadowWidth: 1,
                            shadowLevel: 255,
                            shadowX: 2,
                            shadowY: 2,
                            shadowColor: edge
                        });
                        const base = face === 'on' ? image.on : image.normal, baseLease = base.pin(), textLease = label.pin();
                        try {
                            const surface = new OffscreenCanvas(image.width, image.height), drawing = surface.getContext('2d', {
                                willReadFrequently: true
                            });
                            if (!drawing) throw new Error('Original selection composition is unavailable');
                            drawing.drawImage(baseLease.source, 0, 0);
                            drawing.drawImage(textLease.source, 0, -9);
                            pixels.push(await ImmutablePixels.copy(surface));
                            const rgba = drawing.getImageData(0, 0, image.width, image.height).data, mask = new Uint8Array(image.width * image.height);
                            for(let at = 0; at < mask.length; at++)mask[at] = rgba[at * 4 + 3];
                            alpha[face] = mask;
                        } finally{
                            baseLease.release();
                            textLease.release();
                            label.close();
                        }
                    }
                    bank.set(key, {
                        normal: pixels[0],
                        over: pixels[1],
                        on: pixels[2],
                        alpha
                    });
                } catch (error) {
                    for (const pixel of pixels)pixel.close();
                    throw error;
                }
            }
            if (this.closed) throw new Error('Original selection pixel preparation was closed');
            const previous = this.bank;
            this.bank = bank;
            this.prepared = items;
            closeStates(previous.values());
        } catch (error) {
            closeStates(bank.values());
            throw error;
        }
    }
    validate(items) {
        if (this.closed || this.prepared !== items || !this.images) throw new Error('Original selection pixel publication is not prepared');
    }
    acquire(page, items, opacity, face) {
        this.validate(items);
        const leases: NativePixelLease[] = [];
        try {
            for (const [offset, item] of items.entries()){
                const position = this.position(offset, items.length), pixels = this.bank.get(keyFor(item))[face(offset)], visible = opacity > 0;
                leases.push(pixelPlane(visible ? pixels : undefined, {
                    root: page === 'fore' ? 'fore.base' : 'back.base',
                    id: 'choice/' + offset,
                    left: position.x,
                    top: position.y,
                    scaleX: 1,
                    scaleY: 1,
                    opacity,
                    visible,
                    clipRectangle: [
                        0,
                        0,
                        1920,
                        1080
                    ],
                    order: {
                        kind: 'absolute',
                        absolute: 1000000 + 4 + offset,
                        localOrder: 0
                    }
                }));
            }
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
    clear() {
        const previous = this.bank;
        this.bank = new Map();
        this.prepared = undefined;
        closeStates(previous.values());
    }
    close() {
        if (!this.closed) {
            this.closed = true;
            this.clear();
            this.images?.normal.close();
            this.images?.on.close();
            this.images = undefined;
            this.text.close();
        }
    }
}
