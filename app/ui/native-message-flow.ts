import { psbRecord } from '../../src/formats/psb-value.ts';
import { NativeAutoPageWait } from './native-auto-page.ts';
export class NativeMessageFlow {
    now;
    sourceLength;
    finalSize;
    autoPolicy;
    plan;
    cursor = 0;
    page = 0;
    units = 0;
    sourceOffset = 0;
    fontSize = 39;
    active = true;
    phase = 'typing';
    delay = 0;
    due = 0;
    autoPage;
    constructor(now, sourceLength, finalSize, autoPolicy){
        this.now = now;
        this.sourceLength = sourceLength;
        this.finalSize = finalSize;
        this.autoPolicy = autoPolicy;
        this.autoPage = new NativeAutoPageWait(now, autoPolicy);
    }
    bind(plan) {
        this.plan = plan;
        this.validate();
    }
    start(plan, mode, noWait) {
        if (mode.skip === 'none' && plan.pageCount > 1 && noWait) throw new Error('C3 no-dialogue-gate automatic-page continuation is not yet bound');
        this.plan = plan;
        this.delay = mode.characterDelay;
        this.due = this.now();
        this.autoPage.initialize(mode.auto);
        if (noWait || mode.skip !== 'none') this.finish();
    }
    get done() {
        return this.phase === 'done';
    }
    get waitingPage() {
        return this.phase === 'page';
    }
    get full() {
        return this.cursor === this.plan.steps.length;
    }
    consume() {
        const step = this.plan.steps[this.cursor++];
        this.units = step.units;
        this.sourceOffset = step.sourceEnd;
        this.fontSize = step.size;
        if (step.character) this.due += this.delay;
    }
    timedProgress(normalVoicePlaying) {
        while(!this.done && !this.waitingPage && this.now() >= this.due){
            if (this.full) {
                this.finish();
                return;
            }
            if (this.plan.steps[this.cursor].page !== this.page) {
                this.phase = 'page';
                this.autoPage.enter(normalVoicePlaying);
                return;
            }
            this.consume();
        }
    }
    continuePage() {
        this.page = this.plan.steps[this.cursor].page;
        this.phase = 'typing';
        this.due = this.now();
        this.autoPage.clear();
    }
    get nextChange(): number {
        if (!this.active || this.done) return Infinity;
        if (!this.waitingPage) return this.due;
        return this.autoPage.kind === 'timer' ? this.autoPage.due : Infinity;
    }
    advance(mode, normalVoicePlaying) {
        if (!this.active) return;
        if (!this.plan) throw new Error('Native message flow has no prepared plan');
        if (mode.skip !== 'none') {
            this.autoPage.observeMode(mode.auto, false);
            this.finish();
            return;
        }
        const continueByMode = this.autoPage.observeMode(mode.auto, this.waitingPage);
        if (this.waitingPage && (continueByMode || this.autoPage.ready(normalVoicePlaying))) this.continuePage();
        this.timedProgress(normalVoicePlaying);
    }
    input(mode, normalVoicePlaying) {
        if (!this.plan || !this.active) throw new Error('Native dialogue input does not own an active writer');
        this.autoPage.observeMode(mode.auto, false);
        if (this.waitingPage) {
            this.continuePage();
            this.timedProgress(normalVoicePlaying);
        } else {
            while(!this.full && this.plan.steps[this.cursor].page === this.page)this.consume();
            this.due = this.now();
            if (this.full) this.finish();
            else {
                this.phase = 'page';
                this.autoPage.enter(normalVoicePlaying);
            }
        }
        return this.done;
    }
    preflightFinish() {
        if (!this.plan) throw new Error('Native message completion needs its prepared plan');
        this.validate();
    }
    finish() {
        this.preflightFinish();
        const plan = this.plan, executedSize = plan.steps[plan.steps.length - 1]?.size ?? 39;
        if (this.finalSize !== executedSize) throw new Error('Native message final font is not backed by a flushed step');
        this.cursor = plan.steps.length;
        this.page = plan.pageCount - 1;
        this.units = plan.units;
        this.sourceOffset = this.sourceLength;
        this.fontSize = executedSize;
        this.phase = 'done';
        this.due = this.now();
        this.autoPage.clear();
    }
    clone(active = this.active) {
        const copy = new NativeMessageFlow(this.now, this.sourceLength, this.finalSize, this.autoPolicy);
        copy.plan = this.plan;
        copy.cursor = this.cursor;
        copy.page = this.page;
        copy.units = this.units;
        copy.sourceOffset = this.sourceOffset;
        copy.fontSize = this.fontSize;
        copy.active = active;
        copy.phase = this.phase;
        copy.delay = this.delay;
        copy.due = this.due;
        copy.autoPage = this.autoPage.clone(active);
        return copy;
    }
    capture() {
        return {
            schemaVersion: 2n,
            cursor: this.cursor,
            page: this.page,
            units: this.units,
            sourceOffset: this.sourceOffset,
            fontSize: this.fontSize,
            active: this.active,
            phase: this.phase,
            delay: this.delay,
            remaining: this.phase === 'typing' ? Math.max(0, Math.min(this.delay, this.due - this.now())) : 0,
            autoPage: this.autoPage.capture()
        };
    }
    restore(value) {
        const r = psbRecord(value);
        for (const key of [
            'cursor',
            'page',
            'units',
            'sourceOffset',
            'fontSize'
        ])if (typeof r[key] !== 'number' || !Number.isSafeInteger(r[key]) || r[key] < 0) throw new Error('Invalid saved message cursor: ' + key);
        if (r.schemaVersion !== 2n || typeof r.active !== 'boolean' || typeof r.phase !== 'string' || ![
            'typing',
            'page',
            'done'
        ].includes(String(r.phase)) || typeof r.delay !== 'number' || !Number.isFinite(r.delay) || r.delay < 0 || r.delay > 60000 || typeof r.remaining !== 'number' || !Number.isFinite(r.remaining) || r.remaining < 0 || r.remaining > r.delay || r.phase !== 'typing' && r.remaining !== 0) throw new Error('Invalid saved message flow clock/phase');
        const cursor = (name: string): number => { const value = r[name]; if (typeof value !== 'number') throw new Error('Invalid message cursor'); return value; };
        this.cursor = cursor('cursor');
        this.page = cursor('page');
        this.units = cursor('units');
        this.sourceOffset = cursor('sourceOffset');
        this.fontSize = cursor('fontSize');
        this.active = r.active;
        this.phase = r.phase;
        this.delay = r.delay;
        this.due = this.now() + r.remaining;
        this.autoPage.restore(r.autoPage, this.waitingPage, this.active);
        if (this.plan) this.validate();
    }
    validate() {
        const plan = this.plan;
        if (this.finalSize !== (plan.steps[plan.steps.length - 1]?.size ?? 39)) throw new Error('Saved message final font lacks a flushed step');
        if (this.cursor > plan.steps.length || this.page >= plan.pageCount || this.sourceOffset > this.sourceLength || this.fontSize < 1 || this.fontSize > 256 || this.done && !this.full || this.waitingPage && (this.full || plan.steps[this.cursor].page === this.page)) throw new Error('Saved message flow does not match original program');
        const previous = this.cursor ? plan.steps[this.cursor - 1] : undefined;
        const offset = this.done ? this.sourceLength : previous?.sourceEnd ?? 0, size = this.done ? this.finalSize : previous?.size ?? 39;
        if (this.units !== (previous?.units ?? 0) || this.sourceOffset !== offset || this.fontSize !== size || this.page !== (previous?.page ?? 0)) throw new Error('Saved message program consumption/active style differs from its source');
    }
}
