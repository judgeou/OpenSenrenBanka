// Exact sealed resource families for the Cloudflare release of main/6494ee8.
// Only these old origins of a slot can acquire the old render attachment reader.
const currentCombined='f7b7352260cd6790e8ff960ec329bad86f6e70e1261a87301e21f68454678517';
const currentBase='94541a40983f51d2d791708ecaa4ba1a4a95c0e88c609c89f04df46e36c8c3de';
const cloudflareCombined='a0d0b5c4aa1dc535f8750f19b04fc4e330daefc7703d962795e705bb7c79c29d';
const cloudflareBase='bebbbd47eb4e9ba58065513db3691b0aca5bbfa3448416d81bcb3cb41c42fd2b';
const knownTarget=(id:string,base?:string)=>id===currentCombined&&base===currentBase;

export function savePredecessors(id:string,base?:string):readonly string[]{
  if(knownTarget(id,base))return [base!,cloudflareCombined,cloudflareBase];
  return base?[base]:[];
}
export function legacyRenderIdentity(id:string,base:string|undefined,source:string|undefined):string|undefined{
  return knownTarget(id,base)&&(source===cloudflareCombined||source===cloudflareBase)?cloudflareBase:undefined;
}
