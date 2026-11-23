import type {AudioAsset} from './audio-catalog.ts';
// Legacy historical milestone viewers only; never selected by the production player.
export interface AudioLease { readonly buffer: AudioBuffer; readonly metadata: AudioAsset; release(): void }
interface Slot { readonly entry: AudioAsset; holders: number; stamp: number; bytes: number; buffer?: AudioBuffer; pending?: Promise<AudioBuffer> }
export class LegacyAudioBufferCatalog {
  private readonly slots=new Map<string,Slot>();private readonly abort=new AbortController();
  private stamp=0;private bytes=0;private closed=false;
  private decoder:Promise<void>=Promise.resolve();
  constructor(private readonly base:URL,private readonly context:BaseAudioContext,private readonly budget:number){}
  async acquire(item:AudioAsset): Promise<AudioLease> {
    if (this.closed) throw new Error('Audio catalog is closed'); let slot = this.slots.get(item.id);
    if (!slot) {
      // A long BGM decode needs new PCM before it becomes a cache entry. Evict only idle
      // leases first instead of holding the full previous cache through native allocation.
      const anticipatedBytes = (Math.ceil(item.duration * Math.max(item.sampleRate, this.context.sampleRate)) + 2) * item.channels * 4;
      slot = { entry: item, holders: 0, stamp: ++this.stamp, bytes: 0 }; this.slots.set(item.id, slot); const created = slot;
      // One native decode pipeline per context. Do not fetch/hold compressed inputs or
      // reserve native PCM for the next request while the prior decode is in flight.
      const queued=this.decoder.then(async()=>{
        this.abort.signal.throwIfAborted();this.trim(false,anticipatedBytes);
        const buffer=await this.decode(item);
        this.abort.signal.throwIfAborted();
        created.buffer=buffer;created.bytes=buffer.length*buffer.numberOfChannels*4;
        this.bytes+=created.bytes;this.trim();return buffer;
      });
      this.decoder=queued.then(()=>{},()=>{});
      created.pending=queued.catch(error=>{if(this.slots.get(item.id)===created)this.slots.delete(item.id);throw error;});
    }
    slot.holders++; slot.stamp = ++this.stamp; const held = slot;
    try { const buffer = await held.pending!; let released = false; return { buffer, metadata: item, release: () => { if (released) return; released = true; held.holders--; held.stamp = ++this.stamp; this.trim(); } }; }
    catch (error) { held.holders--; throw error; }
  }
  close(): void { this.closed = true; this.abort.abort(); this.trim(); }
  clearUnused(): void { this.trim(true); }
  private trim(force = false, anticipatedBytes = 0): void {
    for (const slot of [...this.slots.values()].filter(slot => !slot.holders && slot.buffer).sort((a,b) => a.stamp-b.stamp)) {
      if (!force && !this.closed && this.bytes + anticipatedBytes <= this.budget) break; this.bytes -= slot.bytes; this.slots.delete(slot.entry.id);
    }
  }
  private async decode(item: AudioAsset): Promise<AudioBuffer> {
    const response = await fetch(new URL(item.file, this.base),{signal:this.abort.signal}); if (!response.ok) throw new Error('Audio HTTP ' + response.status); const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== item.bytes) throw new Error('Audio byte-length mismatch');
    const digest = await crypto.subtle.digest('SHA-256', bytes), hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== item.sha256) throw new Error('Audio content hash mismatch: ' + item.name);
    this.abort.signal.throwIfAborted();
    try { return await this.context.decodeAudioData(bytes); }
    catch (error) { throw new Error('Unable to decode original audio ' + item.name, { cause: error }); }
  }
}
