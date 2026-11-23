import { originalText } from '../original-text.ts';
import { psbRecord } from '../../src/formats/psb-value.ts';
export interface NativeAutoPagePolicy { readonly profile: 'kag-auto-clear-normal-v1'; readonly milliseconds: number; readonly cancelOnClick: false }
export async function nativeAutoPagePolicy(root: URL): Promise<NativeAutoPagePolicy> {
    const [config, defaults] = await Promise.all([
        originalText(root, 'config.tjs'),
        originalText(root, 'default.tjs')
    ]);
    const literal = (source, name)=>{
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const pattern = new RegExp('^\\s*;?\\s*' + escaped + '\\s*=\\s*([^;\\r\\n]+);\\s*(?://[^\\r\\n]*)?$', 'gmu');
        const matches = [
            ...source.matchAll(pattern)
        ];
        if (matches.length !== 1) throw new Error('Native auto-page default is ambiguous: ' + name);
        return matches[0][1].trim();
    };
    const number = (source, name)=>{
        const text = literal(source, name);
        if (!/^[0-9]+(?:[.][0-9]+)?$/u.test(text)) throw new Error('Nonliteral native auto-page default: ' + name);
        const value = Number(text);
        if (!Number.isFinite(value)) throw new Error('Invalid native auto-page default');
        return value;
    };
    const maximum = number(config, '_autoSpeedMax'), slow = number(config, 'autoModePageWaits.slow'), speed = number(defaults, 'kag.autospeed');
    const medium = number(config, 'autoModePageWaits.medium');
    if (maximum <= 0 || speed > maximum || number(defaults, 'kag.autoModeWaitVoice') !== 0 || literal(config, 'cancelAutoWhenClick') !== 'false') throw new Error('C3 nondefault voice/click auto-page policy is not yet bound');
    const milliseconds = Math.trunc((maximum - speed) * (slow / maximum));
    if (milliseconds !== medium || milliseconds < 0 || milliseconds > 600000) throw new Error('C3 native auto-page initial/default policy needs explicit configuration support');
    return Object.freeze({
        profile: 'kag-auto-clear-normal-v1',
        milliseconds: Math.max(1, milliseconds),
        cancelOnClick: false
    });
}
export class NativeAutoPageWait {
    now;
    policy;
    kind = 'none';
    due = 0;
    lastAuto = false;
    constructor(now, policy){
        this.now = now;
        this.policy = policy;
    }
    initialize(auto) {
        this.lastAuto = auto;
        this.clear();
    }
    observeMode(auto, atPage) {
        const changed = auto !== this.lastAuto;
        this.lastAuto = auto;
        return changed && atPage;
    }
    enter(normalVoicePlaying) {
        this.clear();
        if (!this.lastAuto) return;
        if (normalVoicePlaying) this.kind = 'voice';
        else {
            this.kind = 'timer';
            this.due = this.now() + this.policy.milliseconds;
        }
    }
    get progress(): number | undefined {
        return this.kind === 'timer' ? 1 - Math.min(1, Math.max(0, this.due-this.now()) / this.policy.milliseconds) : undefined;
    }
    ready(normalVoicePlaying) {
        return this.kind === 'voice' ? !normalVoicePlaying : this.kind === 'timer' && this.now() >= this.due;
    }
    clear() {
        this.kind = 'none';
        this.due = this.now();
    }
    clone(active) {
        const copy = new NativeAutoPageWait(this.now, this.policy);
        copy.lastAuto = this.lastAuto;
        if (active) {
            copy.kind = this.kind;
            copy.due = this.due;
        }
        return copy;
    }
    capture() {
        return {
            schemaVersion: 1n,
            profile: this.policy.profile,
            milliseconds: this.policy.milliseconds,
            lastAuto: this.lastAuto,
            kind: this.kind,
            remaining: this.kind === 'timer' ? Math.max(0, this.due - this.now()) : 0
        };
    }
    restore(value, atPage, active) {
        const r = psbRecord(value);
        if (r.schemaVersion !== 1n || r.profile !== this.policy.profile || r.milliseconds !== this.policy.milliseconds || typeof r.lastAuto !== 'boolean' || typeof r.kind !== 'string' || ![
            'none',
            'timer',
            'voice'
        ].includes(String(r.kind)) || typeof r.remaining !== 'number' || !Number.isFinite(r.remaining) || r.remaining < 0 || r.remaining > this.policy.milliseconds || r.kind !== 'timer' && r.remaining !== 0 || r.kind !== 'none' && (!atPage || !active || !r.lastAuto) || active && atPage && r.lastAuto && r.kind === 'none') throw new Error('Invalid saved native inner-page auto wait');
        this.lastAuto = r.lastAuto;
        this.kind = r.kind;
        this.due = this.now() + r.remaining;
    }
}
