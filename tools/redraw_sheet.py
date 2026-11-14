#!/usr/bin/env python3
"""Redesign a whole set of frames in ONE image-model call, by laying them out
as a sheet and cutting the answer back into individual frames.

    python3 tools/redraw_sheet.py --group pipes --prompt "an icy theme, frozen
        pipes with icicles and rime, two cartoonish bugs clinging to the metal"
    python3 tools/redraw_sheet.py --dry-run ...     # compose the sheet, send nothing
    python3 tools/redraw_sheet.py --from-sheet answer.png   # re-slice, 0 credits
    python3 tools/redraw_sheet.py ... --apply       # write into assets/frames/

Why a sheet: the gateway limits a request by *area*, not by how many things are
in it — 512x512 up to 2560x2560 pixels. Six frames in a 3x2 grid of 1024px
cells is 3072x2048, which fits, so one credit buys every frame the pixel budget
it would get from its own call. It also buys consistency: one picture, one
idea of what icy looks like, instead of six separate inventions.

What it costs you is per-frame re-rolling. If one cell comes back wrong, re-ask
for the whole sheet (1 credit) or edit just that frame with edit_asset.py.

Nothing here trusts the grid. The background is keyed by colour, the shapes are
detected wherever the model put them, and each one is matched to the slot it is
nearest. A cell that is missing, merged or ambiguous is reported, not guessed.

Two regions are still taken back from the original pixels, because they are the
frame contract rather than the artwork: the bore (water draws inside it) and the
collar zone at each open end (an opening covered by ice reads as a blocked
joint). Everything else, including the silhouette, is the model's — which is
the point, and the reason this does not use edit_asset.py's alpha guard.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_assets as G   # noqa: E402  tube geometry
import image_model as M       # noqa: E402
import make_decals as D       # noqa: E402  keying and blob detection

FRAMES = ROOT / "assets" / "frames"
PROPOSALS = ROOT / "assets" / "proposals"
SHEET = ROOT / "assets" / "redraw-sheet.png"
ANSWER = ROOT / "assets" / "redraw-answer.png"

# Two different ceilings apply, and only the tighter one matters in practice:
# the gateway's validator accepts any area up to 2560x2560, but an edit request
# (one that carries an input image) is rejected by the algo itself at 3072x2048
# with "InternalError.Algo: Invalid request", while 1024x1024 is known to work.
# The documented edit output cap is 2048x2048, so stay inside both.
MAX_AREA = 4_194_304          # 2048x2048
MAX_SIDE = 2048
BG = (255, 0, 255)

GROUPS = {
    "pipes": lambda n: n.startswith("pipe_"),
    "hardware": lambda n: n.startswith("pipe_") or n in ("source", "drain"),
    "tiles": lambda n: n.startswith(("tile_", "cell_", "spill")),
    "ui": lambda n: n.startswith(("btn_", "slot_", "icon_", "panel")),
}

INSTRUCTIONS = (
    "Redraw each separate object in this image in the style asked above. Keep "
    "every object in its own area of the grid, at the same position, size and "
    "orientation as before, and never merge two objects or connect them. Each "
    "object is a game sprite that touches the edges of its own cell where it "
    "already does: those open ends must stay open and unobstructed, and nothing "
    "may reach an edge that has no opening. Fill the rest with a flat solid "
    "magenta #FF00FF background. Keep the soft contact shadow that sits "
    "directly under each object. No grid lines, no borders, no text."
)
NEGATIVE = ("grid lines, borders, frame, divider, text, watermark, logo, "
            "background scenery, merged objects, extra objects")


def targets_for(args):
    available = sorted(p.stem for p in FRAMES.glob("*.png"))
    picked = list(args.names)
    for group in args.group or []:
        picked += [n for n in available if GROUPS[group](n)]
    unknown = [n for n in picked if n not in available]
    if unknown:
        raise SystemExit(f"no such frame(s): {', '.join(sorted(set(unknown)))}")
    if not picked:
        raise SystemExit("nothing to redraw: give frame names or --group")
    return sorted(set(picked))


def layout(n, cell):
    """A grid of `cell`-sized slots inside both ceilings, as (cell, cols, rows).
    Cells shrink before the grid shape does."""
    cols = max(1, math.ceil(math.sqrt(n)))
    rows = math.ceil(n / cols)
    while (cols * cell > MAX_SIDE or rows * cell > MAX_SIDE
           or cols * cell * rows * cell > MAX_AREA) and cell > 256:
        cell -= 8
    return cell, cols, rows


def compose(names, cell, margin=0.10, base=None):
    """Lay the frames out on a magenta sheet.

    `base` supplies the pixels to start from. Passing the freshly drawn steel
    frames means the model is given the *shape* and not the current palette —
    feed it copper and it will happily paint ice over copper and call it done.
    """
    cell, cols, rows = layout(len(names), cell)
    sheet = Image.new("RGB", (cols * cell, rows * cell), BG)
    inner = round(cell * (1 - margin))
    for i, name in enumerate(names):
        img = (base[name] if base and name in base else
               Image.open(FRAMES / f"{name}.png")).convert("RGBA")
        scale = inner / max(img.size)
        art = img.resize((max(1, round(img.width * scale)),
                          max(1, round(img.height * scale))), Image.LANCZOS)
        col, row = i % cols, i // cols
        ox = col * cell + (cell - art.width) // 2
        oy = row * cell + (cell - art.height) // 2
        sheet.paste(art, (ox, oy), art)
    return sheet, cell, cols, rows


def contract_masks(name, size):
    """Three regions, treated differently, because only the structure is
    contract and the colour belongs to the artist or the model:

      bore    keep the original's darkness and alpha so the water channel still
              reads, but take the model's hue — restoring colour here is what
              gave an icy pipe a brown interior
      ends    keep the original's alpha only, so the tube still crosses the
              edge it is declared to; the metal's look stays the model's
      closed  erase, because art reaching a closed edge reads as a stub

    Returns (bore, ends, closed); all empty for a frame that is not a pipe.
    """
    empty = Image.new("L", size, 0)
    if not name.startswith("pipe_"):
        return empty, empty.copy(), empty.copy()
    k = size[0] / G.TILE
    pts = [(x * k, y * k) for x, y in G.pipe_path(name[5:])]

    bore = Image.new("L", size, 0)
    d = ImageDraw.Draw(bore)
    d.line(pts, fill=255, width=int(round(G.PIPE_BORE_W * k)), joint="curve")

    ends = Image.new("L", size, 0)
    d = ImageDraw.Draw(ends)
    for a, b in ((pts[0], pts[1]), (pts[-1], pts[-2])):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1.0
        reach = 4.0 * k
        d.line([a, (a[0] + dx / length * reach, a[1] + dy / length * reach)],
               fill=255, width=int(round(G.PIPE_OUTER * k)))

    px = size[0]
    closed = Image.new("L", size, 0)
    d = ImageDraw.Draw(closed)
    band = 4 * k
    openings = {G.LETTER[i] for i in G.SHAPES[name[5:]]}
    # the whole side, not just the tube's width: an icicle can reach a closed
    # edge beside the pipe, and that still reads as a connection
    for side in "nesw":
        if side in openings:
            continue
        if side == "n":
            d.rectangle((0, 0, px, band), fill=255)
        elif side == "s":
            d.rectangle((0, px - band, px, px), fill=255)
        elif side == "w":
            d.rectangle((0, 0, band, px), fill=255)
        else:
            d.rectangle((px - band, 0, px, px), fill=255)
    return bore, ends, closed


def cut(sheet, names, cell, cols, mode="replace", margin=0.10):
    """Rebuild each frame from its cell.

    The crop is the cell's own square, never the detected bounding box: the
    frame maps 1:1 onto that square, so cropping to where the shape *ended up*
    would stretch it and move the openings. Blob detection is used only to
    check that something landed in the slot and that two neighbours did not
    merge into one shape.
    """
    keyed = D.key_out(sheet)
    alpha = keyed.split()[3]
    boxes = D.components(alpha, step=max(1, sheet.width // 512), min_side=12)

    inner = round(cell * (1 - margin))
    off = (cell - inner) // 2
    out, report = {}, []
    for i, name in enumerate(names):
        original = Image.open(FRAMES / f"{name}.png").convert("RGBA")
        col, row = i % cols, i // cols
        x0, y0 = col * cell + off, row * cell + off
        box = (x0, y0, x0 + inner, y0 + inner)

        # how much of this cell the model actually drew in
        filled = sum(1 for y in range(y0, min(y0 + inner, sheet.height))
                     for x in range(x0, min(x0 + inner, sheet.width)) if alpha.getpixel((x, y)))
        frac = filled / (inner * inner)
        # any detected shape whose centre is not in this cell but reaches into it
        merged = [b for b in boxes
                  if not (x0 - off <= (b[0] + b[2]) / 2 <= x0 + inner + off
                          and y0 - off <= (b[1] + b[3]) / 2 <= y0 + inner + off)
                  and b[0] < x0 + inner and b[2] > x0 and b[1] < y0 + inner and b[3] > y0]

        piece = keyed.crop(box).resize(original.size, Image.LANCZOS)
        clipped = 0
        if mode == "blend":
            pa = piece.split()[3]
            drew = pa.point(lambda v: 255 if v > 24 else 0)

            # keep the model's shape and the original's soft contact shadow,
            # but not the old opaque metal that used to sit underneath
            soft = original.split()[3].point(lambda v: v if v < 240 else 0)
            a = ImageChops.lighter(pa, soft)
            rgb = ImageChops.composite(piece.convert("RGB"), original.convert("RGB"), drew)

            if name.startswith("pipe_"):
                before = a
                bore, ends, closed = contract_masks(name, original.size)
                # the channel must stay as dark as it was or the cyan water
                # stops reading; one brightness factor keeps the model's hue
                lum_o = ImageStat.Stat(original.convert("RGB").convert("L"), mask=bore).mean[0]
                lum_m = ImageStat.Stat(rgb.convert("L"), mask=bore).mean[0] or 1.0
                gain = Image.new("L", original.size, max(0, min(255, round(lum_o * 255 / lum_m))))
                dark = Image.merge("RGB", [ImageChops.multiply(ch, gain) for ch in rgb.split()])
                rgb = ImageChops.composite(dark, rgb, bore)
                a = ImageChops.composite(original.split()[3], a, bore)
                a = ImageChops.composite(original.split()[3], a, ends)
                rgb = ImageChops.composite(original.convert("RGB"), rgb, closed)
                a = ImageChops.composite(original.split()[3], a, closed)
                b0, af = before.load(), a.load()
                clipped = sum(1 for y in range(original.height) for x in range(original.width)
                              if af[x, y] < b0[x, y])
            result = Image.merge("RGBA", [*rgb.split(), a])
        else:
            # replace: the model owns every pixel, including the silhouette, so
            # nothing of the old palette survives. Nothing is repaired here —
            # a bad answer is not a bug to patch around, it is a re-roll. The
            # checks in verify() exist to tell you when to take that option.
            result = piece

        out[name] = result
        changed = sum(ImageChops.difference(original, result).convert("L").histogram()[1:])
        oa, ra = original.split()[3].load(), result.split()[3].load()
        grew = sum(1 for y in range(original.height) for x in range(original.width)
                   if ra[x, y] > oa[x, y])
        note = f"{frac * 100:.0f}% of cell drawn, +{grew} new silhouette px"
        if clipped:
            note += f", {clipped} px clipped at a closed edge"
        if frac < 0.02:
            note += " | CELL LOOKS EMPTY"
        if merged:
            note += f" | {len(merged)} shape(s) reaching in from a neighbour"
        report.append((name, f"{inner}px cell",
                       f"{changed * 100 // (original.width * original.height)}% changed", note))
    return out, report


def verify(name, img):
    """What the answer has to satisfy. In replace mode nothing is repaired any
    more, so these are the only protection left and a failure means re-roll."""
    verdicts = []
    if not name.startswith("pipe_"):
        return verdicts
    opens = {G.LETTER[i] for i in G.SHAPES[name[5:]]}
    px = img.width
    probe = {'n': (px // 2, 3), 'e': (px - 6, px // 2), 's': (px // 2, px - 6), 'w': (3, px // 2)}
    bad = [d for d, p in probe.items() if (img.getpixel(p)[3] > 128) != (d in opens)]
    verdicts.append("openings OK" if not bad else "OPENINGS BROKEN at " + ",".join(bad))

    # the cyan water reads against a dark channel; if the model lit the bore
    # up, the fill animation disappears behind it
    bore = contract_masks(name, img.size)[0]
    lum = round(ImageStat.Stat(img.convert("RGB").convert("L"), mask=bore).mean[0])
    verdicts.append(f"bore luma {lum}" + ("" if lum < 90 else " | BORE TOO BRIGHT for the water"))

    # the midpoint probe above only samples one pixel per edge; art anywhere
    # along a closed edge still reads as a connection, so count the whole line
    a = img.split()[3]
    leaks = []
    for side in "nesw":
        if side in opens:
            continue
        line = ([a.getpixel((x, 2)) for x in range(px)] if side == "n" else
                [a.getpixel((x, px - 3)) for x in range(px)] if side == "s" else
                [a.getpixel((2, y)) for y in range(px)] if side == "w" else
                [a.getpixel((px - 3, y)) for y in range(px)])
        hit = sum(1 for v in line if v > 128)
        if hit:
            leaks.append(f"{side}:{hit}")
    if leaks:
        verdicts.append("ART LEAKING ONTO CLOSED EDGES at " + ", ".join(leaks))
    return verdicts


def main():
    ap = argparse.ArgumentParser(description="redesign a set of frames in one model call")
    ap.add_argument("names", nargs="*", help="frame names (default: none)")
    ap.add_argument("--group", action="append", choices=sorted(GROUPS), help="a set of frames")
    ap.add_argument("--prompt", help="the new look (not needed with --from-sheet)")
    ap.add_argument("--cell", type=int, default=1024, help="slot size in the sheet, px")
    ap.add_argument("--seed", type=int, help="fixed seed instead of one from the prompt")
    ap.add_argument("--from-sheet", metavar="PATH", help="slice an existing answer, 0 credits")
    ap.add_argument("--base", choices=("steel", "current"), default="steel",
                    help="what the sheet starts from: the drawn shape, or the look you have now")
    ap.add_argument("--blend", action="store_true",
                    help="keep the old artwork under the model's, and restore bore, collars "
                         "and closed edges from it (it also keeps the old palette)")
    ap.add_argument("--apply", action="store_true", help="write into assets/frames/ and repack")
    ap.add_argument("--dry-run", action="store_true", help="compose the sheet, call nothing")
    args = ap.parse_args()

    names = targets_for(args)
    if not args.prompt and not args.from_sheet:
        raise SystemExit("--prompt is required (or pass --from-sheet to re-slice an answer)")
    seed = args.seed if args.seed is not None else \
        zlib.crc32((args.prompt or "").encode()) % 1_000_000

    if args.from_sheet:
        path = Path(args.from_sheet)
        source = Image.open(path if path.is_absolute() else ROOT / path)
        cell, cols, rows = layout(len(names), args.cell)
    else:
        # steel by default: show the model the shape, not the palette it is
        # meant to replace. Feed it copper and it keeps the copper.
        base = None if args.base == "current" else G.build_atlas_frames()
        source, cell, cols, rows = compose(names, args.cell, base=base)
        print(f"sheet: {source.size[0]}x{source.size[1]} = {source.size[0]*source.size[1]} px "
              f"(caps: side {MAX_SIDE}, area {MAX_AREA}) — {len(names)} frames in "
              f"{cols}x{rows} of {cell}px, from {args.base}")

    if args.dry_run:
        PROPOSALS.mkdir(parents=True, exist_ok=True)
        source.save(SHEET, optimize=True)
        print(f"dry run: wrote the request image to {SHEET.relative_to(ROOT)}; nothing sent")
        print(f"  prompt: {args.prompt}\n          {INSTRUCTIONS}")
        print(f"  targets: {', '.join(names)}")
        return 0

    if not args.from_sheet:
        PROPOSALS.mkdir(parents=True, exist_ok=True)
        source.save(SHEET, optimize=True)
        print(f"asking {M.MODEL} to redraw {len(names)} frames in one image (1 credit) ...",
              flush=True)
        answer = M.generate(f"{args.prompt}. {INSTRUCTIONS}", seed,
                            f"{source.width}*{source.height}", image=source, negative=NEGATIVE)
        answer.save(ANSWER, optimize=True)
        print(f"answer: saved to {ANSWER.relative_to(ROOT)}")
        sheet = answer.convert("RGB")
    else:
        sheet = source.convert("RGB")

    results, report = cut(sheet, names, cell, cols, mode="blend" if args.blend else "replace")
    PROPOSALS.mkdir(parents=True, exist_ok=True)
    dest_dir = FRAMES if args.apply else PROPOSALS

    print(f"\n{len(results)} of {len(names)} frames rebuilt"
          f" -> {'assets/frames' if args.apply else 'assets/proposals'}"
          f" ({'blended over the old art' if args.blend else 'replaced outright'})")
    for name, size, change, note in report:
        verdicts = verify(name, results[name]) if name in results else ["NOT REBUILT"]
        print(f"  {name:14} {size:12} {change:14} {' | '.join(verdicts)}")
        print(f"      {note}")
        if any(v.startswith(("OPENINGS BROKEN", "BORE TOO BRIGHT", "ART LEAKING")) for v in verdicts):
            print("      ^ replace mode repairs no pixels: re-roll the sheet, narrow the "
                  "prompt to what failed, or fix that cell in the answer and re-slice")

    for name, img in results.items():
        img.save(dest_dir / f"{name}.png", optimize=True)

    if args.apply:
        print(f"atlas: packed {G.pack_frames_dir()} frames")
        print("hard-reload the browser (Ctrl+Shift+R) — PNGs are not cache-busted")
        print("to put the old artwork back: git checkout assets/frames/<name>.png"
              " then python3 tools/generate_assets.py --pack-only")
    else:
        print(f"\nlook at {PROPOSALS.relative_to(ROOT)}/, then re-run with --apply. To re-slice"
              f" this same answer without paying again: --from-sheet {ANSWER.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
