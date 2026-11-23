import type { NativePreparedLayer } from '../native-layer-painter.ts';
import type { NativeUiPublication } from '../native-ui-planes.ts';
import type { MotionFrame } from './motion-frame.ts';
import type { NativeMotionActionEvent, NativeMotionActionPort } from './action-events.ts';

export type NativeFrameResult =
  | { readonly kind: 'painted' }
  | { readonly kind: 'not-painted'; readonly reason: 'closed' | 'batch' | 'stale-publication' }
  | { readonly kind: 'motion-event'; readonly ticket: number; readonly deliveryId: number };
export interface NativeStagedScene {
  readonly layers: ReadonlyMap<string, NativePreparedLayer | undefined>;
  readonly ordered: readonly NativePreparedLayer[];
}
export interface NativeFrameStageHost {
  blocked(): 'closed' | 'batch' | undefined;
  revision(): number;
  /** All owned event sources, not just visible drawables; no mutation/evaluation. */
  preflight(): void;
  advance(now: number): void;
  prepare(now: number): Promise<NativeUiPublication | undefined>;
  publication(value: NativeUiPublication | undefined): void;
  plan(value: NativeUiPublication | undefined, now: number): NativeStagedScene;
  present(value: NativeUiPublication | undefined, now: number, scene: NativeStagedScene): void;
}
interface Ticket {
  readonly id: number; readonly now: number; readonly advance: boolean;
  advanceDone: boolean; revision: number; publication: NativeUiPublication | undefined;
  scene: NativeStagedScene | undefined; cursor: number;
  readonly progressed: Set<MotionFrame>;
  current: NativeMotionActionPort | undefined;
  delivery: NativeMotionActionEvent | undefined;
  acknowledged: boolean; deliveries: number;
}
/** One continuation of the existing session task, NOT another execution queue.
 * Holds only descriptors/state. Never retains a paint/UI/GPU lease across yield.
 */
export class NativeFrameTickets {
  private serial = 0;
  private active: Ticket | undefined;
  private busy = false;
  private faulted = false;
  private settled: Promise<void> = Promise.resolve();
  private settle: (() => void) | undefined;
  constructor(private readonly host: NativeFrameStageHost) {}
  assertIdle(): void {
    if (this.active || this.busy || this.faulted) throw new Error('Native graphics has an active or failed frame ticket');
  }
  /** Terminate a yielded ticket immediately; await only our asset-prepare work,
   * never an app callback. This promise is completion, not an execution queue. */
  async teardown(): Promise<void> {
    this.faulted = true; this.active?.current?.outbox.fault();
    if (this.busy) await this.settled;
    this.active = undefined; this.faulted = false;
  }
  private beginBusy(): void {
    this.busy = true; this.settled = new Promise(resolve => { this.settle = resolve; });
  }
  private endBusy(): void {
    this.busy = false; this.settle?.(); this.settle = undefined;
  }
  private validate(ticket: Ticket): void {
    if (this.faulted || this.active !== ticket || this.host.blocked() || ticket.revision !== this.host.revision()) throw new Error('Staged motion callback changed graphics ownership/publication');
    this.host.publication(ticket.publication);
  }
  private fault(ticket: Ticket): void {
    this.faulted = true; ticket.current?.outbox.fault();
  }
  async stage(now: number, advance: boolean): Promise<NativeFrameResult> {
    this.assertIdle();
    if (!Number.isFinite(now) || now < 0 || typeof advance !== 'boolean') throw new Error('Invalid native frame boundary');
    const blocked = this.host.blocked(); if (blocked) return { kind: 'not-painted', reason: blocked };
    this.host.preflight();
    if (this.serial >= Number.MAX_SAFE_INTEGER) throw new Error('Native frame ticket serial exhausted');
    const ticket: Ticket = { id: ++this.serial, now, advance, advanceDone: false, revision: this.host.revision(), publication: undefined, scene: undefined, cursor: 0, progressed: new Set(), current: undefined, delivery: undefined, acknowledged: false, deliveries: 0 };
    this.active = ticket; this.beginBusy();
    try {
      if (ticket.advance) this.host.advance(now);
      ticket.advanceDone = true; ticket.revision = this.host.revision();
      ticket.publication = await this.host.prepare(now);
      const after = this.host.blocked();
      if (after || ticket.revision !== this.host.revision()) {
        this.active = undefined; return { kind: 'not-painted', reason: after ?? 'stale-publication' };
      }
      this.validate(ticket); ticket.scene = this.host.plan(ticket.publication, now);
      return this.pump(ticket);
    } catch (error) { this.fault(ticket); throw error; }
    finally { this.endBusy(); }
  }
  async resume(id: number): Promise<NativeFrameResult> {
    const ticket = this.active;
    if (this.busy || !ticket || ticket.id !== id || !ticket.delivery || !ticket.acknowledged) throw new Error('Resume requires the acknowledged exact active motion delivery');
    this.beginBusy();
    try {
      this.validate(ticket);
      ticket.delivery = undefined; ticket.acknowledged = false;
      return this.pump(ticket);
    } catch (error) { this.fault(ticket); throw error; }
    finally { this.endBusy(); }
  }
  peek(): NativeMotionActionEvent | undefined {
    if (this.faulted) throw new Error('Motion delivery fault forbids automatic retry');
    const ticket = this.active;
    return ticket && !ticket.acknowledged ? ticket.delivery : undefined;
  }
  ack(deliveryId: number): void {
    const ticket = this.active;
    if (this.busy || this.faulted || !ticket?.current || !ticket.delivery || ticket.acknowledged || ticket.delivery.deliveryId !== deliveryId) throw new Error('Motion ack is not the exact staged delivery');
    try {
      this.validate(ticket);
      if (ticket.current.outbox.peek() !== ticket.delivery) throw new Error('Motion outbox head changed before acknowledgement');
      ticket.current.ack(deliveryId);
      if (ticket.current.outbox.peek()?.deliveryId === deliveryId) throw new Error('Source failed to commit motion acknowledgement');
      ticket.acknowledged = true;
    } catch (error) { this.fault(ticket); throw error; }
  }
  /** App must report partial callback failure rather than retrying the SE. */
  fail(id: number, deliveryId: number): void {
    const ticket = this.active;
    if (this.busy || this.faulted || !ticket?.current || ticket.id !== id || !ticket.delivery || ticket.delivery.deliveryId !== deliveryId || ticket.acknowledged || ticket.current.outbox.peek() !== ticket.delivery) throw new Error('Failure is not an exact unacknowledged live consumer delivery');
    this.fault(ticket);
  }
  private pending(ticket: Ticket): NativeFrameResult | undefined {
    const port = ticket.current, event = port?.outbox.peek();
    if (!port || !event) return;
    if (event.sourceId !== port.sourceId || event.playSerial !== port.playSerial || ++ticket.deliveries > 32) throw new Error('Staged motion action source/range or delivery budget mismatch');
    ticket.delivery = event; ticket.acknowledged = false;
    return { kind: 'motion-event', ticket: ticket.id, deliveryId: event.deliveryId };
  }
  private pump(ticket: Ticket): NativeFrameResult {
    if (!ticket.advanceDone || !ticket.scene) throw new Error('Incomplete native staged frame');
    this.validate(ticket);
    const pending = this.pending(ticket); if (pending) return pending;
    ticket.current = undefined;
    while (ticket.advance && ticket.cursor < ticket.scene.ordered.length) {
      const draw = ticket.scene.ordered[ticket.cursor++], motion = draw.view.frame.motion;
      if (!motion || ticket.progressed.has(motion)) continue;
      ticket.current = motion.actions;
      ticket.current?.preflight(draw.presentation.id);
      motion.progressBeforeDraw(ticket.now); ticket.progressed.add(motion);
      const next = this.pending(ticket); if (next) return next;
      ticket.current = undefined;
    }
    this.validate(ticket); this.host.present(ticket.publication, ticket.now, ticket.scene);
    this.active = undefined; return { kind: 'painted' };
  }
}
