const threshold=1000;
const control=(e:KeyboardEvent)=>e.key==='Control';
const space=(e:KeyboardEvent)=>e.code==='Space'||e.key===' ';
export class HoldSkipKeys {
  private readonly controls=new Set<string>();
  private started?:number;
  // When the page consumes the initial key, consume repeats and release even
  // if focus moves into a choice or menu. Do not let a stale release click it.
  private owned=false;
  constructor(private readonly now=()=>performance.now(),private readonly changed?:()=>void){}
  remaining():number { const delay=this.started===undefined?0:threshold-(this.now()-this.started);return delay>0?delay:Infinity; }
  mode():'none'|'read'|'all'{return this.controls.size?'all':this.started!==undefined&&this.now()-this.started>=threshold?'read':'none';}
  clear():void {const changed=this.controls.size||this.started!==undefined;this.controls.clear();this.started=undefined;if(changed)this.changed?.();}
  down(e:KeyboardEvent,eligible:boolean):boolean {
    if(control(e)){
      if(eligible&&!e.defaultPrevented&&!e.repeat&&!e.altKey&&!e.metaKey&&!e.shiftKey){this.controls.add(e.code||e.key);this.changed?.();}
      return e.repeat||eligible;
    }
    if(!space(e)){
      if(e.ctrlKey)this.clear();
      return false;
    }
    if(e.repeat&&this.owned){e.preventDefault();e.stopPropagation();return true;}
    if(!e.repeat&&eligible&&!e.defaultPrevented&&!e.altKey&&!e.metaKey&&!e.shiftKey){
      this.owned=true;if(!e.ctrlKey&&!this.controls.size){this.started=this.now();this.changed?.();}
      e.preventDefault();e.stopPropagation();return true;
    }
    if(!e.repeat){this.owned=false;if(this.started!==undefined){this.started=undefined;this.changed?.();}}
    return false;
  }
  up(e:KeyboardEvent,advance:()=>void):void {
    if(control(e)){if(this.controls.delete(e.code||e.key))this.changed?.();return;}
    if(!space(e)||!this.owned)return;
    e.preventDefault();e.stopPropagation();this.owned=false;
    const started=this.started;this.started=undefined;this.changed?.();
    if(!this.controls.size&&started!==undefined&&this.now()-started<threshold)advance();
  }
}
