/** Original patch-before-base text views. Data only: never execute TJS or KS. */
interface TextView { readonly name: string; readonly view: string }
interface TextManifest { readonly views: readonly TextView[] }
const manifests = new Map<string, Promise<TextManifest>>();
async function manifest(base: URL): Promise<TextManifest> {
  const url = new URL('manifest.json', base), existing = manifests.get(url.href);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('原配置清单不可用：' + url.pathname);
    const value = await response.json();
    if (!value || !Array.isArray(value.views) || value.views.length > 10000 || value.views.some((row: any) => !row || typeof row.name !== 'string' || typeof row.view !== 'string')) throw new Error('Invalid original text manifest');
    return value as TextManifest;
  })();
  manifests.set(url.href, pending);
  void pending.catch(() => { if (manifests.get(url.href) === pending) manifests.delete(url.href); });
  return pending;
}
export async function originalText(root: URL, name: string): Promise<string> {
  if (!['http:', 'https:'].includes(root.protocol) || !/^[a-z0-9_.-]+$/iu.test(name) || name.includes('..')) throw new Error('Invalid original text request');
  for (const folder of ['base-script-views/r13-patch/', 'base-script-views/r13-data/']) {
    const base = new URL(folder, root), source = await manifest(base);
    const rows = source.views.filter(row => row.name.replaceAll('\\', '/').split('/').at(-1)!.toLowerCase() === name.toLowerCase());
    if (!rows.length) continue;
    if (rows.length !== 1 || !/^[0-9]+[.]utf8[.]txt$/u.test(rows[0].view)) throw new Error('原配置身份不明确：' + name);
    const response = await fetch(new URL(rows[0].view, base));
    if (!response.ok) throw new Error('原配置读取失败：' + name);
    const text = await response.text();
    if (text.length > 4194304) throw new Error('Original text resource exceeds budget');
    return text;
  }
  throw new Error('缺少原配置：' + name);
}
