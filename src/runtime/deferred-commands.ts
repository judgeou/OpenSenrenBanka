import { clonePsbValue } from '../formats/psb-value.ts';
import type { RuntimeCommand } from '../scenario/invocation.ts';
function copy(command: RuntimeCommand): RuntimeCommand {
  const parameters = clonePsbValue(command.parameters) as RuntimeCommand['parameters'];
  return { ...command, location: { ...command.location }, parameters, order: [...command.order], deferred: command.deferred && { ...command.deferred } };
}
/** Threshold/event matching only. The owning timeline supplies its original trigger value. */
export class DeferredCommands {
  private pending: RuntimeCommand[] = [];
  enqueue(command: RuntimeCommand): void {
    if (!command.deferred) throw new Error('Deferred command is missing a trigger');
    if (this.pending.length >= 100000) throw new Error('Deferred-command budget exceeded'); this.pending.push(copy(command));
  }
  get length(): number { return this.pending.length; }
  extract(trigger?: bigint | string, force = false): RuntimeCommand[] {
    const ready: RuntimeCommand[] = [], pending: RuntimeCommand[] = [];
    for (const command of this.pending) {
      const delay = command.deferred!, noDone = command.parameters.nodelaydone;
      const finish = trigger === undefined && !(noDone !== undefined && noDone !== null && noDone !== false && noDone !== 0n && noDone !== 0 && noDone !== '');
      const numeric = typeof trigger === 'bigint' && delay.kind === 'integer' && delay.value <= trigger;
      const named = typeof trigger === 'string' && delay.kind === 'label' && (trigger === '*' || delay.value === trigger);
      if (force || finish || numeric || named) ready.push({ ...copy(command), deferred: undefined }); else pending.push(command);
    }
    this.pending = pending; return ready;
  }
  clear(): void { this.pending = []; }
  snapshot(): readonly RuntimeCommand[] { return this.pending.map(copy); }
  restore(commands: readonly RuntimeCommand[]): void {
    if (commands.length > 100000 || commands.some(command => !command.deferred)) throw new Error('Invalid deferred-command snapshot'); this.pending = commands.map(copy);
  }
}
