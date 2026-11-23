import { nativeTextProgram } from './native-text-program.ts';


/** Presentation views use the same finite parser as the actual message program. */
export function nativeTextRuns(body        )                           { return nativeTextProgram(body).atoms; }
export function appendNativeText(parent             , runs                          )       {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const units                           = run.ruby === undefined ? Array.from(run.text).map(text => ({ text })) : [run];
    for (const unit of units) {
      const span = document.createElement('span'); span.className = 'text-unit';
      if ('ruby' in unit && unit.ruby !== undefined) {
        const ruby = document.createElement('ruby'), base = document.createElement('rb'), reading = document.createElement('rt');
        base.textContent = unit.text; reading.textContent = unit.ruby; ruby.append(base, reading); span.append(ruby);
      } else span.textContent = unit.text;
      span.dataset.units = String(unit.text.replace(/\n/gu, '').length); fragment.append(span);
    }
  }
  parent.replaceChildren(fragment);
}
