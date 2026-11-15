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
| `lib/PHASER-LICENSE.txt` | that engine's own MIT notice |
| `src/logic/` | pure game rules, no Phaser |
| `src/scenes/` | Boot, Menu, Game, Error |
| `levels/` | `level-1.json` … `level-5.json` |
| `assets/frames/` | the artwork: one PNG per frame, yours to edit |
| `assets/` | the packed atlas derived from those frames, plus `title`/`bg`/`favicon` |
| `tools/` | asset generator, image-model editor, level tuner, headless harness |
| `tests/` | `node --test` suite |

## The artwork

Every graphic is a PNG (R-008); nothing is drawn at runtime. The artwork lives
as one file per frame in `assets/frames/`, and `assets/atlas.png` is just a
pack of them, which is what the game loads.

```sh
python3 tools/generate_assets.py             # draw any frame that does not exist yet, then pack
python3 tools/generate_assets.py --pack-only # just re-pack assets/frames/ into the atlas
python3 tools/generate_assets.py --force     # redraw frames that already exist
```

Requires Pillow, and it is an authoring step only — the game needs no build and
no Python. `generate_assets.py` is meant to be run once to bootstrap the
artwork; after that the loose PNGs are the thing you edit, and re-running the
generator leaves them alone. `assets/atlas.png` and `assets/atlas.json` are
derived — never edit them, they are rebuilt on every run. Packing is lossless:
the round trip through 146 individual PNGs reproduces the atlas byte for byte.
After editing a frame by hand, re-pack and hard-reload the browser
(Ctrl+Shift+R — PNGs are not cache-busted, only level JSON is).

### Asking an image model to adjust one

```sh
export QWENCLOUD_TOKEN_PLAN_API_KEY=...
python3 tools/edit_asset.py pipe_ew --prompt "flaking orange rust, pitted metal"
python3 tools/edit_asset.py --group pipes --prompt "frosted over with ice build-up"
python3 tools/edit_asset.py bg title --prompt "a stormier sea behind the board"
```

It sends the existing PNG as input, asks for the same thing adjusted, and
returns it at the frame's exact size. The answer lands in
`assets/proposals/<name>.png` so you can look first; `--apply` writes it into
`assets/frames/` and re-packs. `--dry-run` shows what would be asked without
sending anything, and one image credit is spent per asset per attempt.

Three guards always run, because a live call showed the model cannot be trusted
with them: the frame's own alpha is put back (the model returns no
transparency), and for pipe frames the dark bore and the pixels at each open end
are kept from the original — a bore is open at both ends, so the model reads it
as background and repaints it. Pixels that were semi-transparent to begin with
(the contact shadow) also keep the original colour, since the model's flat
background shows straight through them.

`water_*` frames are refused without `--force`: the fill front has to land on
step/10 of the tile length, which is one of the checked properties below.

### Decorations from a sheet

For things that are *added* to the pipes — snow, icicles, moss, rust flakes —
one image carries many pieces, which is both cheaper and more consistent than
asking per frame:

```sh
python3 tools/make_decals.py --prompt "long icicles, snow caps, frost clumps,
    well separated, flat magenta background, no pipes, no text"      # 1 credit
python3 tools/place_decals.py --dry-run    # where each piece would land
python3 tools/place_decals.py              # paste onto the pipe frames, repack
python3 tools/place_decals.py --undo       # back to the frames as they were
```

`make_decals.py` keys the background out by colour, finds each shape, and slices
it into `assets/decals/`. Nothing trusts a grid, because the model will not draw
one: the shapes are detected wherever they happen to be. Re-slicing a sheet you
painted over costs nothing — `--from-sheet assets/decal-sheet.png`.

`place_decals.py` only decides *where* pieces go, from
`assets/decals/placement.json`, which is yours to edit: how many caps and
hangs, how big in frame pixels, how much jitter, and per-shape overrides. It
never stacks — it composites onto the pristine copies it captures in
`assets/frames/base/`, so running it twice gives the same picture.

Three regions are kept clear by construction, and they are contract rather than
taste: the bore (the water sprite draws inside it, so ice there hides the fill),
the collar zone at each open end, and the middle of every edge — art reaching an
edge reads as a connection, which on a closed side invents one. The edge check
under "Two properties of the output" catches it if that ever regresses.

Physics sets the sizes: a 46-unit tube in a 64-unit tile leaves about nine units
of sky, so an icicle longer than roughly 12 px gets shortened automatically
rather than being allowed to overlap the tile edge.

### Redrawing a whole set in one call

For a complete redesign rather than added decoration — "icy pipes with bugs on
them" — the cost problem has a structural answer: the gateway limits a request
by *area*, not by how many things are in it. Six frames in a 3x2 grid of 1024px
cells is 3072x2048 = 6,291,456 px, inside the 6,553,600 ceiling, so **one
credit buys every frame the pixel budget it would have got from its own call.**

```sh
python3 tools/redraw_sheet.py --group pipes --prompt "an icy theme, frozen
    pipes with icicles and rime, two cartoonish bugs clinging to the metal"
python3 tools/redraw_sheet.py --group pipes --dry-run --prompt "..."            # compose only
python3 tools/redraw_sheet.py --group pipes --from-sheet assets/redraw-answer.png  # re-slice, 0 credits
python3 tools/redraw_sheet.py --group pipes --prompt "..." --apply
```

It lays the frames out on a magenta sheet, asks for the whole thing redrawn,
keys the background out by colour and cuts it back into 128px frames. One
picture also means one consistent idea of the theme, which six separate calls
never give you. The trade is per-frame re-rolling: re-roll the sheet (1 credit)
or fix one cell in `assets/redraw-answer.png` and re-slice it for free.

**The answer replaces the frame outright.** Nothing is blended in from the old
artwork, because a blend is a mixture of the old look and the new one — the
first version restored the bore, the collars and the shadow from the copper
frames and shipped icy pipes with copper guts. 82% of that copper turned out to
be the model's own doing anyway: it was asked to redesign copper, so it kept
the copper and painted ice over it. Hence `--base steel`, the default, which
feeds the model the drawn *shape* instead of the look it is meant to replace.

A wrong answer is not a bug to patch: re-run the prompt. So the tool repairs
nothing and only reports, per frame:

    openings OK | bore luma 58        # still crosses its declared edges; the
                                      # channel stays dark enough for cyan water
    83% of cell drawn, +3207 new silhouette px
    ART LEAKING ONTO CLOSED EDGES at s:3    # re-roll, or ask in the prompt

Two ceilings apply and only the tighter one matters: the gateway validates area
up to 2560x2560, but an edit request carrying an input image is rejected by the
algo beyond 2048 on a side, so cells are sized to fit both. Undo is
`git checkout assets/frames/ && python3 tools/generate_assets.py --pack-only`.

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

## Alternative skins

For a uniform material across many frames at once, rather than one image at a
time:

```sh
export QWENCLOUD_TOKEN_PLAN_API_KEY=...
python3 tools/fetch_skin.py copper --material "brushed copper"
python3 tools/generate_assets.py --skin copper --force
```

`fetch_skin.py` writes `assets/skins/copper/{metal,panel}.png` and commits them,
because the image API returns a URL that expires within a day and a fresh call
is never pixel-identical — caching the swatches as source keeps the generator
offline. A skin contributes hue and grain only: shading and alpha stay as
drawn, so frame keys, tile sizes and the edge-opening and water-front checks are
unaffected, and strongly-coloured details (water in the tap and bucket, blocked
tiles) are left alone.

Because frames are write-once now, `--skin` needs `--force` to reach artwork
that already exists — and `--force` also throws away any hand or model edits to
those frames, so commit `assets/frames/` first and revert with
`git checkout assets/frames/`.

## Tuning the levels

```sh
node tools/tune-levels.mjs
```

Reports, per level, whether it is winnable, the shortest route, the score a
perfect run earns and how long the level takes. Level parameters are all data
in `levels/*.json`, so editing them changes the game with no code change.

## License

MIT — see [LICENSE](LICENSE). Covers the code, the `assets/` artwork and the
`levels/` data, so a frame you redraw or a level you retune is licensed to you
on the same terms as the JavaScript.

`lib/phaser.min.js` is not covered by that copyright: it is Phaser 3.90.0, MIT
licensed by its own authors, and its notice is recorded in
[`lib/PHASER-LICENSE.txt`](lib/PHASER-LICENSE.txt). The minified bundle carries
no licence banner, so that file is what makes the terms travel with the copy
vendored here; it also records which parts of that attribution are verified and
which still need checking against the upstream tag.
