declare module 'virtual:yoshino-pc-save' {
  export interface SaveLayer {readonly x:number;readonly y:number;readonly w:number;readonly h:number;readonly src?:string}
  const art:Readonly<Record<'sl_save'|'sl_load'|'sl_qlod'|'dialog'|'qload_popup',Readonly<Record<string,SaveLayer>>>>;
  export default art;
}
