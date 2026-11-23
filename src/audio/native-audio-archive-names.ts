/** Original XP3 directory aliases lost when two records share the same storage. */
const water='sound/水／かける３.ogg', bath='sound/水／かける３（風呂）.ogg';
// Both names in data.xp3 use key 3548749119 and offset 294566187.
const waterDigest='537475e47274be48ae4a4ad24ee30dd89dd4861d67cf4b06c111bc7cadd66788';
export function originalAudioNames(name:string,sha256:string):readonly string[]{
  return sha256===waterDigest&&name===water?[water,bath]:[name];
}
