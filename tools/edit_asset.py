#!/usr/bin/env python3
"""Ask an image model for an adjusted version of one asset, or a group of them.

    python3 tools/edit_asset.py pipe_ew --prompt "flaking orange rust, pitted metal"
    python3 tools/edit_asset.py --group pipes --prompt "frosted over with ice build-up"
    python3 tools/edit_asset.py pipe_ew pipe_ne source drain --prompt "..."

This is the image-editing call you would otherwise make by hand: it takes the
existing PNG as input, asks for the same thing adjusted, and hands the result
back at the frame's exact pixel size. Nothing else about the game changes.

By default the answer lands in `assets/proposals/<name>.png` so you can look at
it first. `--apply` writes it into `assets/frames/` instead and repacks the
atlas, which is the only way artwork reaches the game:

    python3 tools/edit_asset.py pipe_ew --prompt "..." --apply

Anything you do not like can be undone with git as long as `assets/frames/` is
committed:

    git checkout assets/frames/pipe_ew.png && python3 tools/generate_assets.py --pack-only

Two guards run on every result, because the model cannot be trusted with either:

  alpha    the model returns RGB with no transparency, so the original frame's
           alpha is put back. Without this the sprite gains a solid rectangle.
  bore     a pipe's dark interior is open at both ends, which makes it
           continuous with the background — measured on a live call, the model
           repaints it as scenery (silhouette IoU 0.53 against the original).
           For pipe frames the bore and a band around each open end are kept
           from the original pixels, using the same geometry the frames were
           drawn with.

The water frames are deliberately hard to edit here: their front has to land on
step/10 of the tile length, which is a checked property, so `--group water`
needs `--force` as well as `--apply`.

Needs the key in the environment; it is never written to a file:

    export QWENCLOUD_TOKEN_PLAN_API_KEY=...
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zlib
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_assets as G  # noqa: E402  the frame geometry lives there

BASE = "https://token-plan.maas.qwencloudapi.com"
ENDPOINT = BASE + "/api/v1/services/aigc/multimodal-generation/generation"
MODEL = "qwen-image-3.0-pro"
KEY_ENV = "QWENCLOUD_TOKEN_PLAN_API_KEY"
MAX_SIDE = 1024
OPAQUE_MIN = 240      # below this alpha the pixel is shadow, not surface
JOINT_UNITS = 4.0     # world units kept clear at each open end, so joints read

FRAMES = Path("assets/frames")
STANDALONE = {"title": "assets/title.png", "bg": "assets/bg.png", "favicon": "assets/favicon.png"}

GROUPS = {
    "pipes": lambda n: n.startswith("pipe_"),
    "hardware": lambda n: n.startswith("pipe_") or n in ("source", "drain"),
    "tiles": lambda n: n.startswith(("tile_", "cell_", "spill")),
    "ui": lambda n: n.startswith(("btn_", "slot_", "icon_", "panel")),
    "water": lambda n: n.startswith("water_"),
    "all": lambda n: True,
}

# What the model reliably keeps, measured: outer size, position and the open
# ends. What it does not keep is anything it can read as background.
PRESERVE = ("Adjust only what is asked above. Keep the object at exactly the same "
            "size, position, orientation and crop as the input image: the frame "
            "edges are the tile edges, and the openings at the edges must stay "
            "open and unobstructed. Flat solid background, no shadow, no text, "
            "no border.")
NEGATIVE = "text, watermark, logo, border, frame, drop shadow, extra objects, scenery, collage"


def frame_names():
    return sorted(p.stem for p in (ROOT / FRAMES).glob("*.png"))


def resolve(args):
    """Every frame the command asks for, in a stable order."""
    available = frame_names() + sorted(STANDALONE)
    picked = set()
    for name in args.names:
        if name in STANDALONE or (ROOT / FRAMES / f"{name}.png").exists():
            picked.add(name)
        else:
            raise SystemExit(f"no asset named {name!r}; try e.g. "
                             f"{', '.join(available[:6])} ... or --group <name>")
    for group in args.group or []:
        test = GROUPS[group]
        picked.update(n for n in available if test(n))
    if not picked:
        raise SystemExit("nothing to edit: give a frame name or --group")
    if any(n.startswith("water_") for n in picked) and not args.force:
        raise SystemExit("water_* frames carry the fill-front position that the asset "
                         "contract checks; pass --force if you really mean it")
    return sorted(picked)


def source_path(name):
    return ROOT / STANDALONE[name] if name in STANDALONE else ROOT / FRAMES / f"{name}.png"


def out_path(name, apply):
    if name in STANDALONE:
        return source_path(name) if apply else ROOT / "assets" / "proposals" / f"{name}.png"
    return ROOT / FRAMES / f"{name}.png" if apply else ROOT / "assets" / "proposals" / f"{name}.png"


def seed_for(name):
    """Stable per asset name, so the same frame and prompt start from the same
    place; pass --seed to re-roll deliberately."""
    return zlib.crc32(name.encode()) % 1_000_000


def request_size(w, h):
    """The model's size string, matching the source aspect, on a multiple of 8."""
    scale = MAX_SIDE / max(w, h)
    return f"{max(8, round(w * scale / 8) * 8)}*{max(8, round(h * scale / 8) * 8)}"


def generate(src, prompt, seed):
    key = os.environ.get(KEY_ENV)
    if not key:
        raise SystemExit(f"{KEY_ENV} is not set — export it first")
    up = src.resize((src.width * 4, src.height * 4), Image.LANCZOS) if src.width < 256 else src
    buf = io.BytesIO()
    up.convert("RGB").save(buf, format="PNG")
    data = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    text = f"{prompt}\n\n{PRESERVE}"
    body = {
        "model": MODEL,
        "input": {"messages": [{"role": "user", "content": [{"image": data}, {"text": text}]}]},
        "parameters": {"size": request_size(src.width, src.height), "n": 1, "seed": seed,
                       "watermark": False, "prompt_extend": False,
                       "negative_prompt": NEGATIVE},
    }
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} from {MODEL}: {e.read().decode('utf-8', 'replace')[:400]}")
    content = payload["output"]["choices"][0]["message"]["content"]
    url = next(item["image"] for item in content if "image" in item)
    with urllib.request.urlopen(url, timeout=120) as resp:  # the URL expires in about a day
        return Image.open(io.BytesIO(resp.read()))


def guards(src, edited, name):
    """Back to the frame's own size, then the original's alpha, then the
    original's pixels everywhere the model cannot be trusted.

    Three regions are kept from the source rather than the model:

      semi-transparent  the model has no alpha and paints its flat background
                        into the soft contact shadow, which shows straight
                        through a low-alpha pixel. Only near-opaque pixels are
                        allowed to change.
      bore              a pipe's dark interior is open at both ends, so it is
                        continuous with the background and gets repainted as
                        scenery.
      joint             the last few units at each open end, where the tube has
                        to stay clear to read as a connection.
    """
    out = edited.convert("RGB").resize(src.size, Image.LANCZOS)
    if src.mode != "RGBA":
        return Image.merge("RGBA", [*out.split(), Image.new("L", src.size, 255)])

    a = src.split()[3]
    keep = a.point(lambda v: 255 if v < OPAQUE_MIN else 0)
    if name.startswith("pipe_"):
        d = ImageDraw.Draw(keep)
        pts = [(x * G.SCALE, y * G.SCALE) for x, y in G.pipe_path(name[5:])]
        d.line(pts, fill=255, width=int(round(G.PIPE_BORE_W * G.SCALE)), joint="curve")
        for end, other in ((pts[0], pts[-1]), (pts[-1], pts[0])):
            dx, dy = other[0] - end[0], other[1] - end[1]
            length = (dx * dx + dy * dy) ** 0.5 or 1.0
            ux, uy = dx / length, dy / length
            half = JOINT_UNITS * G.SCALE / 2
            d.line([(end[0] - ux * half, end[1] - uy * half),
                    (end[0] + ux * half, end[1] + uy * half)],
                   fill=255, width=int(round(G.PIPE_OUTER * G.SCALE)))
    return ImageChops.composite(src, Image.merge("RGBA", [*out.split(), a]), keep)


def main():
    ap = argparse.ArgumentParser(description="get an adjusted version of an asset from the image model")
    ap.add_argument("names", nargs="*", help="frame names, e.g. pipe_ew source title bg")
    ap.add_argument("--group", action="append", choices=sorted(GROUPS),
                    help="every frame in a group (repeatable)")
    ap.add_argument("--prompt", required=True, help="what to change about it")
    ap.add_argument("--seed", type=int, help="fixed seed instead of one derived from the name")
    ap.add_argument("--apply", action="store_true",
                    help="write into assets/frames/ and repack, instead of assets/proposals/")
    ap.add_argument("--force", action="store_true", help="allow water_* frames")
    ap.add_argument("--dry-run", action="store_true", help="show what would be asked, call nothing")
    args = ap.parse_args()

    targets = resolve(args)
    where = str(FRAMES) if args.apply else "assets/proposals"
    print(f"{len(targets)} asset(s) -> {where}")
    if args.dry_run:
        for name in targets:
            src = Image.open(source_path(name))
            seed = args.seed if args.seed is not None else seed_for(name)
            print(f"  {name:20} {src.width}x{src.height}  size={request_size(src.width, src.height)}  "
                  f"seed={seed}")
        print(f"  prompt: {args.prompt}")
        print("dry run: no request sent")
        return 0

    (ROOT / "assets" / "proposals").mkdir(parents=True, exist_ok=True)
    for name in targets:
        src = Image.open(source_path(name)).convert("RGBA")
        seed = args.seed if args.seed is not None else seed_for(name)
        print(f"  {name}: asking {MODEL} ...", flush=True)
        result = guards(src, generate(src, args.prompt, seed), name)
        dest = out_path(name, args.apply)
        dest.parent.mkdir(parents=True, exist_ok=True)
        result.save(dest, optimize=True)
        changed = sum(ImageChops.difference(src, result).convert("L").histogram()[1:])
        print(f"  {name}: wrote {dest.relative_to(ROOT)} "
              f"({changed * 100 // (src.width * src.height)}% of pixels changed, alpha is the original's)")

    if args.apply and any(name not in STANDALONE for name in targets):
        print(f"atlas: packed {G.pack_frames_dir()} frames")
        print("hard-reload the browser (Ctrl+Shift+R) — PNGs are not cache-busted")
    else:
        print(f"look at assets/proposals/, then re-run with --apply to put them in the game")
    return 0


if __name__ == "__main__":
    sys.exit(main())
