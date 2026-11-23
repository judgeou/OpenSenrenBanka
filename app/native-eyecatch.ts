import type { PsbValue } from '../src/formats/psb-value.ts';
import type { NativeVoices } from './native-voices.ts';

interface EyecatchVoice { readonly name: string; readonly voice: string; readonly type: 0 }
export class NativeEyecatch {
  private phase = { from: 1, to: 1, start: 0, end: 0 };
  private selection: EyecatchVoice | undefined;
  private constructor(private readonly tags: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>, private readonly now: () => number) {}
  static async open(url: URL | undefined, now: () => number): Promise<NativeEyecatch> {
    const tags = new Map<string, Map<string, readonly string[]>>();
    if (url) {
      const response=await fetch(url);
      if (!response.ok) throw new Error('Original eyecatch voice configuration HTTP '+response.status);
      const parsed=await response.json();
      if (parsed?.format!=='native-eyecatch-voices-v1' || !parsed.tags || typeof parsed.tags!=='object' || Array.isArray(parsed.tags)) throw new Error('Invalid original eyecatch voice configuration');
      for (const [name, raw] of Object.entries(parsed.tags)) {
        if (!/^[a-z0-9_]+$/u.test(name) || !raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Invalid original eyecatch voice tag');
        const options=new Map<string,readonly string[]>();
        for (const [speaker, clips] of Object.entries(raw)) {
          if (!speaker || speaker.includes(':') || !Array.isArray(clips) || !clips.length || clips.length>64 || clips.some((value: unknown)=>typeof value!=='string'||!/^[a-z0-9_]+$/u.test(value))) throw new Error('Invalid original eyecatch voice entry');
          options.set(speaker,clips);
        }
        tags.set(name,options);
      }
    }
    return new NativeEyecatch(tags,now);
  }
  preflight(name: PsbValue | undefined, chara: PsbValue | undefined, voices: NativeVoices): readonly (readonly EyecatchVoice[])[] {
    if (typeof name!=='string' || typeof chara!=='string') throw new Error('Invalid original eyecatch voice selector');
    const choices=chara.split(':').map(speaker=>{
      const files=this.tags.get(name)?.get(speaker);
      if (!files) throw new Error('Unresolved original eyecatch voice: '+name+'/'+speaker);
      return files.map(voice=>({name:speaker,voice,type:0 as const}));
    });
    for (const row of choices.flat()) voices.preflight([{...row}]);
    return choices;
  }
  async play(name: PsbValue | undefined, chara: PsbValue | undefined, voices: NativeVoices): Promise<void> {
    // SystemVoice.selectChara chooses a member of the supplied list, then getVoiceFile chooses a format.
    const options=this.preflight(name,chara,voices), formats=options[Math.floor(Math.random()*options.length)];
    const picked=formats[Math.floor(Math.random()*formats.length)];
    await voices.play([{...picked}],false); this.selection=picked;
  }
  fade(show: boolean, skip: boolean): number {
    const now=this.now(), from=this.menu.opacity, to=show?1:0;
    this.phase={from,to,start:now,end:now+(skip||from===to?0:300)};return this.phase.end;
  }
  get menuAnimating(): boolean { return this.now() < this.phase.end; }
  get menu(): {opacity:number; interactive:boolean} {
    const {from,to,start,end}=this.phase, now=this.now();
    return {opacity: now>=end ? to : from+(to-from)*Math.max(0,(now-start)/(end-start)),interactive:to===1 && now>=end};
  }
  get lastVoice(): EyecatchVoice | undefined { return this.selection; }
}
