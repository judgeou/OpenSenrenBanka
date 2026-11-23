import { pimgLayout } from '../../src/graphics/pimg-layout.ts';
import { PimgPaths } from '../../src/graphics/pimg-paths.ts';
import { psbRecord } from '../../src/formats/psb-value.ts';
import { NativeIndicator } from './native-indicator.ts';
import { ImmutablePixels, pixelPlane } from './immutable-pixels.ts';
import type { NativeUiPage } from '../../src/graphics/native-ui-planes.ts';
export function chapterPixelLease(page: NativeUiPage, pixels: ImmutablePixels | undefined = undefined, opacity = 0) {
    const leases = [
        'fore',
        'back'
    ].map((target, index)=>pixelPlane(page === target ? pixels : undefined, {
            root: target === 'fore' ? 'fore.base' : 'back.base',
            id: 'chapter/' + target,
            left: 0,
            top: 0,
            scaleX: 1,
            scaleY: 1,
            opacity,
            visible: page === target && opacity > 0,
            order: {
                kind: 'adapter',
                adapterId: 'chapter/' + target,
                orderzpos: 64,
                absoluteBase: 0,
                registrationOrder: index,
                localOrder: 0
            }
        }));
    return {
        planes: leases.map((lease)=>lease.plane),
        release () {
            for (const lease of leases)lease.release();
        }
    };
}
export class NativeChapter {
    source;
    layout;
    paths;
    date = '';
    canvas = new OffscreenCanvas(1, 1);
    pixels;
    leases = new Map();
    indicator;
    constructor(source, layout, paths, _root, now){
        this.source = source;
        this.layout = layout;
        this.paths = paths;
        this.canvas.width = layout.width;
        this.canvas.height = layout.height;
        this.indicator = new NativeIndicator(now, 500, 0);
        this.tick();
    }
    static async open(resources, root, now) {
        const source = await resources.pimg.load('chapter'), layout = pimgLayout(source.reader);
        return new NativeChapter(source, layout, new PimgPaths(layout), root, now);
    }
    layer(name) {
        return this.layout.byId.get(this.paths.resolve(name));
    }
    async image(layer) {
        if (!layer.imageName || ![
            2,
            13
        ].includes(layer.drawType) || layer.opacity !== 255) throw new Error('Unsupported original chapter raster: ' + layer.name);
        let lease = this.leases.get(layer.imageName);
        if (!lease) {
            lease = await this.source.acquireImage(layer.imageName);
            this.leases.set(layer.imageName, lease);
        }
        return lease.bitmap;
    }
    async draw(date) {
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('Original chapter drawing surface is unavailable');
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (!date) {
            this.pixels?.close();
            this.pixels = undefined;
            return;
        }
        const background = this.layer('@ base');
        context.drawImage(await this.image(background), background.left, background.top);
        if (date === 'after') {
            const layer = this.layer('after');
            context.drawImage(await this.image(layer), layer.left, layer.top);
        } else if (date !== 'prologue') {
            if (!/^[0-9]+-[0-9]+$/u.test(date) || date.length > 4) throw new Error('Unsupported native chapter tag: ' + date);
            const chapter = this.layer('chapter');
            context.drawImage(await this.image(chapter), chapter.left, chapter.top);
            const original = this.layer('数字/num:rect_lay');
            for(let index = 0; index < date.length; index++){
                const slot = this.layer('#数字配置/' + String(index).padStart(2, '0')), glyph = this.layer('数字/num:' + date[index]);
                context.drawImage(await this.image(glyph), slot.left + glyph.left - original.left, slot.top + glyph.top - original.top);
            }
        }
        const next = await ImmutablePixels.copy(this.canvas), previous = this.pixels;
        this.pixels = next;
        previous?.close();
    }
    async command(parameters, order, skip) {
        let date = this.date, visible;
        for (const name of order){
            if (name === 'show') visible = true;
            else if (name === 'hide') visible = false;
            else if (name === 'visible') {
                const value = parameters[name];
                if (value !== 0 && value !== 1 && value !== 0n && value !== 1n && value !== false && value !== true && value !== '0' && value !== '1' && value !== 'false' && value !== 'true') throw new Error('Invalid native chapter visibility');
                visible = value === 1 || value === 1n || value === true || value === '1' || value === 'true';
            } else if (name === 'clear') date = '';
            else if (name === 'backoff') { throw new Error('C3 original chapter backoff lifecycle is not yet bound'); } else {
                if (!/^(?:[0-9]+-[0-9]+|after|prologue)$/u.test(name)) throw new Error('Unknown chapter field: ' + name);
                date = name;
                if (visible === undefined) visible = true;
            }
        }
        if (date !== this.date) {
            await this.draw(date);
            this.date = date;
        }
        if (!date) this.indicator.hide(true);
        else if (visible === true) this.indicator.show(false, skip ? 0 : 500);
        else if (visible === false) this.indicator.hide(skip);
        this.tick();
    }
    tick() {
        this.indicator.tick();
    }
    acquire(page) {
        return chapterPixelLease(page, this.pixels, this.indicator.sample.opacity);
    }
    quickMenu(visible, time) {
        this.indicator.quickMenuVisible(visible, time);
        this.tick();
    }
    capture() {
        return {
            schemaVersion: 1n,
            date: this.date,
            indicator: this.indicator.capture()
        };
    }
    async restore(value) {
        const row = psbRecord(value);
        if (row.schemaVersion !== 1n || typeof row.date !== 'string') throw new Error('Invalid native chapter state');
        await this.draw(row.date);
        this.date = row.date;
        this.indicator.restore(row.indicator);
        this.tick();
    }
    close() {
        this.pixels?.close();
        this.pixels = undefined;
        for (const lease of this.leases.values())lease.release();
        this.leases.clear();
    }
}
