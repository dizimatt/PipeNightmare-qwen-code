#!/usr/bin/env python3
"""Paste sliced decals onto the pipe frames. No credits, deterministic, repeatable.

    python3 tools/place_decals.py --dry-run    # where each piece would go
    python3 tools/place_decals.py              # write into assets/frames/ and repack
    python3 tools/place_decals.py --undo       # put the pristine frames back

Everything about the look comes from `assets/decals/` — which pieces exist, what
they are made of, how they are drawn. This script only decides *where* they sit,
from `assets/decals/placement.json`, which is yours to edit:

    default     caps and hangs per tile, scale, overlap, jitter, seed
    per_shape   overrides for one shape, e.g. {"pipe_ew": {"hangs": 5}}
    clear_joint_units   how much of each open end stays unobstructed
    border_px   keep art off the atlas padding

Three things are kept clear by construction rather than by luck, because they
are load-bearing and not cosmetic: the bore (the water sprite draws inside it, so
snow there would hide the fill), the last few units at each open end (a covered
opening reads as a blocked joint even when the joint works), and 2 px at the
frame edge (the atlas packs with padding, and art touching the border bleeds
into its neighbour).

Pieces are not rotated: snow sits up and icicles hang down in screen space,
which is what makes them read as weather rather than as decoration.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_assets as G  # noqa: E402  the tube geometry lives there

FRAMES = ROOT / "assets" / "frames"
BASE = FRAMES / "base"
DECALS = ROOT / "assets" / "decals"
PLACEMENT = DECALS / "placement.json"
MANIFEST = DECALS / "decals.json"


def load_config():
    if not PLACEMENT.exists():
        raise SystemExit(f"no {PLACEMENT.relative_to(ROOT)} — run make_decals.py first")
    return json.loads(PLACEMENT.read_text())


def load_pieces():
    if not MANIFEST.exists():
        raise SystemExit(f"no {MANIFEST.relative_to(ROOT)} — run make_decals.py first")
    info = json.loads(MANIFEST.read_text())["decals"]
    pieces = {}
    for name, d in info.items():
        path = DECALS / f"{name}.png"
        if path.exists():
            pieces[name] = (Image.open(path).convert("RGBA"), d["kind"])
    if not pieces:
        raise SystemExit("decals.json lists no files that exist; re-run make_decals.py")
    return pieces


def segments(shape):
    """The tube as straight runs in PNG pixels, each with the two faces it
    exposes: `up` is the face snow rests on, `down` the face icicles grow from.
    A vertical run has no up face, so left takes caps and right takes hangs —
    arbitrary, but the same arbitrary choice every run."""
    pts = [(x * G.SCALE, y * G.SCALE) for x, y in G.pipe_path(shape)]
    half = G.PIPE_OUTER / 2 * G.SCALE
    runs = []
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = (dx * dx + dy * dy) ** 0.5
        if length < 1:
            continue
        ux, uy = dx / length, dy / length
        n = (-uy, ux)
        if abs(n[1]) > 0.1:                      # one face points up, the other down
            up, down = (n, (-n[0], -n[1])) if n[1] < 0 else ((-n[0], -n[1]), n)
        else:                                    # vertical run: left and right
            up, down = ((-1.0, 0.0), (1.0, 0.0)) if n[0] < 0 else ((1.0, 0.0), (-1.0, 0.0))
        runs.append({"a": a, "b": b, "len": length, "up": up, "down": down})
        total += length
    return runs, total


def point_at(runs, dist):
    """The tube point `dist` pixels along the path, and the run it lies on."""
    for run in runs:
        if dist <= run["len"]:
            t = dist / run["len"]
            return run, (run["a"][0] + (run["b"][0] - run["a"][0]) * t,
                         run["a"][1] + (run["b"][1] - run["a"][1]) * t)
        dist -= run["len"]
    run = runs[-1]
    return run, run["b"]


def keepout(shape, clear, border):
    """Pixels no decoration may cover, for the tube as a whole rather than the
    one run a piece hangs off. Two reasons, both load-bearing:

      bore      the water sprite draws inside the channel, so snow or ice there
                hides the fill — and at a corner the other arm's bore sits right
                where a wide piece would overhang.
      edges     art reaching the middle of any edge reads as a connection. On an
                open end it hides the joint; on a closed end it invents one.
    """
    px = int(G.TILE * G.SCALE)
    mask = Image.new("L", (px, px), 0)
    d = ImageDraw.Draw(mask)
    pts = [(x * G.SCALE, y * G.SCALE) for x, y in G.pipe_path(shape)]
    d.line(pts, fill=255, width=int(G.PIPE_BORE_W * G.SCALE), joint="curve")

    tube = G.PIPE_OUTER * G.SCALE
    openings = {G.LETTER[i] for i in G.SHAPES[shape]}
    for side in "nesw":
        # An open end keeps its whole collar zone clear; a closed edge only
        # needs to not be *touched*, since a 46-unit tube in a 64-unit tile
        # leaves about nine units of sky and nothing fits in less than that.
        depth = clear if side in openings else border + 4
        if side == "n":
            d.rectangle((px / 2 - tube / 2, 0, px / 2 + tube / 2, depth), fill=255)
        elif side == "s":
            d.rectangle((px / 2 - tube / 2, px - depth, px / 2 + tube / 2, px), fill=255)
        elif side == "w":
            d.rectangle((0, px / 2 - tube / 2, depth, px / 2 + tube / 2), fill=255)
        else:
            d.rectangle((px - depth, px / 2 - tube / 2, px, px / 2 + tube / 2), fill=255)
    return mask


def fits(piece, pos, out):
    """Does any visible pixel of the piece land in a keep-out region?"""
    px, py = pos
    il = piece.split()[3].load()
    ol = out.load()
    size = out.width
    for j in range(piece.height):
        for i in range(piece.width):
            if il[i, j] > 40:
                x, y = px + i, py + j
                if not (0 <= x < size and 0 <= y < size) or ol[x, y]:
                    return False
    return True


def plan(shape, cfg, pieces, rng):
    """Where each chosen piece goes, as (name, image, top-left) inside the frame.

    Pieces are sized in frame pixels (`cap_size`, `hang_size`), not as a
    multiplier, so an artist can say "icicles about 20 pixels long" and get that
    whatever resolution the sheet was sliced at. If a piece would cover the bore
    or reach an edge, it is first nudged outward along its face, then shortened,
    and only then given up on — a shorter icicle near a tile edge is both the
    safe answer and the natural one.
    """
    runs, _ = segments(shape)
    if not runs:
        return [], [f"no tube path for shape {shape}"]

    frame_px = int(G.TILE * G.SCALE)
    clear = cfg["clear_joint_units"] * G.SCALE
    border = cfg["border_px"]
    reach_px = G.PIPE_OUTER / 2 * G.SCALE
    out = keepout(shape, clear, border)
    total = sum(r["len"] for r in runs)
    lo, hi = clear, total - clear
    if hi <= lo:
        return [], ["no room once the open ends are kept clear"]

    faces = {"up": ("cap", "clump"), "down": ("hang",)}
    placed, notes = [], []
    for face, count_key in (("up", "caps"), ("down", "hangs")):
        count = cfg[count_key]
        if count <= 0:
            continue
        pool = [(n, p) for n, p in pieces.items() if p[1] in faces[face]]
        if not pool:
            notes.append(f"no {face} pieces among the decals")
            continue
        size_key = "cap_size" if face == "up" else "hang_size"
        for i in range(count):
            name, (img, _kind) = pool[i % len(pool)]

            frac = (i + 1) / (count + 1)
            spacing = (hi - lo) / (count + 1)
            dist = lo + (hi - lo) * frac + rng.uniform(-1, 1) * cfg["jitter"] * spacing
            run, (cx, cy) = point_at(runs, min(hi, max(lo, dist)))
            nx, ny = run[face]

            spot = None
            for shrink in (1.0, 0.75, 0.55):
                w = max(1, round(img.width * cfg[size_key] / max(img.size) * shrink))
                h = max(1, round(img.height * cfg[size_key] / max(img.size) * shrink))
                for nudge in range(0, 9, 2):
                    reach = reach_px + h / 2 - cfg["overlap"] + nudge
                    x = int(max(border, min(frame_px - w - border,
                                            round(cx + nx * reach - w / 2))))
                    y = int(max(border, min(frame_px - h - border,
                                            round(cy + ny * reach - h / 2))))
                    scaled = img.resize((w, h), Image.LANCZOS)
                    if fits(scaled, (x, y), out):
                        spot = (scaled, (x, y), shrink, nudge)
                        break
                if spot:
                    break
            if not spot:
                notes.append(f"dropped {name} at slot {i + 1}: no room clear of the bore and edges")
                continue
            scaled, pos, shrink, nudge = spot
            if shrink < 1.0:
                notes.append(f"shortened {name} at slot {i + 1} to clear the tile edge")
            placed.append((name, scaled, pos))
    return placed, notes


def main():
    ap = argparse.ArgumentParser(description="place decals onto the pipe frames")
    ap.add_argument("targets", nargs="*", help="frame names (default: the config's targets)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, write nothing")
    ap.add_argument("--undo", action="store_true", help="restore the captured pristine frames")
    ap.add_argument("--recapture", action="store_true",
                    help="treat the current frames as the new base (after hand edits)")
    args = ap.parse_args()

    cfg_doc = load_config()
    pieces = load_pieces()

    if args.undo:
        if not BASE.exists():
            raise SystemExit(f"nothing captured in {BASE.relative_to(ROOT)} yet")
        for p in sorted(BASE.glob("*.png")):
            (FRAMES / p.name).write_bytes(p.read_bytes())
            print(f"restored {p.name}")
        print(f"atlas: packed {G.pack_frames_dir()} frames")
        return 0

    if args.recapture:
        BASE.mkdir(parents=True, exist_ok=True)
        for name in cfg_doc.get("targets", []):
            src = FRAMES / f"{name}.png"
            if src.exists():
                (BASE / src.name).write_bytes(src.read_bytes())
        print(f"base: recaptured from the current frames")

    targets = args.targets or cfg_doc.get("targets", [])
    missing = [n for n in targets if not (FRAMES / f"{n}.png").exists()]
    if missing:
        raise SystemExit(f"no such frame(s): {', '.join(missing)}")

    if not args.dry_run:
        BASE.mkdir(parents=True, exist_ok=True)
    changed = 0
    for name in targets:
        dest = BASE / f"{name}.png"
        if not dest.exists() and not args.dry_run:
            dest.write_bytes((FRAMES / f"{name}.png").read_bytes())
            print(f"  {name}: captured the pristine frame into frames/base/ "
                  f"(delete that file to re-capture after hand edits)")
        cfg = dict(cfg_doc["default"])
        cfg.update(cfg_doc.get("per_shape", {}).get(name, {}))
        for limit in ("clear_joint_units", "border_px"):
            cfg.setdefault(limit, cfg_doc[limit])   # top-level, but overridable per shape
        rng = random.Random(zlib.crc32(f"{name}:{cfg['seed']}".encode()))
        placed, notes = plan(name[5:], cfg, pieces, rng)

        if args.dry_run:
            print(f"  {name}: {len(placed)} decal(s)" +
                  ("  [" + "; ".join(notes) + "]" if notes else ""))
            for dname, img, (px, py) in placed:
                print(f"      {dname:12} {img.width}x{img.height} at {px},{py}")
            continue

        frame = Image.open(dest).convert("RGBA")
        for _dname, img, pos in placed:
            frame.alpha_composite(img, pos)
        frame.save(FRAMES / f"{name}.png", optimize=True)
        changed += 1
        print(f"  {name}: placed {len(placed)} decal(s)" +
              ("  [" + "; ".join(notes) + "]" if notes else ""))

    if args.dry_run:
        print("dry run: nothing written")
        return 0
    print(f"atlas: packed {G.pack_frames_dir()} frames from {changed} changed file(s)")
    print("hard-reload the browser (Ctrl+Shift+R) — PNGs are not cache-busted")
    print(f"to take them off again: python3 tools/place_decals.py --undo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
