declare module 'virtual:yoshino-pc-backlog' {
  const art:Record<'backlog'|'dialog',Readonly<Record<string,import('virtual:yoshino-pc-save').SaveLayer>>>;
  export default art;
}
