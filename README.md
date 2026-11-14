# Pipe Nightmare

A real-time pipe-laying puzzle game. Lay pipe pieces from a random queue and
rotate them to get the water from the source on the left to the drain on the
right before it spills. Five levels, scored on how few tiles you use.

Built to `docs/SPEC.md` (v0.7). Plain static files, no build step, no backend.

## Run it

```sh
python3 -m http.server
```

then open <http://localhost:8000/>.

It must be served over HTTP: the level files are fetched at runtime, which
does not work when `index.html` is opened straight from disk.

## Tests

```sh
node --test
```

Covers the pure logic modules in `src/logic/` — piece openings per rotation,
queue refill, placement and rotation rules, water paths that win and that
spill for each of the four reasons, the score formula, level validation and
localStorage recovery.

## Playtest in a real browser

Needs `google-chrome` on PATH.

```sh
node tools/headless.mjs tools/scenarios/smoke.mjs           # boots clean, nothing remote
node tools/headless.mjs tools/scenarios/win-level-1.mjs     # wins level 1 with real clicks
node tools/headless.mjs tools/scenarios/failures.mjs        # spill, retry, lock, bad data
node tools/headless.mjs tools/scenarios/water-midflow.mjs   # water part-way along a route
node tools/headless.mjs tools/scenarios/clear-all-levels.mjs # beats all five levels
```

Each run exits non-zero on any console error or uncaught exception, and writes
screenshots to `.qwen/shots/`.

## Layout

| path | what |
|---|---|
| `index.html` | entry point |
| `lib/phaser.min.js` | vendored Phaser 3.90.0 — not loaded from a CDN |
| `src/logic/` | pure game rules, no Phaser |
| `src/scenes/` | Boot, Menu, Game, Error |
| `levels/` | `level-1.json` … `level-5.json` |
| `assets/` | generated PNG atlas + favicon |
| `tools/` | asset generator, level tuner, headless harness |
| `tests/` | `node --test` suite |

## Regenerating the artwork

All graphics are pre-generated PNGs (R-008); nothing is drawn at runtime.

```sh
python3 tools/generate_assets.py
```

Requires Pillow. This is an authoring step only — the game itself needs no
build and no Python. The script is deterministic, so re-running it reproduces
`assets/` byte for byte. Edit the palette constants near the top to restyle.

Frames are authored at `SCALE = 2` PNG pixels per world unit, so a 64-unit
tile is a 128px frame and `src/assets.js` draws it at 0.5 scale. Changing
`SCALE` means changing `ASSET_SCALE` there to match. Two properties of the
output are load-bearing rather than cosmetic — each pipe frame must cross
exactly its declared edge openings, and the water front must sit on step/10 of
the tile length — so check them after any change to the drawing code:

```sh
python3 - <<'PY'
import json
from PIL import Image
a = Image.open('assets/atlas.png').convert('RGBA'); m = json.load(open('assets/atlas.json'))
F = int(m['meta']['worldTile']) * int(m['meta']['scale'])
def get(n):
    f = m['frames'][n]['frame']; return a.crop((f['x'], f['y'], f['x']+f['w'], f['y']+f['h']))
SHAPES = {'ew': 'we', 'ns': 'ns', 'ne': 'ne', 'es': 'es', 'sw': 'sw', 'nw': 'nw'}
EDGE = {'n': (F//2, 3), 'e': (F-6, F//2), 's': (F//2, F-6), 'w': (3, F//2)}
bad = sum((get(f'pipe_{s}').getpixel(EDGE[d])[3] > 128) != (d in SHAPES[s])
          for s in SHAPES for d in EDGE)
prev, mono = -1, True
for st in range(1, 11):
    xs = [x for x in range(F) if get(f'water_ew_w_{st}').getpixel((x, F//2))[3] > 100]
    mono, prev = mono and (max(xs) > prev if xs else False), max(xs) if xs else prev
print('edge mismatches:', bad, '| fill strictly increasing:', mono)
PY
```

## Tuning the levels

```sh
node tools/tune-levels.mjs
```

Reports, per level, whether it is winnable, the shortest route, the score a
perfect run earns and how long the level takes. Level parameters are all data
in `levels/*.json`, so editing them changes the game with no code change.
