#!/usr/bin/env python3
"""Slice a decoration sheet into individual decals for place_decals.py.

    python3 tools/make_decals.py --prompt "long icicles, snow caps, frost clumps,
        well separated, flat magenta background, no pipes, no text"
    python3 tools/make_decals.py --from-sheet my-painted-sheet.png     # 0 credits

The first form costs one image credit and writes the sheet to
`assets/decal-sheet.png`; the second re-slices any sheet you already have,
including one you painted over by hand, which is the point — nothing downstream
has to be regenerated when you touch the sheet.

Output:

    assets/decal-sheet.png        the full-bleed sheet, yours to edit
    assets/decals/<kind>_<n>.png  one transparent PNG per shape it found
    assets/decals/decals.json     what each piece is, its size and its kind
    assets/decals/placement.json  how the placer should use them (created once,
                                  then left alone — it is yours to edit)

Shapes are found, not assumed: the background colour is keyed out by
connectivity from the frame edges, then each remaining blob becomes a piece. A
model will not put item 7 where you asked, so the grid is never trusted.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import image_model as M  # noqa: E402

SHEET = ROOT / "assets" / "decal-sheet.png"
DECALS = ROOT / "assets" / "decals"

# The sheet is asked for as a flat colour the keyer can name, because the model
# has no alpha and will otherwise invent a background of its own.
BG_ASK = "flat solid magenta #FF00FF background filling every gap between objects"
LAYOUT = ("Arrange the pieces well separated from each other on a plain grid, "
          "each one whole and not touching another, none cropped by the image edge.")
KEEP = ("Every object drawn as a single solid game sprite with a clean silhouette, "
        "lit from above, no shadow cast on the background.")

PLACE_DEFAULT = {
    "targets": ["pipe_ew", "pipe_ns", "pipe_ne", "pipe_es", "pipe_sw", "pipe_nw"],
    "default": {"caps": 2, "hangs": 3, "cap_size": 30, "hang_size": 20,
                "overlap": 2, "jitter": 0.15, "seed": 7},
    "per_shape": {},
    "clear_joint_units": 4.0,
    "border_px": 2,
}


def border_colour(img, band=6):
    """The most common colour along the sheet edge, which is the background."""
    w, h = img.size
    px = img.load()
    seen = collections.Counter()
    for x in range(0, w, 3):
        for y in (band, h - band):
            seen[px[x, y][:3]] += 1
    for y in range(0, h, 3):
        for x in (band, w - band):
            seen[px[x, y][:3]] += 1
    return seen.most_common(1)[0][0] if seen else (255, 0, 255)


def key_out(img, tol=48):
    """Alpha 0 for background, 255 for sprites. Background means: close to the
    edge colour AND reachable from the edge — so the colour inside a sprite is
    never keyed, and a hollow shape keeps its hole."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    bg = border_colour(rgb)
    near = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).convert("L")
    near = near.point(lambda v: 1 if v <= tol else 0)
    n = near.load()

    seen = bytearray(w * h)
    q = collections.deque()
    for x in range(w):
        for y in (0, h - 1):
            if n[x, y] and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if n[x, y] and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and n[nx, ny] and not seen[ny * w + nx]:
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    alpha = Image.new("L", (w, h), 0)
    a = alpha.load()
    for y in range(h):
        for x in range(w):
            if not seen[y * w + x]:
                a[x, y] = 255
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def components(alpha, step=4, min_side=10):
    """Bounding boxes of the separate shapes, found on a coarse grid and then
    tightened against the full-resolution mask."""
    w, h = alpha.size
    small = alpha.resize((max(1, w // step), max(1, h // step)), Image.NEAREST)
    sw, sh = small.size
    s = small.load()
    seen = bytearray(sw * sh)
    boxes = []
    for oy in range(sh):
        for ox in range(sw):
            i = oy * sw + ox
            if not s[ox, oy] or seen[i]:
                continue
            seen[i] = 1
            q = collections.deque([(ox, oy)])
            x0 = x1 = ox
            y0 = y1 = oy
            while q:
                x, y = q.popleft()
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    j = ny * sw + nx
                    if 0 <= nx < sw and 0 <= ny < sh and s[nx, ny] and not seen[j]:
                        seen[j] = 1
                        q.append((nx, ny))
            boxes.append((x0 * step - step, y0 * step - step,
                          (x1 + 1) * step + step, (y1 + 1) * step + step))

    a = alpha.load()
    tight = []
    for x0, y0, x1, y1 in boxes:
        cx0, cy0, cx1, cy1 = w, h, 0, 0
        for y in range(max(0, y0), min(h, y1)):
            for x in range(max(0, x0), min(w, x1)):
                if a[x, y]:
                    cx0, cy0, cx1, cy1 = min(cx0, x), min(cy0, y), max(cx1, x), max(cy1, y)
        if cx1 - cx0 >= min_side and cy1 - cy0 >= min_side:
            tight.append((cx0, cy0, cx1, cy1))
    return sorted(tight, key=lambda b: (-(b[3] - b[1]) * (b[2] - b[0]), b[1], b[0]))


def kind_of(w, h):
    """What the piece looks like, so the placer knows which wall it belongs to.
    Tall and thin hangs; wide and flat sits on top; anything else is a clump."""
    if h >= w * 1.6:
        return "hang"
    if w >= h * 1.6:
        return "cap"
    return "clump"


def main():
    ap = argparse.ArgumentParser(description="cut a decoration sheet into decals")
    ap.add_argument("--prompt", help="what to draw on the sheet (costs one image credit)")
    ap.add_argument("--from-sheet", metavar="PATH", help="slice an existing sheet, 0 credits")
    ap.add_argument("--size", default="1024*1024", help="sheet size, area 512x512 to 2560x2560")
    ap.add_argument("--seed", type=int, help="fixed seed instead of one derived from the prompt")
    ap.add_argument("--long-side", type=int, default=64,
                    help="longest edge of each sliced decal, in PNG pixels")
    ap.add_argument("--tol", type=int, default=48, help="how close to the background colour still counts")
    ap.add_argument("--min-side", type=int, default=10, help="drop blobs smaller than this (sheet px)")
    ap.add_argument("--dry-run", action="store_true", help="show the request, send nothing")
    args = ap.parse_args()

    if bool(args.prompt) == bool(args.from_sheet):
        raise SystemExit("choose one: --prompt (costs a credit) or --from-sheet PATH")

    seed = args.seed if args.seed is not None else zlib.crc32((args.prompt or "").encode()) % 1_000_000
    if args.prompt:
        full = f"{args.prompt}. {BG_ASK}. {LAYOUT} {KEEP}"
        w, h = (int(v) for v in args.size.split("*"))
        if args.dry_run:
            print(f"would ask {M.MODEL} for {args.size}, seed {seed}\n  {full}\n"
                  f"  negative: {M.NEGATIVE}\ndry run: no request sent")
            return 0
        print(f"asking {M.MODEL} for a decoration sheet (1 credit) ...", flush=True)
        sheet = M.generate(full, seed, args.size)
        SHEET.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(SHEET, optimize=True)
        print(f"sheet: wrote {SHEET.relative_to(ROOT)} {sheet.size[0]}x{sheet.size[1]}")
    else:
        sheet = Image.open(ROOT / args.from_sheet if not Path(args.from_sheet).is_absolute()
                           else args.from_sheet)
        if args.dry_run:
            print(f"would slice {args.from_sheet} at {sheet.size}; no files written")
            return 0

    keyed = key_out(sheet, args.tol)
    boxes = components(keyed.split()[3], step=max(1, sheet.width // 256), min_side=args.min_side)
    if not boxes:
        raise SystemExit("found no shapes — the background may not have been keyed. "
                         "Try --tol 80, or check the sheet really has a flat background.")

    DECALS.mkdir(parents=True, exist_ok=True)
    for old in DECALS.glob("*.png"):          # a fresh slice replaces the last one
        old.unlink()

    manifest = {"sheet": str(args.from_sheet or SHEET.relative_to(ROOT)), "seed": seed,
                "prompt": args.prompt, "keyed_from": border_colour(sheet.convert("RGB")),
                "decals": {}}
    counts = collections.Counter()
    for box in boxes:
        x0, y0, x1, y1 = box
        piece = keyed.crop((x0, y0, x1 + 1, y1 + 1))
        scale = args.long_side / max(piece.size)
        if scale < 1:
            piece = piece.resize((max(1, round(piece.width * scale)),
                                  max(1, round(piece.height * scale))), Image.LANCZOS)
        kind = kind_of(piece.width, piece.height)
        counts[kind] += 1
        name = f"{kind}_{counts[kind]}"
        piece.save(DECALS / f"{name}.png", optimize=True)
        manifest["decals"][name] = {"kind": kind, "size": list(piece.size),
                                    "sheet_bbox": [x0, y0, x1, y1]}

    (DECALS / "decals.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                                        encoding="utf-8")
    placed = DECALS / "placement.json"
    if not placed.exists():
        placed.write_text(json.dumps(PLACE_DEFAULT, indent=2, sort_keys=True) + "\n",
                          encoding="utf-8")
        print(f"placement: wrote {placed.relative_to(ROOT)} — edit it, it is not overwritten")

    print(f"decals: {len(manifest['decals'])} pieces -> " +
          ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    for name, d in sorted(manifest["decals"].items()):
        print(f"  {name:12} {d['size'][0]:3}x{d['size'][1]:3}  {d['kind']}")
    print(f"next: python3 tools/place_decals.py --dry-run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
