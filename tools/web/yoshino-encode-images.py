"""Encode only the owned Yoshino derivative tree; Pillow + libwebp are required."""
import concurrent.futures as cf
import hashlib
import json
import os
from pathlib import Path
import sys


def sha(data):
    return hashlib.sha256(data).hexdigest()


def icon():
    # The source is a 64 CSS pixel SVG. Rasterize its two cubics and simple
    # primitives at 4x, then downsample with alpha before WebP encoding.
    expected = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#241729"/><path d="M32 42C3 29 19 11 32 27C45 11 61 29 32 42Z" fill="#e98baa"/><circle cx="32" cy="42" r="4" fill="#ffe6c3"/></svg>'
    raw = (app / 'yoshino.svg').read_bytes()
    if raw.decode('utf8').strip() != expected:
        raise ValueError('Logo vectors changed; review the edition rasterizer')
    image = Image.new('RGBA', (256, 256))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 255, 255), radius=56, fill='#241729')
    points = []
    for a, b, c, d in [((32,42),(3,29),(19,11),(32,27)), ((32,27),(45,11),(61,29),(32,42))]:
        for i in range(65):
            t, s = i / 64, 1 - i / 64
            points.append(tuple(4*(s**3*a[j]+3*s*s*t*b[j]+3*s*t*t*c[j]+t**3*d[j]) for j in (0,1)))
    draw.polygon(points, fill='#e98baa')
    draw.ellipse((112, 152, 144, 184), fill='#ffe6c3')
    return raw, image.resize((64,64), Image.Resampling.LANCZOS)


def encode(row):
    src, target = row['src'], row['dst']
    dest = cache / 'encoded' / target
    dest.parent.mkdir(exist_ok=True, parents=True)
    receipt = receipts / (target.replace('/', '-') + '.json')
    if receipt.exists():
        old = json.loads(receipt.read_text(encoding='utf8'))
        if sha(dest.read_bytes()) != old['sha256']:
            raise ValueError('Prior WebP receipt differs: ' + target)
        return False
    if src == '@icon':
        original, image = icon()
    else:
        import io
        original = (base / src).read_bytes()
        if row.get('sha256') and (sha(original) != row['sha256'] or len(original) != row['bytes']):
            raise ValueError('Original image differs: ' + src)
        with Image.open(io.BytesIO(original)) as picture:
            image = picture.convert('RGBA')
    alpha = image.getchannel('A')
    transparent = alpha.getextrema()[0] < 255
    if not transparent:
        image = image.convert('RGB')
    temp = dest.with_name(dest.name + '.' + str(os.getpid()) + '.tmp')
    try:
        image.save(temp, format='WEBP', quality=75, method=3, lossless=False, alpha_quality=100, exact=True)
        with Image.open(temp) as proof:
            if proof.format != 'WEBP' or proof.size != image.size:
                raise ValueError('WebP identity or dimensions changed: ' + target)
            if transparent and proof.convert('RGBA').getchannel('A').tobytes() != alpha.tobytes():
                raise ValueError('WebP alpha changed: ' + target)
        data = temp.read_bytes()
        temp.replace(dest)
        with receipt.open('x', encoding='utf8') as out:
            json.dump(dict(src=src, dst=target, width=image.width, height=image.height,
                           transparent=transparent, quality=75, old=sha(original), before=len(original),
                           bytes=len(data), sha256=sha(data)), out, separators=(',', ':'))
    finally:
        if temp.exists():
            temp.unlink()
    return True


if __name__ == '__main__':
    if len(sys.argv) not in (4, 5) or (len(sys.argv) == 5 and sys.argv[4] != 'mak') or os.name != 'nt':
        raise SystemExit('Usage on Windows: yoshino-encode-images.py start count workers [mak]')
    from PIL import Image, ImageDraw, features
    if not features.check('webp'):
        raise SystemExit('Pillow must support WebP')
    start, count, workers = (int(x) for x in sys.argv[1:4])
    if start < 0 or not 1 <= count <= 1500 or not 1 <= workers <= 8:
        raise SystemExit('Media batches must be bounded')
    app = Path(__file__).resolve().parents[2]
    base = app / 'local-assets/site'
    cache = app / 'local-assets/media-webp75-opus32-64'
    old_base = app / 'apps/yoshino-web/local-assets/site'
    if len(sys.argv) == 5:
        base = old_base = app / 'work/mako-prepared-graphics'
        cache /= 'mako-images'
    if cache.resolve() != cache or base.resolve() != base:
        raise SystemExit('Unexpected link in owned resource paths')
    plan = json.loads((cache / 'plan.json').read_text(encoding='utf8'))
    if plan['format'] != 'yoshino-webp75-opus32-64-v1' or Path(plan['base']) not in (base, old_base):
        raise SystemExit('Unbound media plan')
    receipts = cache / 'receipt/image'
    receipts.mkdir(exist_ok=True, parents=True)
    items = plan['images'][start:start+count]
    if not items:
        raise SystemExit('Empty image batch')
    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as pool:
        for i, result in enumerate(pool.map(encode, items), start=1):
            done += result
            if i % 100 == 0:
                print(json.dumps(dict(start=start, completed=i)), flush=True)
    print(json.dumps(dict(start=start, done=done, skipped=len(items)-done, planned=len(items), total=len(plan['images']))))
