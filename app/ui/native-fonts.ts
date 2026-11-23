let fontSequence = 0;
const shared = new Map();
export class NativeFonts {
    root;
    pending;
    faces: FontFace[] = [];
    records = new Map();
    linked = new Set<number>();
    closed = false;
    family = 'SenrenNativeZh' + ++fontSequence;
    constructor(root){
        this.root = root;
    }
    static acquire(root) {
        const key = root.href;
        let entry = shared.get(key);
        if (!entry) {
            entry = {
                fonts: new NativeFonts(root),
                references: 0
            };
            shared.set(key, entry);
        }
        entry.references++;
        let released = false;
        return {
            fonts: entry.fonts,
            release: ()=>{
                if (!released) {
                    released = true;
                    if (--entry.references === 0) {
                        entry.fonts.close();
                        shared.delete(key);
                    }
                }
            }
        };
    }
    ready() {
        if (this.closed) return Promise.reject(new Error('Native fonts are closed'));
        if (!this.pending) this.pending = this.load();
        return this.pending;
    }
    async load() {
        const base = new URL('native-font-r28-zh/', this.root), response = await fetch(new URL('profile.json', base));
        if (!response.ok) throw new Error('原汉化字体尚未准备');
        const text = await response.text();
        if (text.length > 1048576) throw new Error('Chinese font profile exceeds budget');
        const profile = JSON.parse(text);
        if (profile.schemaVersion !== 1 || profile.format !== 'senren-zh-font-profile-v1' || profile.originalFace !== '微软雅黑' || !Array.isArray(profile.fonts) || profile.fonts.length !== 2) throw new Error('Invalid Chinese patch font profile');
        try {
            for (const row of profile.fonts){
                if (!/^[a-z-]+[.]ttf$/u.test(row.file) || ![
                    400,
                    700
                ].includes(row.weight) || this.records.has(row.weight) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 50331648 || !Number.isSafeInteger(row.embedding) || row.embedding & (2 | 512) || !Number.isSafeInteger(row.unitsPerEm) || row.unitsPerEm < 16 || !Number.isSafeInteger(row.ascent) || row.ascent < 1 || row.ascent > row.unitsPerEm * 4 || !Number.isSafeInteger(row.descent) || row.descent < 0 || row.descent > row.unitsPerEm * 4 || !Array.isArray(row.coverage) || row.coverage.length > 10000) throw new Error('Unsupported or restricted native font face');
                let previous = -1;
                for (const range of row.coverage){
                    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] <= previous || range[0] < 0 || range[1] < range[0] || range[1] > 0x10ffff) throw new Error('Invalid native font coverage');
                    previous = range[1];
                }
                const file = await fetch(new URL(row.file, base));
                if (!file.ok) throw new Error('Missing prepared Chinese font face');
                const bytes = await file.arrayBuffer();
                if (bytes.byteLength !== row.bytes) throw new Error('Chinese font resource length differs from profile');
                if (row.sha256 !== undefined) {
                    if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)) throw new Error('Invalid native font digest');
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
                    if (actual !== row.sha256) throw new Error('Private Chinese font digest differs from profile');
                }
                const face = new FontFace(this.family, bytes, {
                    weight: String(row.weight),
                    style: 'normal'
                });
                await face.load();
                if (this.closed) throw new Error('Native font preparation was closed');
                document.fonts.add(face);
                this.faces.push(face);
                this.records.set(row.weight, row);
            }
            if (profile.linked !== undefined) await this.loadLinked(base, profile.linked);
        } catch (error) {
            this.close();
            throw error;
        }
    }
    private async loadLinked(base: URL, profile: { format: string; codepoint: number; faces: { file: string; bytes: number; sha256: string; embedding: number; weight: number }[] }) {
        if (profile?.format !== 'senren-yahei-linked-symbol-v1' || profile.codepoint !== 0x266a || !Array.isArray(profile.faces) || profile.faces.length !== 2) throw new Error('Invalid original linked font profile');
        const seen = new Set<number>();
        for (const row of profile.faces) {
            if (!row || ![400, 700].includes(row.weight) || seen.has(row.weight) || row.file !== (row.weight === 400 ? 'linked-regular.ttf' : 'linked-bold.ttf') || !/^[a-f0-9]{64}$/u.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 33554432 || !Number.isSafeInteger(row.embedding) || row.embedding & (2 | 512)) throw new Error('Invalid original linked font identity');
            const response = await fetch(new URL(row.file, base));
            if (!response.ok) throw new Error('Original linked font HTTP ' + response.status);
            const bytes = await response.arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', bytes);
            if (bytes.byteLength !== row.bytes || Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== row.sha256) throw new Error('Original linked font digest mismatch');
            const face = new FontFace(this.family, bytes, { weight: String(row.weight), style: 'normal', unicodeRange: 'U+266A' });
            await face.load();
            if (this.closed) throw new Error('Native font preparation was closed');
            document.fonts.add(face); this.faces.push(face); seen.add(row.weight);
        }
        this.linked.add(profile.codepoint);
    }
    assert(text, weight = 400) {
        const font = this.records.get(weight);
        if (!font) throw new Error('Native font is not prepared');
        for (const character of text){
            if ([
                '\r',
                '\n',
                '\t'
            ].includes(character)) continue;
            const point = character.codePointAt(0);
            if (point !== undefined && this.linked.has(point)) continue;
            let low = 0, high = font.coverage.length;
            while(low < high){
                const middle = low + high >>> 1;
                if (font.coverage[middle][1] < point) low = middle + 1;
                else high = middle;
            }
            if (low === font.coverage.length || point < font.coverage[low][0]) throw new Error('Original Chinese font lacks glyph U+' + point.toString(16).toUpperCase());
        }
    }
    baseline(size, weight = 400) {
        const font = this.records.get(weight);
        if (!font) throw new Error('Native font metrics are not prepared');
        return Math.round(size * font.ascent / font.unitsPerEm);
    }
    close() {
        this.closed = true;
        for (const face of this.faces.splice(0))document.fonts.delete(face);
        this.records.clear(); this.linked.clear();
    }
}
