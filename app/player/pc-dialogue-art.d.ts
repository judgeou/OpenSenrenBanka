declare module 'virtual:yoshino-pc-dialogue' {
  interface PcLayer {readonly x:number;readonly y:number;readonly w:number;readonly h:number;readonly src?:string}
  const art:{quickmenu:Readonly<Record<string,PcLayer>>,voicebar:Readonly<Record<string,PcLayer>>};
  export default art;
}
