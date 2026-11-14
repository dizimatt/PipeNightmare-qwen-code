#!/usr/bin/env python3
"""Offline asset generator for Pipe Nightmare (R-008).

    python3 tools/generate_assets.py

This is a bootstrap step: it draws every graphic once into `assets/frames/` as
an individual PNG, then packs those files into `assets/atlas.png`. From then on
the loose PNGs are the artwork — edit one by hand, or ask an image model for an
adjusted version with `tools/edit_asset.py` — and re-running this script leaves
existing frames alone. `assets/atlas.png` and `assets/atlas.json` are derived:
never edit them, they are rebuilt from `frames/` on every run.

    python3 tools/generate_assets.py --pack-only    # just repack what is in frames/
    python3 tools/generate_assets.py --force        # redraw frames that already exist

Nothing is drawn by browser JS at runtime; Phaser just loads the packed atlas.
Pillow is an authoring-time dependency only; the game does not need it.

Skins
-----
    python3 tools/generate_assets.py --skin copper

`--skin` names a directory of material swatches under `assets/skins/` (or a
path to one), produced offline by `tools/fetch_skin.py`. A swatch only
supplies hue and grain: the frame's own shading and alpha are kept, so
silhouettes, edge openings and every frame key are untouched. Frames whose
group has no swatch keep their procedural colours.

Resolution model
----------------
The game world stays measured in 64-unit tiles, so no layout or logic
constant changes. SCALE is how many PNG pixels one world unit becomes: at
SCALE=2 a tile frame is 128x128 and the game draws it at 0.5 scale. SS is an
extra supersample used only while drawing and then removed by a LANCZOS
resize, which is what makes edges and gradients smooth instead of stepped.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"

TILE = 64          # world units; must match GameScene.js TILE
SCALE = 2          # PNG pixels per world unit
SS = 2             # extra supersample while drawing, removed on save
K = SCALE * SS     # multiply a world-unit coordinate by this to place it

ATLAS_W = 2048
ATLAS_H = 2048
PAD = 2
FILL_STEPS = 10

# ---------------------------------------------------------------- palette
INK = (8, 14, 26)
SLATE = (15, 24, 40)
GRID_MINOR = (31, 48, 74)
GRID_MAJOR = (44, 68, 102)

# Space-age metal: cool steel with a lavender cast.
SHELL_DARK = (17, 24, 38)
SHELL_MID = (44, 56, 78)
SHELL_LIGHT = (96, 114, 146)
RIM = (150, 170, 204)
RIM_BRIGHT = (196, 214, 240)
BORE = (9, 15, 27)
BORE_DEEP = (5, 9, 17)
COLLAR = (126, 146, 182)

WATER_EDGE = (14, 92, 128)
WATER_BODY = (34, 190, 226)
WATER_CORE = (150, 236, 252)
WATER_GLOW = (56, 214, 244)

BLOCK_BASE = (46, 24, 32)
BLOCK_STRIPE = (122, 44, 56)
BLOCK_EDGE = (186, 82, 96)

CHROME = (176, 192, 214)
CHROME_DARK = (72, 88, 116)
CHROME_DEEP = (38, 50, 70)
RUBBER = (28, 34, 48)
BUCKET = (98, 118, 152)
BUCKET_DARK = (52, 64, 86)
BUCKET_LIP = (166, 186, 214)

PANEL = (19, 31, 52)
PANEL_EDGE = (52, 82, 122)
BTN = (30, 48, 78)
BTN_HOVER = (43, 68, 108)
BTN_DISABLED = (22, 30, 44)
BTN_DANGER = (88, 38, 48)
BTN_SUCCESS = (24, 84, 68)

ICON_INK = (210, 228, 246)

# ---------------------------------------------------------------- geometry
N, E, S, W = 0, 1, 2, 3
LETTER = ["n", "e", "s", "w"]
CENTER = (TILE / 2, TILE / 2)
EDGE_MID = {N: (32, 0), E: (64, 32), S: (32, 64), W: (0, 32)}

# Keys match shapeKey() in src/logic/pieces.js, which sorts the two openings
# by direction index. These six are the only pipe graphics the game needs.
SHAPES = {
    "ew": [W, E],
    "ns": [N, S],
    "ne": [N, E],
    "es": [E, S],
    "sw": [S, W],
    "nw": [N, W],
}


def lerp(a, b, t):
    """Colour stop -> rounded rgb triple."""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def mix(a, b, t):
    """Point -> float xy, keeping full precision."""
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def ramp(stops, t):
    """stops: [(position, rgb), ...] ascending by position."""
    if t <= stops[0][0]:
        return stops[0][1]
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        if t <= p1:
            f = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return lerp(c0, c1, f)
    return stops[-1][1]


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def canvas(units=TILE):
    return Image.new("RGBA", (int(units * K), int(units * K)), (0, 0, 0, 0))


def finish(img, units=TILE):
    """Down to output resolution: units * SCALE pixels."""
    return img.resize((int(units * SCALE), int(units * SCALE)), Image.LANCZOS)


def stroke(draw, pts, width, color, factor=K, caps=True):
    if len(pts) < 2:
        return
    scaled = [(x * factor, y * factor) for x, y in pts]
    draw.line(scaled, fill=color, width=int(round(width * factor)), joint="curve")
    if not caps:
        return
    r = width * factor / 2
    for x, y in (scaled[0], scaled[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def dot(d, x, y, r, color, factor=K):
    d.ellipse(((x - r) * factor, (y - r) * factor, (x + r) * factor, (y + r) * factor), fill=color)


def ring(d, box, color, width, factor=K):
    d.ellipse([v * factor for v in box], outline=color, width=max(1, int(width * factor)))


def arc(d, box, start, end, color, width, factor=K):
    d.arc([v * factor for v in box], start, end, fill=color, width=max(1, int(width * factor)))


def poly(d, pts, color, factor=K):
    d.polygon([(x * factor, y * factor) for x, y in pts], fill=color)


def rect(d, box, color, radius=0, factor=K, outline=None, width=1):
    b = [v * factor for v in box]
    r = radius * factor
    if color is not None:
        d.rounded_rectangle(b, radius=r, fill=color)
    if outline is not None:
        d.rounded_rectangle(b, radius=r, outline=outline, width=max(1, int(width * factor)))


# ---------------------------------------------------------------- pipes
def pipe_path(shape_key, entry=None):
    """Edge midpoint -> centre -> edge midpoint. Always TILE units long."""
    openings = SHAPES[shape_key]
    if entry is None:
        return [EDGE_MID[openings[0]], CENTER, EDGE_MID[openings[1]]]
    other = next(d for d in openings if d != entry)
    return [EDGE_MID[entry], CENTER, EDGE_MID[other]]


def subpolyline(pts, dist):
    """The travelled part of the path. Stops dead on a vertex rather than
    repeating it, because PIL draws a round joint blob at any duplicate."""
    out = [pts[0]]
    remaining = dist
    for i in range(1, len(pts)):
        if remaining <= 1e-9:
            break
        ax, ay = pts[i - 1]
        bx, by = pts[i]
        seg = math.hypot(bx - ax, by - ay)
        if seg <= 1e-9:
            continue
        if remaining >= seg:
            out.append(pts[i])
            remaining -= seg
        else:
            t = remaining / seg
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
            remaining = 0
    return out


# Outer shell edge -> bore centre. Many thin bands rather than four flat ones:
# this is a distance-from-centreline gradient, so the wall reads as round.
PIPE_STOPS = [
    (0.00, SHELL_DARK),
    (0.14, SHELL_MID),
    (0.34, SHELL_LIGHT),
    (0.48, RIM_BRIGHT),
    (0.58, RIM),
    (0.70, SHELL_MID),
    (0.80, CHROME_DEEP),
    (0.88, BORE),
    (1.00, BORE_DEEP),
]
PIPE_OUTER = 46.0
PIPE_BORE_W = 22.0
PIPE_BANDS = 44


def draw_pipe(shape_key):
    img = canvas()
    d = ImageDraw.Draw(img)
    path = pipe_path(shape_key)

    stroke(d, [(x, y + 2.2) for x, y in path], PIPE_OUTER + 6, rgba((4, 7, 14), 150))

    # Coupling collars just inside each open end, so joints read as joints.
    for end in (path[0], path[-1]):
        stroke(d, [end, mix(end, CENTER, 8.0 / TILE)], PIPE_OUTER + 5, rgba(COLLAR, 255))
        stroke(d, [mix(end, CENTER, 6.0 / TILE), mix(end, CENTER, 9.0 / TILE)],
               PIPE_OUTER + 6, rgba(SHELL_DARK, 255))

    for i in range(PIPE_BANDS):
        t = i / (PIPE_BANDS - 1)
        width = PIPE_OUTER - (PIPE_OUTER - PIPE_BORE_W) * t
        stroke(d, path, width, rgba(ramp(PIPE_STOPS, t), 255))

    stroke(d, path, 23.5, rgba(WATER_GLOW, 40))
    stroke(d, path, 21.5, rgba(BORE, 255))
    return finish(img)


# Bands are painted widest first, so whatever sits at t=1.0 is what the
# centreline shows. Water must end bright: a lit tube seen through its
# middle. Ending on the dark edge colour is what made the whole core read
# dark and left the meniscus as the only bright mark on a finished tile.
WATER_STOPS = [
    (0.00, WATER_EDGE),
    (0.30, WATER_BODY),
    (0.62, WATER_CORE),
    (1.00, (196, 246, 255)),
]
WATER_OUTER = 20.0


def draw_water(shape_key, entry, step):
    """Water that has travelled step/FILL_STEPS of the way through the tile.
    The front must land exactly on that fraction, so ends are butt-cut."""
    full = pipe_path(shape_key, entry)
    dist = (TILE * step) / FILL_STEPS
    head = subpolyline(full, dist)

    glow = canvas()
    stroke(ImageDraw.Draw(glow), head, 30, rgba(WATER_GLOW, 110), caps=False)
    glow = glow.filter(ImageFilter.GaussianBlur(7 * K / 2))

    img = canvas()
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)

    bands = 18
    for i in range(bands):
        t = i / (bands - 1)
        width = WATER_OUTER - (WATER_OUTER - 5.0) * t
        stroke(d, head, width, rgba(ramp(WATER_STOPS, t), 235), caps=False)
    return finish(img)


# ---------------------------------------------------------------- source: a tap
def draw_source():
    """A wall-mounted faucet, spout aimed east, a drop hanging ready to go."""
    img = canvas()
    d = ImageDraw.Draw(img)

    # Wall flange the tap is bolted to, at the left edge.
    stroke(d, [(9, 14), (9, 50)], 13, rgba(CHROME_DEEP, 255))
    stroke(d, [(9, 16), (9, 48)], 9, rgba(CHROME, 255))
    for y in (20, 32, 44):
        dot(d, 9, y, 2.4, rgba(SHELL_DARK, 255))

    # Horizontal body.
    stroke(d, [(9, 32), (27, 32)], 20, rgba(CHROME_DARK, 255))
    stroke(d, [(9, 32), (27, 32)], 16, rgba(CHROME, 255))
    stroke(d, [(9, 30), (27, 30)], 6, rgba(RIM_BRIGHT, 190))

    # Spout narrowing toward the mouth.
    stroke(d, [(27, 32), (50, 32)], 17, rgba(CHROME_DARK, 255))
    stroke(d, [(27, 32), (50, 32)], 13, rgba(CHROME, 255))
    stroke(d, [(27, 30), (50, 30)], 5, rgba(RIM_BRIGHT, 170))

    # Mouth collar and the dark opening.
    stroke(d, [(48, 32), (54, 32)], 19, rgba(CHROME_DARK, 255))
    stroke(d, [(49, 32), (53, 32)], 15, rgba(BUCKET_LIP, 255))
    dot(d, 54, 32, 5.5, rgba(BORE_DEEP, 255))

    # Valve wheel on a short stem above the body.
    stroke(d, [(24, 24), (24, 28)], 7, rgba(CHROME_DARK, 255))
    ring(d, (15, 6, 33, 24), rgba(CHROME_DARK, 255), 4.5)
    ring(d, (17.5, 8.5, 30.5, 21.5), rgba(CHROME, 255), 2)
    for a in (0, 90, 180, 270):
        rad = math.radians(a)
        stroke(d, [(24 + math.cos(rad) * 4, 15 + math.sin(rad) * 4),
                   (24 + math.cos(rad) * 8.5, 15 + math.sin(rad) * 8.5)],
               2.6, rgba(CHROME, 255))
    dot(d, 24, 15, 2.2, rgba(RIM_BRIGHT, 255))

    # A drop forming at the mouth.
    poly(d, [(58, 33), (55.2, 40), (60.8, 40)], rgba(WATER_BODY, 240))
    dot(d, 58, 41, 3.6, rgba(WATER_BODY, 245))
    dot(d, 57, 40, 1.3, rgba(WATER_CORE, 250))
    return finish(img)


# ---------------------------------------------------------------- drain: a bucket
def draw_drain():
    """A bucket waiting under the flow; water arrives from the left."""
    img = canvas()
    d = ImageDraw.Draw(img)

    top, bottom = 27, 55
    tl, tr = 13, 51
    bl, br = 19, 45

    # Handle arcing over the mouth.
    arc(d, (tl + 3, top - 17, tr - 3, top + 13), 180, 360, rgba(CHROME_DARK, 255), 3.6)
    arc(d, (tl + 4, top - 16, tr - 4, top + 12), 180, 360, rgba(CHROME, 255), 1.6)

    # Body, shaded across its width so it reads as round.
    poly(d, [(tl, top), (tr, top), (br, bottom), (bl, bottom)], rgba(BUCKET_DARK, 255))
    for i in range(18):
        t = i / 17
        x0 = tl + (tr - tl) * t
        x1 = bl + (br - bl) * t
        col = ramp([(0.0, BUCKET_DARK), (0.38, BUCKET), (0.62, BUCKET_LIP), (1.0, BUCKET_DARK)], t)
        d.line([(x0 * K, top * K), (x1 * K, bottom * K)], fill=rgba(col, 255),
               width=max(1, int(2.4 * K)))

    # Rubber foot and a reinforcing band.
    rect(d, (bl - 1, bottom - 3, br + 1, bottom + 3), rgba(RUBBER, 255), radius=3)
    d.line([(tl + 1.5) * K, (top + 8) * K, (tr - 1.5) * K, (top + 8) * K],
           fill=rgba(CHROME_DEEP, 180), width=max(1, int(1.6 * K)))

    # Rim and the dark opening.
    d.ellipse([(tl - 2) * K, (top - 7) * K, (tr + 2) * K, (top + 7) * K], fill=rgba(BUCKET_LIP, 255))
    d.ellipse([(tl + 1) * K, (top - 4.6) * K, (tr - 1) * K, (top + 4.6) * K], fill=rgba(BORE_DEEP, 255))
    arc(d, (tl + 1, top - 4.6, tr - 1, top + 4.6), 200, 340, rgba(CHROME, 170), 1.6)

    # Water already sitting in the bottom, so it reads as a receptacle.
    poly(d, [(bl + 2, bottom - 9), (br - 2, bottom - 9), (br - 1, bottom - 4), (bl + 1, bottom - 4)],
         rgba(WATER_BODY, 210))

    # Incoming flow arrow at mouth height.
    stroke(d, [(2, 32), (9, 32)], 5, rgba(WATER_GLOW, 215), caps=False)
    poly(d, [(9, 26.5), (9, 37.5), (16, 32)], rgba(WATER_GLOW, 235))
    return finish(img)


# ---------------------------------------------------------------- tiles
def draw_empty_cell():
    size = int(TILE * SCALE)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m, r = 3 * SCALE, int(9 * SCALE)
    d.rounded_rectangle((m, m, size - m - 1, size - m - 1), radius=r, fill=rgba(SLATE, 255))
    d.rounded_rectangle((m, m, size - m - 1, size - m - 1), radius=r,
                        outline=rgba(GRID_MINOR, 255), width=SCALE)
    d.line((m + 2 * SCALE, m + SCALE, size - m - 2 * SCALE, m + SCALE),
           fill=(255, 255, 255, 16), width=SCALE)
    d.line((m + 2 * SCALE, size - m - 2 * SCALE, size - m - 2 * SCALE, size - m - 2 * SCALE),
           fill=(0, 0, 0, 70), width=SCALE)
    return img


def draw_blocked():
    size = int(TILE * SCALE)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m, r = 2 * SCALE, int(9 * SCALE)
    box = (m, m, size - m - 1, size - m - 1)
    d.rounded_rectangle(box, radius=r, fill=rgba(BLOCK_BASE, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=r, fill=255)
    stripes = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripes)
    step = 16 * SCALE
    for offset in range(-size, size * 2, step):
        sd.line((offset, size, offset + size, 0), fill=rgba(BLOCK_STRIPE, 255), width=int(7 * SCALE))
    img.paste(stripes, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=r, outline=rgba(BLOCK_EDGE, 255), width=2 * SCALE)
    return img


def draw_cell_hover():
    size = int(TILE * SCALE)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = 4 * SCALE
    d.rounded_rectangle((m, m, size - m - 1, size - m - 1), radius=int(9 * SCALE),
                        outline=rgba(WATER_GLOW, 215), width=3 * SCALE)
    d.rounded_rectangle((m + SCALE, m + SCALE, size - m - 1 - SCALE, size - m - 1 - SCALE),
                        radius=int(8 * SCALE), outline=(255, 255, 255, 45), width=SCALE)
    return img


def draw_spill():
    img = canvas()
    glow = canvas()
    dot(ImageDraw.Draw(glow), 32, 32, 15, rgba(WATER_GLOW, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(9 * K / 2))
    img.alpha_composite(glow)

    d = ImageDraw.Draw(img)
    dot(d, 32, 32, 8, rgba(WATER_CORE, 235))
    for i in range(9):
        a = math.pi * 2 * i / 9 + 0.2
        r0, r1 = 11, 17 + (i % 3) * 2.5
        stroke(d, [(32 + math.cos(a) * r0, 32 + math.sin(a) * r0),
                   (32 + math.cos(a) * r1, 32 + math.sin(a) * r1)],
               3.5, rgba(WATER_CORE, 220))
    return finish(img)


# ---------------------------------------------------------------- ui
def nine_slice(units=48, radius=12, fill=PANEL, edge=PANEL_EDGE, edge_w=2):
    size = int(units * SCALE)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(radius * SCALE)
    box = (0, 0, size - 1, size - 1)
    d.rounded_rectangle(box, radius=r, fill=rgba(fill, 255))
    d.rounded_rectangle(box, radius=r, outline=rgba(edge, 255), width=edge_w * SCALE)
    return img


def button(units=48, fill=BTN, edge=(86, 122, 166), radius=12):
    size = int(units * SCALE)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(radius * SCALE)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=rgba(fill, 255))
    ins = 2 * SCALE
    d.rounded_rectangle((ins, ins, size - 1 - ins, size - 1 - ins),
                        radius=max(SCALE, r - ins), outline=rgba(edge, 255), width=SCALE)
    # Only top/left highlights. A dark bottom edge would land in the
    # nine-slice's stretchable bottom-centre region and smear across the
    # width once the frame is used at a larger size.
    d.line((r, SCALE, size - r, SCALE), fill=(255, 255, 255, 30), width=SCALE)
    d.line((SCALE, r, SCALE, size - r), fill=(255, 255, 255, 20), width=SCALE)
    return img


def draw_icon_restart(units=40):
    img = canvas(units)
    d = ImageDraw.Draw(img)
    c, r = units / 2, units * 0.3
    arc(d, (c - r, c - r, c + r, c + r), 40, 330, rgba(ICON_INK, 255), 4, factor=K)
    tip = math.radians(40)
    tx, ty = c + r * math.cos(tip), c + r * math.sin(tip)
    poly(d, [(tx + 6, ty - 2), (tx - 4, ty - 7), (tx - 2, ty + 6)], rgba(ICON_INK, 255))
    return finish(img, units)


def draw_icon_home(units=40):
    img = canvas(units)
    d = ImageDraw.Draw(img)
    c = units / 2
    col = rgba(ICON_INK, 255)
    poly(d, [(c, 8), (units - 9, c), (9, c)], col)
    rect(d, (13, c, units - 13, units - 9), col, radius=2)
    rect(d, (c - 3, units - 17, c + 3, units - 9), rgba(BTN, 255), radius=0)
    return finish(img, units)


def draw_icon_fast(on, units=40):
    img = canvas(units)
    d = ImageDraw.Draw(img)
    col = rgba(WATER_CORE if on else (120, 136, 156), 255)
    for x in (8, 19, 30):
        poly(d, [(x, 10), (x + 10, units / 2), (x, units - 10)], col)
    if on:
        glow = img.filter(ImageFilter.GaussianBlur(3 * K / 2))
        base = canvas(units)
        base.alpha_composite(glow)
        base.alpha_composite(img)
        img = base
    return finish(img, units)


def draw_icon_lock(locked, units=40):
    img = canvas(units)
    d = ImageDraw.Draw(img)
    col = rgba((232, 168, 58) if locked else (34, 190, 138), 255)
    if locked:
        arc(d, (13, 7, 27, 33), 180, 360, col, 4, factor=K)
        stroke(d, [(13, 20), (13, 26)], 4, col)
        stroke(d, [(27, 20), (27, 26)], 4, col)
        rect(d, (9, 24, 31, 36), col, radius=3)
        dot(d, 20, 30, 2, rgba((40, 28, 6), 255))
    else:
        poly(d, [(15, 9), (30, 20), (15, 31)], col)
    return finish(img, units)


# ---------------------------------------------------------------- standalone
def draw_title(width=900, height=170):
    img = Image.new("RGBA", (width * SCALE, height * SCALE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    big = ImageFont.truetype(font_path, 76 * SCALE)
    small = ImageFont.truetype(font_path, 22 * SCALE)
    text = "PIPE NIGHTMARE"
    box = d.textbbox((0, 0), text, font=big)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (width * SCALE - tw) / 2 - box[0]
    y = 22 * SCALE - box[1]
    d.text((x + 3 * SCALE, y + 6 * SCALE), text, font=big, fill=(6, 12, 22, 210))
    d.text((x, y), text, font=big, fill=(226, 240, 252, 255),
           stroke_width=2 * SCALE, stroke_fill=rgba(WATER_GLOW, 110))

    sub = "lay the line before the water arrives"
    sbox = d.textbbox((0, 0), sub, font=small)
    d.text(((width * SCALE - (sbox[2] - sbox[0])) / 2 - sbox[0], y + th + 30 * SCALE),
           sub, font=small, fill=(126, 156, 190, 255))

    ly = height - 22
    pts = [(width / 2 - 210, ly), (width / 2 - 40, ly), (width / 2 + 40, ly), (width / 2 + 210, ly)]
    stroke(d, pts, 14, rgba(SHELL_MID, 255), factor=SCALE)
    stroke(d, pts, 9, rgba(CHROME, 255), factor=SCALE)
    stroke(d, pts, 4, rgba(BORE, 255), factor=SCALE)
    stroke(d, pts[:3], 3, rgba(WATER_CORE, 230), factor=SCALE, caps=False)
    return img


def draw_background(width=1280, height=720):
    img = Image.new("RGBA", (width * SCALE, height * SCALE), rgba(SLATE, 255))
    d = ImageDraw.Draw(img)
    for y in range(height * SCALE):
        t = y / (height * SCALE)
        base = (
            int(INK[0] + (SLATE[0] - INK[0]) * (1 - t * 0.6)),
            int(INK[1] + (SLATE[1] - INK[1]) * (1 - t * 0.6)),
            int(INK[2] + (SLATE[2] - INK[2]) * (1 - t * 0.6)),
        )
        d.line((0, y, width * SCALE, y), fill=rgba(base, 255))
    minor, major = 32 * SCALE, 128 * SCALE
    for x in range(0, width * SCALE, minor):
        d.line((x, 0, x, height * SCALE), fill=rgba(GRID_MINOR, 70), width=SCALE)
    for y in range(0, height * SCALE, minor):
        d.line((0, y, width * SCALE, y), fill=rgba(GRID_MINOR, 70), width=SCALE)
    for x in range(0, width * SCALE, major):
        d.line((x, 0, x, height * SCALE), fill=rgba(GRID_MAJOR, 95), width=SCALE)
    for y in range(0, height * SCALE, major):
        d.line((0, y, width * SCALE, y), fill=rgba(GRID_MAJOR, 95), width=SCALE)

    vig = Image.new("L", (width * SCALE, height * SCALE), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse((-260 * SCALE, -300 * SCALE, (width + 260) * SCALE, (height + 300) * SCALE), fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(160 * SCALE / 2))
    dark = Image.new("RGBA", (width * SCALE, height * SCALE), rgba(INK, 255))
    img.paste(dark, (0, 0), Image.eval(vig, lambda v: 255 - v))
    return img


def draw_favicon():
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, 127, 127), radius=26, fill=rgba(SLATE, 255))
    d.rounded_rectangle((2, 2, 125, 125), radius=24, outline=rgba(PANEL_EDGE, 255), width=4)
    f = 128 / TILE
    path = [(32, 7), (32, 32), (56, 32)]
    stroke(d, path, 40, rgba(SHELL_MID, 255), factor=f)
    stroke(d, path, 30, rgba(CHROME, 255), factor=f)
    stroke(d, path, 18, rgba(BORE, 255), factor=f)
    stroke(d, path[:2], 11, rgba(WATER_CORE, 255), factor=f, caps=False)
    return img.resize((32, 32), Image.LANCZOS)


# ---------------------------------------------------------------- skins
# Which swatch a frame draws its material from. Water, icons, the spill marker
# and the standalone title/bg stay procedural: water has to keep reading as
# water, and glyphs have to stay legible on whatever the panels become.
SKIN_GROUPS = (
    (("pipe_", "source", "drain"), "metal"),
    (("panel", "btn_", "slot_", "tile_", "cell_"), "panel"),
)


def skin_group(name):
    for prefixes, group in SKIN_GROUPS:
        if name.startswith(prefixes):
            return group
    return None


def load_skin(arg):
    """Swatches from assets/skins/<arg>, or from <arg> if it is already a path."""
    d = Path(arg)
    if not d.is_dir():
        d = OUT / "skins" / arg
    if not d.is_dir():
        raise SystemExit(f"no skin at {d} — fetch one first: python3 tools/fetch_skin.py {arg}")
    swatches = {f.stem: Image.open(f).convert("RGB") for f in sorted(d.glob("*.png"))}
    if not swatches:
        raise SystemExit(f"{d} holds no swatch PNGs")
    return swatches


def apply_material(img, swatch, neutral_below=40, saturated_above=72):
    """Chroma transfer: the frame keeps its own shading and alpha and takes
    hue, grain and warmth from the swatch.

    out_channel = frame_luma + (swatch_channel - swatch_luma). Subtracting the
    swatch's single luma rather than each channel's own mean is what keeps the
    hue: per-channel means would flatten copper to grey and leave only grain.

    Pixels that are already strongly coloured keep their own colour, ramped in
    over that range of channel spread. Steel is near-neutral and takes the
    material; the cyan drop at the tap's mouth and the water in the bucket are
    not, and would otherwise come out copper. The ramp keeps the boundary
    anti-aliased instead of leaving a hard seam.

    Whole images, fixed integer arithmetic, no randomness, so re-running
    reproduces every byte. Alpha is passed through untouched, which is what
    keeps the pipe frames crossing exactly their declared openings.
    """
    r, g, b, a = img.split()
    orig = Image.merge("RGB", (r, g, b))
    lum = orig.convert("L")
    m = swatch.resize(img.size, Image.LANCZOS)
    base = round(ImageStat.Stat(m.convert("L")).mean[0])
    tinted = Image.merge("RGB", [ImageChops.add(lum, ch, 1.0, -base) for ch in m.split()])

    spread = ImageChops.subtract(
        ImageChops.lighter(ImageChops.lighter(r, g), b),
        ImageChops.darker(ImageChops.darker(r, g), b))
    keep = spread.point(lambda v: min(255, max(0, int((v - neutral_below) * 255 /
                                                      (saturated_above - neutral_below)))))
    # composite() pastes its first image wherever the mask is set, so the
    # strongly-coloured pixels get their original colour back.
    out = ImageChops.composite(orig, tinted, keep)
    return Image.merge("RGBA", [*out.split(), a])


# ---------------------------------------------------------------- packing
def pack(frames):
    """Deterministic shelf pack; names sorted so output never reflows."""
    items = sorted(frames.items(), key=lambda kv: (-kv[1].height, -kv[1].width, kv[0]))
    x = y = row_h = 0
    placed = {}
    for name, img in items:
        w, h = img.width + PAD * 2, img.height + PAD * 2
        if x + w > ATLAS_W:
            x, y = 0, y + row_h
            row_h = 0
        if y + h > ATLAS_H:
            raise SystemExit(f"atlas overflow packing {name}; raise ATLAS_H")
        placed[name] = (x + PAD, y + PAD, img)
        x += w
        row_h = max(row_h, h)
    bottom = max(py + img.height for _, py, img in placed.values())
    return placed, bottom


def write_atlas(frames):
    placed, bottom = pack(frames)
    atlas = Image.new("RGBA", (ATLAS_W, bottom + PAD), (0, 0, 0, 0))
    manifest = {"frames": {}, "meta": {
        "app": "Pipe Nightmare generate_assets.py",
        "version": "2.0",
        "image": "atlas.png",
        "format": "RGBA8888",
        "size": {"w": ATLAS_W, "h": bottom + PAD},
        "scale": str(SCALE),
        "worldTile": str(TILE)
    }}
    for name in sorted(placed):
        px, py, img = placed[name]
        atlas.paste(img, (px, py))
        manifest["frames"][name] = {
            "frame": {"x": px, "y": py, "w": img.width, "h": img.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": img.width, "h": img.height},
            "sourceSize": {"w": img.width, "h": img.height},
        }
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "atlas.png", optimize=True)
    (OUT / "atlas.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return len(manifest["frames"])


# ---------------------------------------------------------------- frames
# One PNG per frame key is the artwork; the atlas is only ever a pack of them.
# Anything you drop in here becomes a frame the game can name, and nothing in
# here is overwritten unless asked, so hand and model edits survive.
FRAMES_DIR = OUT / "frames"


def write_frames(frames, force=False):
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    written = kept = 0
    for name in sorted(frames):
        dest = FRAMES_DIR / f"{name}.png"
        if dest.exists() and not force:
            kept += 1
            continue
        frames[name].save(dest, optimize=True)
        written += 1
    return written, kept


def read_frames():
    frames = {p.stem: Image.open(p).convert("RGBA") for p in sorted(FRAMES_DIR.glob("*.png"))}
    if not frames:
        raise SystemExit(f"nothing in {FRAMES_DIR}; run this script without --pack-only first")
    return frames


def pack_frames_dir():
    return write_atlas(read_frames())


def build_atlas_frames(skin=None):
    frames = {}
    for shape in sorted(SHAPES):
        frames[f"pipe_{shape}"] = draw_pipe(shape)
        for entry in sorted(SHAPES[shape]):
            for step in range(1, FILL_STEPS + 1):
                frames[f"water_{shape}_{LETTER[entry]}_{step}"] = draw_water(shape, entry, step)

    frames["tile_empty"] = draw_empty_cell()
    frames["tile_blocked"] = draw_blocked()
    frames["cell_hover"] = draw_cell_hover()
    frames["spill"] = draw_spill()
    frames["source"] = draw_source()
    frames["drain"] = draw_drain()

    frames["panel"] = nine_slice()
    frames["btn_normal"] = button(fill=BTN, edge=(86, 122, 166))
    frames["btn_hover"] = button(fill=BTN_HOVER, edge=(122, 166, 214))
    frames["btn_disabled"] = button(fill=BTN_DISABLED, edge=(44, 56, 74))
    frames["btn_danger"] = button(fill=BTN_DANGER, edge=(196, 96, 110))
    frames["btn_success"] = button(fill=BTN_SUCCESS, edge=(64, 196, 156))
    frames["slot"] = nine_slice(units=56, radius=10, fill=(13, 22, 37), edge=PANEL_EDGE)
    frames["slot_active"] = nine_slice(units=56, radius=10, fill=(18, 36, 56), edge=WATER_GLOW)

    frames["icon_restart"] = draw_icon_restart()
    frames["icon_home"] = draw_icon_home()
    frames["icon_fast_on"] = draw_icon_fast(True)
    frames["icon_fast_off"] = draw_icon_fast(False)
    frames["icon_locked"] = draw_icon_lock(True)
    frames["icon_play"] = draw_icon_lock(False)

    if skin:
        for name in sorted(frames):
            group = skin_group(name)
            if group and group in skin:
                frames[name] = apply_material(frames[name], skin[group])
    return frames


def write_standalone(name, img, force):
    """The three big images live outside the atlas, and are equally yours to edit."""
    dest = OUT / name
    if dest.exists() and not force:
        return False
    img.save(dest, optimize=True)
    return True


def main():
    ap = argparse.ArgumentParser(description="bootstrap the artwork in assets/frames/ and pack it")
    ap.add_argument("--skin", metavar="NAME",
                    help="material swatches from assets/skins/NAME, or a path to a swatch dir")
    ap.add_argument("--force", action="store_true",
                    help="redraw frames and standalone images that already exist")
    ap.add_argument("--pack-only", action="store_true",
                    help="rebuild the atlas from assets/frames/ without drawing anything")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    if args.pack_only:
        print(f"atlas: packed {pack_frames_dir()} frames from {FRAMES_DIR.relative_to(ROOT)}")
        return

    skin = load_skin(args.skin) if args.skin else None
    frames = build_atlas_frames(skin)
    written, kept = write_frames(frames, args.force)
    count = pack_frames_dir()
    drawn = 0
    for name, fn in (("title.png", draw_title), ("bg.png", draw_background),
                     ("favicon.png", draw_favicon)):
        drawn += write_standalone(name, fn(), args.force)
    fresh, standing = drawn, 3 - drawn

    water = sum(1 for n in frames if n.startswith("water_"))
    pipes = sum(1 for n in frames if n.startswith("pipe_"))
    print(f"frames: {written} drawn, {kept} already yours and left alone "
          f"({count} packed into atlas.png at {SCALE}x detail)")
    print(f"  {pipes} pipe shapes, {water} water fill frames, {count - pipes - water} tiles and UI")
    if skin:
        skinned = sum(1 for n in frames if skin_group(n) in skin)
        print(f"  skin {args.skin}: {skinned} frames re-materialled from {sorted(skin)}")
        if kept:
            print(f"  note: {kept} frame(s) already existed, so the skin was NOT applied to "
                  f"them — --force overwrites them, including any edits you made by hand")
    print(f"standalone: title.png, bg.png, favicon.png — {fresh} drawn, {standing} left alone")
    print(f"the game must draw these at scale {1 / SCALE}")
    print(f"to change one image from now on: edit {FRAMES_DIR.relative_to(ROOT)}/<name>.png, "
          f"then python3 tools/generate_assets.py --pack-only")


if __name__ == "__main__":
    main()
