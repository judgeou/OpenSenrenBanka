import { DeferredCommands } from '../runtime/deferred-commands.ts';
import type { CommandRouter, CommandHandler } from '../runtime/command-router.ts';
import type { RuntimeCommand } from '../scenario/invocation.ts';
import type { PlaybackMode } from '../runtime/playback-gate.ts';
import type { CommandBlock } from '../runtime/types.ts';
import type { EntityWorld } from './entity-world.ts';
import { worldPlan } from './plan.ts';
export const serviceCommandNames = ['meswinload', 'scnchart', 'chapter', 'wait', 'quickmenu', 'beginskip', 'sysvoice', 'endskip', 'endrecollection', 'cancelskip', 'sysmovie', 'meswinchange', 'msgoff', 'playvoice', 'stopvoice', 'exit', 'noeffect'] as const;
export type NativeCommandServices = Readonly<Record<typeof serviceCommandNames[number], CommandHandler>>;
/** Installs every observed target. Required services cannot silently resolve as no-ops. */
export class WorldCommands {
  private readonly deferred = new DeferredCommands(); private readonly router: CommandRouter;
  private readonly world: EntityWorld; private readonly mode: () => Readonly<PlaybackMode>; private dispatching = false; private fault: Error | undefined;
  constructor(router: CommandRouter, world: EntityWorld, services: NativeCommandServices, mode: () => Readonly<PlaybackMode>) {
    for (const name of serviceCommandNames) if (typeof services[name] !== 'function') throw new Error('Missing native command service: ' + name);
    this.router = router; this.world = world; this.mode = mode;
    router.register('envupdate', (command, mode) => this.world.apply(worldPlan(command.parameters), mode));
    for (const name of serviceCommandNames) router.register(name, services[name]);
    router.registerDeferred(async command => { this.deferred.enqueue(command); return undefined; });
  }
  async signal(trigger?: bigint | string, force = false): Promise<readonly CommandBlock[]> {
    if (this.fault) throw this.fault; if (this.dispatching) throw new Error('Delayed world dispatch requires serialized signal delivery'); this.dispatching = true;
    try {
      const blocks: CommandBlock[] = [];
      for (const command of this.deferred.extract(trigger, force)) { const block = await this.router.dispatch(command, this.mode()); if (block) blocks.push(block); } return blocks;
    } catch (error) { this.fault = error instanceof Error ? error : new Error(String(error)); throw this.fault; }
    finally { this.dispatching = false; }
  }
  cancelDeferred(): void { if (this.dispatching) throw new Error('Cannot clear an active delayed dispatch'); this.deferred.clear(); this.fault = undefined; }
  captureDeferred(): readonly RuntimeCommand[] { if (this.fault) throw this.fault; return this.deferred.snapshot(); }
  restoreDeferred(value: readonly RuntimeCommand[]): void { if (this.dispatching) throw new Error('Cannot restore an active delayed dispatch'); this.deferred.restore(value); this.fault = undefined; }
}
