// References from the active sysse.ini and original sysvoice.tjs, not invented filenames.
export function r64SoundClosure(scope, ini) {
  const table=new Map();
  for(const line of ini.replace(/^\uFEFF/u,'').split(/\r?\n/u)) {
    const m=line.match(/^\s*(sysvo\.[^\s=]+)\s*=\s*([^#;]*?)\s*(?:[#;].*)?$/u);
    if(!m)continue;
    if(table.has(m[1]))throw new Error('Ambiguous original system sound key: '+m[1]);
    table.set(m[1],m[2].split(/\s+/u).filter(Boolean));
  }
  const expected=new Set(table.get('sysvo.keys')??[]);
  const clips={}, uses=[];
  for(const command of scope.commands.filter(row=>row.name==='sysvoice')) {
    const {name,chara,eyecatch}=command.parameters;
    const formats=table.get('sysvo.format.'+name);
    if(eyecatch!=='true'||typeof chara!=='string'||!formats?.length||formats.some(row=>!/^%s_[a-z0-9_]+$/u.test(row))) throw new Error('Unsupported original system voice at '+JSON.stringify(command.location));
    const set=clips[name]??=Object.create(null);
    for(const candidate of chara.split(':')) {
      const base=table.get('sysvo.'+candidate);
      if(!expected.has(candidate)||base?.length!==1||!/^\w+$/u.test(base[0]))throw new Error('Unresolved original system voice: '+candidate);
      const candidates=set[candidate]??=formats.map(row=>row.replace('%s',base[0]));
      for(const value of candidates)uses.push({value,source:'sysvoice-config',character:candidate,location:command.location});
    }
  }
  for(const row of scope.audio.filter(row=>row.value.startsWith('&'))) {
    const fallback=row.value.match(/^&animOffSE\("([^"\r\n]+)"\)$/u);
    if(!fallback)throw new Error('Unknown original dynamic audio dependency: '+row.value+' at '+JSON.stringify(row.location));
    uses.push({...row,value:fallback[1],expression:row.value,source:'original-animation-disabled-fallback'});
  }
  return {uses,clips};
}
