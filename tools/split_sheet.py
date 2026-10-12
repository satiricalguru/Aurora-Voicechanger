"""Split a generated portrait sheet (grid with dark gutters) into square avatars.

usage: python3 tools/split_sheet.py sheet.jpg out_dir id1,id2,... [rows cols]
Ids map left-to-right, top-to-bottom; use '-' to skip a tile.
"""
import sys, os
import numpy as np
from PIL import Image


def bands(dark_frac, n, min_len):
    """Return [start, end) spans of non-gutter content along one axis."""
    content = dark_frac < 0.9
    spans, start = [], None
    for i, c in enumerate(content):
        if c and start is None:
            start = i
        elif not c and start is not None:
            if i - start >= min_len:
                spans.append((start, i))
            start = None
    if start is not None and len(content) - start >= min_len:
        spans.append((start, len(content)))
    if len(spans) != n:  # fall back to an even split
        step = len(content) / n
        spans = [(int(i * step), int((i + 1) * step)) for i in range(n)]
    return spans


def main():
    src, out, ids = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
    rows, cols = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (3, 3)
    img = Image.open(src).convert('RGB')
    a = np.asarray(img).astype(np.float32)
    lum = a.mean(axis=2)
    dark = lum < 28
    ys = bands(dark.mean(axis=1), rows, img.height // (rows * 3))
    xs = bands(dark.mean(axis=0), cols, img.width // (cols * 3))
    os.makedirs(out, exist_ok=True)
    k = 0
    for (y0, y1) in ys:
        for (x0, x1) in xs:
            if k < len(ids) and ids[k] != '-':
                pad = 6
                tile = img.crop((x0 + pad, y0 + pad, x1 - pad, y1 - pad))
                s = min(tile.size)
                l = (tile.width - s) // 2
                t = max(0, (tile.height - s) // 3)  # bias toward the face
                tile = tile.crop((l, t, l + s, t + s)).resize((512, 512), Image.LANCZOS)
                tile.save(os.path.join(out, f'{ids[k]}.jpg'), quality=86, optimize=True)
            k += 1
    print('rows', ys, 'cols', xs)


if __name__ == '__main__':
    main()
