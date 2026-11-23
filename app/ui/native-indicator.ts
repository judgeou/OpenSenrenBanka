import { psbRecord } from '../../src/formats/psb-value.ts';
import { nativeEase } from '../../src/world/property-actions.ts';
export class NativeIndicator {
    now;
    defaultFade;
    moveLeft;
    showing = false;
    quickMenu = true;
    autoHide;
    from = 0;
    target = 0;
    began = 0;
    fade = 0;
    moveBegan = 0;
    moving = false;
    constructor(now, defaultFade, autoHide, moveLeft = 0){
        this.now = now;
        this.defaultFade = defaultFade;
        this.moveLeft = moveLeft;
        this.autoHide = autoHide;
    }
    get sample() {
        const elapsed = Math.max(0, this.now() - this.began);
        let opacity = this.fade ? this.from + (this.target - this.from) * Math.min(1, elapsed / this.fade) : this.target;
        if (this.target === 1 && this.autoHide > 0 && elapsed > this.fade + this.autoHide * 1000) {
            opacity = this.fade ? Math.max(0, 1 - (elapsed - this.fade - this.autoHide * 1000) / this.fade) : 0;
        }
        const move = this.moving ? nativeEase(-1, this.defaultFade ? (this.now() - this.moveBegan) / this.defaultFade : 1) : 1;
        return {
            opacity,
            offsetX: -this.moveLeft * (1 - move),
            visible: opacity > 0
        };
    }
    get nextChange(): number {
        const now = this.now();
        if (this.moving && now < this.moveBegan + this.defaultFade || now < this.began + this.fade) return now;
        if (this.target !== 1 || this.autoHide <= 0) return Infinity;
        return Math.max(now, this.began + this.fade + this.autoHide * 1000);
    }
    tick() {
        const elapsed = Math.max(0, this.now() - this.began);
        if (this.target === 1 && this.autoHide > 0 && elapsed >= this.fade * 2 + this.autoHide * 1000) {
            this.showing = false;
            this.target = this.from = 0;
            this.fade = 0;
            this.began = this.now();
        }
    }
    show(reset = false, time = this.defaultFade) {
        this.showing = true;
        this.update(time, reset);
    }
    hide(immediate = false) {
        this.showing = false;
        this.update(immediate ? 0 : this.defaultFade);
    }
    move() {
        this.moving = this.moveLeft !== 0;
        this.moveBegan = this.now();
    }
    quickMenuVisible(visible, time = this.defaultFade) {
        this.quickMenu = visible;
        this.update(time);
    }
    setAutoHide(seconds) {
        if (!Number.isFinite(seconds) || seconds < -1 || seconds > 3600) throw new Error('Invalid native indicator auto-hide');
        this.autoHide = seconds;
        this.update(this.defaultFade, true);
    }
    update(time, reset = false) {
        if (!Number.isFinite(time) || time < 0 || time > 600000) throw new Error('Invalid native indicator fade');
        const before = reset ? 0 : this.sample.opacity, target = this.showing && this.quickMenu && this.autoHide >= 0 ? 1 : 0;
        if (!reset && target === this.target && (target === 0 || this.autoHide <= 0)) return;
        this.from = before;
        this.target = target;
        this.fade = this.autoHide < 0 ? 0 : time;
        this.began = this.now();
    }
    capture() {
        void this.sample;
        return {
            schemaVersion: 1n,
            showing: this.showing,
            quickMenu: this.quickMenu,
            autoHide: this.autoHide,
            from: this.from,
            target: this.target,
            age: Math.max(0, this.now() - this.began),
            fade: this.fade,
            moveAge: Math.max(0, this.now() - this.moveBegan),
            moving: this.moving
        };
    }
    restore(value) {
        const row = psbRecord(value);
        const number = (key, min, max)=>{
            const value = row[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid saved indicator ' + key);
            return value;
        };
        if (row.schemaVersion !== 1n || typeof row.showing !== 'boolean' || typeof row.quickMenu !== 'boolean' || typeof row.moving !== 'boolean') throw new Error('Invalid saved native indicator');
        this.showing = row.showing;
        this.quickMenu = row.quickMenu;
        this.moving = row.moving;
        this.autoHide = number('autoHide', -1, 3600);
        this.from = number('from', 0, 1);
        this.target = number('target', 0, 1);
        this.fade = number('fade', 0, 600000);
        this.began = this.now() - number('age', 0, Number.MAX_SAFE_INTEGER);
        this.moveBegan = this.now() - number('moveAge', 0, Number.MAX_SAFE_INTEGER);
    }
}
