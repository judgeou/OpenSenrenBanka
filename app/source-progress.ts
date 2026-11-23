import type { ScriptState } from '../src/script/state.ts';
import { cloneScript } from '../src/script/state.ts';
import { psbRecord } from '../src/formats/psb-value.ts';
import type { PsbValue } from '../src/formats/psb-value.ts';
import type { CheckpointView } from '../src/scenario/semantics.ts';
import type { RuntimeLocation } from '../src/scenario/invocation.ts';
import type { ScenePlayer } from '../src/runtime/scene-player.ts';
import { scriptDictionary } from './script-bindings.ts';
import { sessionData } from './session-data.ts';
/** Runtime equivalents of chart plugin current, KAG storeFlags and label-store/menu-access boundary. */
export class SourceProgress {
  private chart: string | undefined; private anchor: PsbValue = null; private journal: PsbValue[] = [];
  private labelPassed = false; private menuAccessible = false;
  constructor(private readonly script: ScriptState) {}
  chartCommand(parameters: Readonly<Record<string, PsbValue>>): void {
    if (parameters.reset !== undefined) { this.chart = undefined; return; }
    if (parameters.leave !== undefined) this.setChart(undefined);
    if (typeof parameters.enter === 'string' && parameters.enter !== '') this.setChart(parameters.enter);
  }
  private setChart(next: string | undefined): void {
    const sf = scriptDictionary(this.script, 'sf');
    // ScenarioChartPluginBase.setCurrent: exit old first, then open the new node. Source restoration never calls this.
    if (this.chart) this.script.setMember(sf,'eos_' + this.chart,true); this.chart = next; if (next) this.script.setMember(sf,'fos_' + next,true);
  }
  hasMarker(value:string):boolean {return Boolean(scriptDictionary(this.script,'sf')[value]);}
  marker(value: string): void { if (value) this.script.setMember(scriptDictionary(this.script, 'sf'),value,1n); }
  checkpoint(value: CheckpointView, location: RuntimeLocation, player: ScenePlayer): void {
    if (player.playback.skip === 'read' && value.textId !== undefined && !player.isRead(location.asset + '/' + location.scene + '/' + value.textId)) player.setMode({ skip: 'none' });
    this.script.write('pflags', cloneScript(scriptDictionary(this.script, 'f')));
    const configuration = this.script.read('scflags'); this.script.write('pcflags', configuration === undefined ? {} : cloneScript(configuration));
    this.labelPassed = true; this.menuAccessible = true;
    this.anchor = sessionData({ location, checkpoint: value }); this.journal.push(this.anchor); if (this.journal.length > 128) this.journal.shift();
  }
  restoreSource(value: Readonly<Record<string, PsbValue>>): void {
    if (value.scnchart !== undefined && value.scnchart !== null && typeof value.scnchart !== 'string') throw new Error('Invalid original scnchart plugin state');
    this.chart = typeof value.scnchart === 'string' ? value.scnchart : undefined; this.anchor = null; this.journal = []; this.labelPassed = false; this.menuAccessible = false;
  }
  capture(): PsbValue { return { schemaVersion: 1n, chart: this.chart ?? null, anchor: this.anchor, journal: this.journal.map(value => sessionData(value)), labelPassed: this.labelPassed, menuAccessible: this.menuAccessible }; }
  restore(value: PsbValue): void {
    const row = psbRecord(value); if (row.schemaVersion !== 1n || row.chart !== null && typeof row.chart !== 'string' || !Array.isArray(row.journal) || row.journal.length > 128 || typeof row.labelPassed !== 'boolean' || typeof row.menuAccessible !== 'boolean') throw new Error('Invalid saved source progress');
    this.chart = typeof row.chart === 'string' ? row.chart : undefined; this.anchor = sessionData(row.anchor); this.journal = row.journal.map(value => sessionData(value)); this.labelPassed = row.labelPassed; this.menuAccessible = row.menuAccessible;
  }
}
