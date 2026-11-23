import type {NativeSession} from '../native-session.ts';

export function storyDom(viewport:HTMLElement,b:(id:string)=>HTMLButtonElement){
  const data=(key:string,value:string)=>{if(viewport.dataset[key]!==value)viewport.dataset[key]=value;};
  const disabled=(id:string,value:boolean)=>{const button=b(id);if(button.disabled!==value)button.disabled=value;};
  function prefetch(session?:NativeSession){
    const stats=session?.prefetch?.stats();
    for(const id of ['limit','ready','reserved','hits','started'] as const)data('prefetch'+id[0].toUpperCase()+id.slice(1),String(stats?.[id]??0));
  }
  function update(view:ReturnType<NativeSession['view']>|undefined,held:string,film:ReturnType<NativeSession['view']>['movie'],
      blocked:boolean,menuOff:boolean,gameMenuOpen:boolean,hasQuick:boolean){
    const p=view?.position;
    data('story',p?.asset?p.asset+'/'+p.scene+'/'+p.cursor:'');
    data('text',p?.currentText??'');data('wait',view?.waiting.kind??'');data('skipMode',view?.mode.skip??'none');data('holdSkip',held);
    data('present',String(!!view&&!view.awaitingPresentation&&!view.paused));data('movie',film?.phase??'');
    const protectedWait=view?.waiting.kind==='external'&&!view.waiting.interruptible;
    data('canAdvance',String(!blocked&&!gameMenuOpen&&(!film||film.interruptible)&&!protectedWait));
    data('menuReady',String(!menuOff));data('protectedWait',protectedWait?'true':'');
    for(const id of ['auto','skip','history-open','settings','slots-load','back-title'])disabled(id,menuOff);
    disabled('save',menuOff||!!view?.saveReason);disabled('slots-save',menuOff||!!view?.saveReason);
    disabled('load',menuOff||!hasQuick);
    for(const id of ['save','slots-save'])if(b(id).title!==(view?.saveReason??''))b(id).title=view?.saveReason??'';
    for(const [id,on] of [['auto',view?.mode.auto===true],['skip',view?.mode.skip==='read']] as const){
      const button=b(id);if(button.getAttribute('aria-pressed')!==String(on))button.setAttribute('aria-pressed',String(on));
    }
    return protectedWait;
  }
  return {update,prefetch};
}
