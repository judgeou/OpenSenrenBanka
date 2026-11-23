import type { AudioEvent } from '../audio/web-audio-engine.ts';
import type { WorldCommands } from './commands.ts';
import type { CommandBlock } from '../runtime/types.ts';
/** Native voice labels trigger both their original name and the one-based vl ordinal. */
export class VoiceSignals {
  private readonly commands: WorldCommands; private readonly voices = new Map<string, string>();
  constructor(commands: WorldCommands) { this.commands = commands; }
  async start(channel: string, token: string): Promise<readonly CommandBlock[]> {
    if (!channel || !token) throw new Error('Invalid voice subscription');
    const blocks: CommandBlock[] = []; if (this.voices.has(channel)) blocks.push(...await this.commands.signal('vlstop'));
    this.voices.set(channel, token); blocks.push(...await this.commands.signal('vlstart')); return blocks;
  }
  async consume(events: readonly AudioEvent[]): Promise<readonly CommandBlock[]> {
    const blocks: CommandBlock[] = [];
    for (const event of events) {
      if (this.voices.get(event.channel) !== event.token) continue;
      if (event.kind === 'label') { blocks.push(...await this.commands.signal(event.name)); blocks.push(...await this.commands.signal('vl' + event.ordinal)); }
      else { this.voices.delete(event.channel); blocks.push(...await this.commands.signal('vlstop')); }
    }
    return blocks;
  }
  capture(): readonly { readonly channel: string; readonly token: string }[] { return [...this.voices].map(([channel, token]) => ({ channel, token })); }
  restore(voices: readonly { readonly channel: string; readonly token: string }[]): void {
    if (voices.some(value => typeof value.channel !== 'string' || !value.channel || typeof value.token !== 'string' || !value.token)) throw new Error('Invalid voice signal state');
    this.voices.clear(); for (const voice of voices) this.voices.set(voice.channel, voice.token);
  }
}
