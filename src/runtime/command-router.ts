import type { RuntimeCommand } from '../scenario/invocation.ts';
import type { PlaybackMode } from './playback-gate.ts';
import type { CommandBlock } from './types.ts';
export type CommandHandler = (command: RuntimeCommand, mode: Readonly<PlaybackMode>) => Promise<CommandBlock | undefined>;
/** No generic success fallback: every original tag needs an explicit implementation. */
export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();
  private deferred: CommandHandler | undefined;
  register(name: string, handler: CommandHandler): void {
    if (!name || this.handlers.has(name)) throw new Error('Invalid/duplicate scene command: ' + name); this.handlers.set(name, handler);
  }
  registerDeferred(handler: CommandHandler): void { if (this.deferred) throw new Error('Duplicate deferred-command dispatcher'); this.deferred = handler; }
  async dispatch(command: RuntimeCommand, mode: Readonly<PlaybackMode>): Promise<CommandBlock | undefined> {
    const handler = command.deferred ? this.deferred : this.handlers.get(command.name);
    if (!handler) throw new Error('Unimplemented ' + (command.deferred ? 'deferred ' : '') + 'command ' + command.name + ' at ' + command.location.asset + ':' + command.location.scene + ':' + command.location.event);
    return handler(command, mode);
  }
  get names(): readonly string[] { return [...this.handlers.keys()]; }
}
