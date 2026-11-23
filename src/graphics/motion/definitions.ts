import { DataSymbol, parseTjsData } from '../../formats/tjs-data.ts';
import type { DataValue } from '../../formats/tjs-data.ts';
import type { NativeImageRequest } from '../image-request.ts';

interface Binding { readonly storage: string; readonly chara: string; readonly motion: string }
/** The original envinit motions dictionary, not an invented sd-name convention.
 * Only literal MTN descriptors are usable. Function/noise/movie entries remain
 * registered as explicit unsupported aliases; no TJS function is evaluated.
 */
export class MotionDefinitions {
  private readonly entries = new Map<string, Binding | string>();
  private readonly pictures=new Map<string,readonly string[]>();
  constructor(source?: string) {
    if (source === undefined) return;
    if (source.length > 4 * 1024 * 1024) throw new Error('Original motion definitions exceed input budget');
    const headers = [...source.matchAll(/^([ \t]*)["']motions["'][ \t]*(?:=>|:|,)[ \t]*%\[/gmu)];
    if (headers.length !== 1) throw new Error('Original envinit motions section is absent/ambiguous');
    const start = headers[0].index! + headers[0][0].length - 1, end = blockEnd(source, start);
    const body = source.slice(start + 1, end - 1);
    const first = /^([ \t]+)["'][^\r\n]+["'][ \t]*(?:=>|:|,)/mu.exec(body);
    if (!first) throw new Error('Original motions dictionary has no entries');
    const rows = /^([ \t]+)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')[ \t]*(?:=>|:|,)[ \t]*/gmu;
    for (const row of body.matchAll(rows)) {
      if (row[1] !== first[1]) continue;
      const name = parseTjsData(row[2]); if (typeof name !== 'string' || !name) throw new Error('Invalid original motion alias');
      const key = name.toLowerCase(); if (this.entries.has(key)) throw new Error('Duplicate original motion alias: ' + name);
      const at = row.index! + row[0].length;
      if (!body.startsWith('%[', at)) {
        const authored=/^アイキャッチ[^\r\n]+rand$/u.test(name)&&/^function\s*\(\s*\)\s*\{\s*(?:\/\/[^\r\n]*\s*)?var\s+files\s*=\s*(\[[^\]]+\]);\s*return\s*%\[storage:files\[intrandom\(files\.count-1\)\]\];\s*\}/u.exec(body.slice(at,at+850));
        if(authored){const choices=parseTjsData(authored[1]);if(Array.isArray(choices)&&choices.length>=2&&choices.length<=8&&choices.every(s=>typeof s==='string'&&s.startsWith('アイキャッチ'))){this.pictures.set(key,choices as string[]);continue;}}
        this.entries.set(key, 'nonliteral motion definition'); continue;
      }
      const value = parseTjsData(body.slice(at, blockEnd(body, at + 1)));
      const descriptor = record(value);
      if (typeof descriptor.storage !== 'string' || !/[.]mtn$/iu.test(descriptor.storage)) { this.entries.set(key, 'non-MTN motion definition'); continue; }
      const names = Object.keys(descriptor);
      // The original BB2/BD2 variants supply an alternate only for the disabled-animation branch; this host runs MTN enabled.
      const authoredAlt=/^sd[0-9]{3}[a-z]{2}[23]$/u.test(key)&&typeof descriptor.altStorage==='string'&&descriptor.altStorage.toLowerCase()===key.slice(0,-1)&&typeof descriptor.motion==='string'&&descriptor.motion.toLowerCase()===key;
      if (names.some(name => !['storage', 'chara', 'motion', 'noseparate'].includes(name)&&!(name==='altStorage'&&authoredAlt)) || descriptor.noseparate !== true || typeof descriptor.chara !== 'string' || typeof descriptor.motion !== 'string') {
        this.entries.set(key, 'unsupported original motion descriptor'); continue;
      }
      this.entries.set(key, { storage: descriptor.storage, chara: descriptor.chara, motion: descriptor.motion });
    }
  }
  pictureAlternatives(storage:string):readonly string[]{return this.pictures.get(storage.toLowerCase())??[];}
  has(storage: string): boolean { return this.entries.has(storage.toLowerCase()); }
  resolve(request: NativeImageRequest): NativeImageRequest {
    const binding = this.entries.get(request.file.toLowerCase()); if (!binding) return request;
    if (typeof binding === 'string') throw new Error('Unsupported original motion alias ' + request.file + ': ' + binding);
    if (request.options.chara !== undefined && request.options.chara !== binding.chara || request.options.motion !== undefined && request.options.motion !== binding.motion) throw new Error('MTN alias/object override precedence is not implemented: ' + request.file);
    return { ...request, file: binding.storage, options: { ...request.options, chara: binding.chara, motion: binding.motion } };
  }
}
function record(value: DataValue): { [key: string]: DataValue } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof DataSymbol) throw new Error('Original motion descriptor is not a literal dictionary');
  return value;
}
/** Locate a bracketed literal without interpreting functions nested in the table. */
function blockEnd(source: string, start: number): number {
  if (source[start] !== '[') throw new Error('Expected motion dictionary bracket');
  let depth = 0;
  for (let at = start; at < source.length; at++) {
    const char = source[at];
    if (char === '"' || char === "'") {
      const quote = char; let closed = false;
      for (at++; at < source.length; at++) { if (source[at] === '\\') at++; else if (source[at] === quote) { closed = true; break; } }
      if (!closed) throw new Error('Unterminated original motion string');
    } else if (source.startsWith('//', at)) { const next = source.indexOf('\n', at + 2); at = next < 0 ? source.length : next; }
    else if (source.startsWith('/*', at)) { const next = source.indexOf('*/', at + 2); if (next < 0) throw new Error('Unterminated original motion comment'); at = next + 1; }
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return at + 1;
  }
  throw new Error('Unterminated original motions dictionary');
}
