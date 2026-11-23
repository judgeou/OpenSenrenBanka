import type {NativeSession} from '../native-session-types.ts';
import type {ReplayPlan} from '../../src/runtime/live-scene-history.ts';
export class BacklogFlow {
  active=false;
  constructor(private readonly host:{current():NativeSession|undefined;changed():void;commit(old:NativeSession,plan:ReplayPlan):Promise<()=>void>;issue(error:unknown):void}){}
  async open(){
    const old=this.host.current();if(this.active||!old?.historyAvailable?.())return;
    const at=old.view().position;this.active=true;this.host.changed();let activate:(()=>void)|undefined,backdrop=false;
    try{
      await old.pause(true,'backlog','story');
      const p=old.view().position;
      if(at.asset!==p.asset||at.scene!==p.scene||at.cursor!==p.cursor||at.currentText!==p.currentText)throw Error('请在当前句稳定后打开历史');
      const {BacklogPage}=await import('./pc-backlog.ts');await old.historyBackdrop?.(true);backdrop=true;
      await new BacklogPage({text:old.history(),scenes:old.sceneHistory?.()??[],jump:async id=>{
        if(old!==this.host.current()||!old.historyPlan)throw Error('原会话已改变');
        activate=await this.host.commit(old,old.historyPlan(id));
      }}).run();
    }catch(error){this.host.issue(error);}
    finally{
      try{if(this.host.current()===old){try{if(backdrop)await old.historyBackdrop?.(false);}finally{await old.pause(false,'backlog');}}else activate?.();}
      catch(error){this.host.issue(error);}
      this.active=false;this.host.changed();
    }
  }
}
