import { originalText } from './original-text.ts';
import type { PlaybackMode } from '../src/runtime/playback-gate.ts';
export interface SessionSettings {
  readonly playback: Readonly<PlaybackMode>; readonly windowOpacity: number;
  readonly voiceCut: boolean; readonly voiceCutPage: boolean; readonly noSeWhenSkip: boolean;
  readonly autoVoiceDelay: number; readonly autoNextVoiceDelay: number;
  readonly volumes: Readonly<Record<string, number>>;
}
function keyPattern(key: string): string { return key.split('.').join('[.]'); }
function assignment(source: string, key: string, optional = false): string | undefined {
  const expression = new RegExp('^\\s*;?\\s*' + keyPattern(key) + '\\s*=\\s*([^;\\r\\n]+);', 'gmu');
  const matches = [...source.matchAll(expression)];
  if (matches.length === 0 && optional) return undefined;
  if (matches.length !== 1) throw new Error('Original default assignment is ambiguous/missing: ' + key);
  return matches[0][1].trim();
}
function numeric(source: string, key: string, fallback?: number): number {
  const text = assignment(source, key, fallback !== undefined); if (text === undefined && fallback !== undefined) return fallback;
  if (text === undefined || !/^[0-9]+(?:[.][0-9]+)?$/u.test(text)) throw new Error('Unsupported original numeric default: ' + key);
  const value = Number(text); if (!Number.isFinite(value)) throw new Error('Nonfinite original default: ' + key); return value;
}
function boolean(source: string, key: string): boolean {
  const value = assignment(source, key); if (value === 'true') return true; if (value === 'false') return false;
  throw new Error('Unsupported original boolean default: ' + key);
}
/** Parses actual active Config/default literals, not executable TJS. Config's leading ; is an empty statement. */
export async function sessionSettings(root: URL): Promise<SessionSettings> {
  const [config, defaults] = await Promise.all([originalText(root, 'config.tjs'), originalText(root, 'default.tjs')]);
  const textMax = numeric(config, '_textSpeedMax'), autoMax = numeric(config, '_autoSpeedMax');
  const textSpeed = numeric(defaults, 'kag.textspeed'), autoSpeed = numeric(defaults, 'kag.autospeed');
  if (textMax <= 0 || autoMax <= 0 || textSpeed > textMax || autoSpeed > autoMax) throw new Error('Invalid original speed domain');
  const characterDelay = (textMax - textSpeed) * numeric(config, 'chSpeeds.slow') / textMax;
  const autoDelay = Math.trunc((autoMax - autoSpeed) * numeric(config, 'autoModePageWaits.slow') / autoMax);
  if (numeric(defaults, 'kag.autoModeWaitVoice') !== 0) throw new Error('Only original normal auto voice policy is bound');
  const rawOpacity = assignment(defaults, 'sf.windowOpac');
  const opacity = rawOpacity && /^\(int\)\(\s*([0-9]+)\s*[*]\s*256\s*[/]\s*100\s*\)$/u.exec(rawOpacity);
  if (!opacity || Number(opacity[1]) > 100) throw new Error('Unsupported original window opacity default');
  const master = numeric(defaults, 'kag.wavevolume') / 100;
  const gain = (key: string) => { const value = numeric(defaults, 'kag.' + key); if (value > 100) throw new Error('Invalid original volume'); return master * value / 100; };
  if (master > 1) throw new Error('Invalid original master volume');
  const bgm = gain('bgmvolume');
  return Object.freeze({ playback: Object.freeze({ skip: 'none', auto: false, characterDelay, autoDelay }),
    windowOpacity: Math.min(255, Math.trunc(Number(opacity[1]) * 256 / 100)) / 255,
    voiceCut: boolean(defaults, 'kag.voicecut'), voiceCutPage: boolean(defaults, 'kag.voicecutpage'), noSeWhenSkip: boolean(defaults, 'kag.nosewhenskip'),
    // Unassigned Config fields retain the two zero constants of the original KAG window.
    autoVoiceDelay: numeric(config, 'autoModeVoiceWait', 0), autoNextVoiceDelay: numeric(config, 'autoModeNextVoiceWait', 0),
    volumes: Object.freeze({ wave: master, bgm, downbgm: bgm, se: gain('sevolume'), sysse: gain('syssevolume'), voice: gain('voicevolume'), bgv: gain('bgvvolume'), bgv2: gain('bgv2volume'), movieaudio: gain('movieAudioVolume') }) });
}
