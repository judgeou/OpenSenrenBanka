import type { PimgLayout } from './pimg-layout.ts';
/** Full PSD paths take precedence over unique leaf names; ordinal identities remain distinct. */
export class PimgPaths {
  readonly layout: PimgLayout; private readonly full = new Map<string,number[]>(); private readonly short = new Map<string,number[]>();
  constructor(layout: PimgLayout) { this.layout = layout;
    const add = (map: Map<string,number[]>, key: string, id: number) => { const list = map.get(key) ?? []; list.push(id); map.set(key,list); };
    for (const layer of layout.layers) { const names = [layer.name]; let parent = layer.parentId === undefined ? undefined : layout.byId.get(layer.parentId);
      while (parent) { names.unshift(parent.name); parent = parent.parentId === undefined ? undefined : layout.byId.get(parent.parentId); }
      add(this.full,names.map(name=>name.replaceAll('/','_')).join('/'),layer.id); add(this.short,layer.name,layer.id); if(layer.name.includes('/')) add(this.short,layer.name.replaceAll('/','_'),layer.id);
    }
  }
  has(path: string): boolean { return this.full.has(path) || this.short.has(path); }
  resolve(path: string): number { const list = this.full.get(path) ?? this.short.get(path); if (!list || list.length !== 1) throw new Error((list ? 'Ambiguous' : 'Unknown')+' PIMG layer path: '+path); return list[0]; }
}
