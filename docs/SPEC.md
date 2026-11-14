# Pipe Nightmare — Specification

Status: Approved   Version: 0.10   Date: 2026-11-14

## 1. Summary
A real-time pipe-laying puzzle game built with Phaser, hosted as plain static files. Water starts flowing from a source on the left after a delay; the player places pipe pieces from a random queue and rotates tiles to build a connected route to the drain on the right before the water spills. Five hand-made levels, scored by how few tiles are used, with unlocked progress and best scores saved in the browser.

## 2. Users and core journey
Player: anyone with a desktop browser, playing alone (this is a personal project).

1. Player opens the page and sees the level select (level 1 open, the rest locked).
2. Player starts a level and sees the grid, a left-side source, a right-side drain, any blocked cells, and a queue of upcoming pipe pieces.
3. A countdown runs, then water begins to flow from the source.
4. Meanwhile the player clicks an empty cell to place the front piece of the queue, and clicks placed tiles to rotate them.
5. Water advances tile by tile along the pipe. A tile the water has entered is locked.
6. If water reaches the drain, the level is won and the next level unlocks. If it reaches a gap, a dead end, a blocked cell or the grid edge, it spills and the level is lost.
7. On a win, the player sees their score (fewer tiles used = higher score). Player retries, goes to the next level, or returns to the level select.

## 3. Requirements

### R-001 Static, no-build delivery
- Priority: Must
- Description: The game runs from plain files on any static web host, with no build step and no backend.
- Acceptance criteria:
  - [ ] Serving the repo root with a static file server (e.g. `python3 -m http.server`) and opening `index.html` starts the game with no console errors.
  - [ ] Phaser is loaded from a file in the repo, not from a CDN; no network requests are made to other hosts.
  - [ ] No `package.json` dependency or bundler is needed to run the game.
- Origin: Stated

### R-002 Grid and level data
- Priority: Must
- Description: Each level is a data file (JSON) defining grid width and height, source row, drain row, blocked cells, queue size, start delay and water speed. The source is on the left of the grid, the drain on the right.
- Acceptance criteria:
  - [ ] Exactly 5 level data files exist and each loads without error.
  - [ ] Changing a value in a level file (e.g. a blocked cell or water speed) changes the level in the game with no code change.
  - [ ] Blocked cells are drawn distinctly and cannot receive a pipe.
  - [ ] Loading a level with invalid data (missing field, out-of-range cell) shows a readable error message instead of a blank screen.
- Origin: Stated (5 levels, blocked cells); Assumption (JSON format, field list)

### R-003 Pipe queue
- Priority: Must
- Description: Pieces come from a queue of random pipe parts. Only straight and elbow pieces exist. The first piece is the one placed next.
- Acceptance criteria:
  - [ ] The next N pieces are visible in the queue, where N is set by the level (default 5).
  - [ ] Placing the front piece removes it, shifts the queue up, and adds a new random piece at the back, so the queue never runs out.
  - [ ] Both piece types (straight, elbow) appear in the queue over a normal level.
  - [ ] The queue accepts an injected random source, so tests can make it deterministic.
  - [ ] There is no skip or discard control.
- Origin: Stated (random queue, straight and elbow only); Assumption (visible count, no skip)

### R-004 Placing and rotating
- Priority: Must
- Description: The player places the front piece on any empty, non-blocked cell, and can rotate any placed tile that water has not entered. There is no per-placement timer.
- Acceptance criteria:
  - [ ] Clicking an empty cell places the front queue piece there, in its default orientation.
  - [ ] Clicking a placed, unlocked tile rotates it 90° clockwise. A straight piece alternates horizontal/vertical; an elbow cycles through 4 orientations.
  - [ ] Clicking a blocked cell, the source, the drain, or a locked tile does nothing.
  - [ ] A placed piece cannot be replaced or removed, only rotated.
  - [ ] There is no timer on placement; waiting any length of time does not discard or change the queue.
- Origin: Stated (place anywhere empty, rotate any tile, no placement timer); Assumption (click to rotate, clockwise, no replace)

### R-005 Water flow
- Priority: Must
- Description: After the level's start delay, water flows from the source into the grid at a steady rate, one tile at a time. A tile is locked from the moment water enters it.
- Acceptance criteria:
  - [ ] A visible countdown shows the time until the water starts.
  - [ ] Water fills each tile over a duration set by the level, visibly filling along the pipe path.
  - [ ] When water enters a tile, the tile can no longer be rotated.
  - [ ] Water enters the first grid cell from the source's side, and exits each tile through the opening opposite its entry, following the pipe shape.
  - [ ] Water speed is the same for the whole level, with one exception: the player can turn on an optional fast-forward button (3x speed, for both the countdown and the flow) and turn it off again. It never changes by itself.
  - [ ] Fast-forward does not change the score.
- Origin: Stated (rising water, locked once entered); Assumption (constant speed, countdown)

### R-006 Win and lose
- Priority: Must
- Description: Water reaching the drain wins the level; water spilling loses it.
- Acceptance criteria:
  - [ ] Water leaving a tile into the drain triggers a win screen.
  - [ ] Water meeting an empty cell, a blocked cell, the grid edge, or a tile with no opening facing it triggers a spill and a lose screen.
  - [ ] The win screen shows the level's score (see R-011).
  - [ ] Both outcomes offer Retry and Level select; a win also offers Next level (except on the last level).
  - [ ] Retry restores the level's starting state with a fresh random queue.
  - [ ] The player can keep placing and rotating unlocked tiles up until the moment of spill or win.
- Origin: Stated (water spilling loses, reaching the end wins)

### R-007 Levels and saved progress
- Priority: Must
- Description: Levels unlock in order. Progress is saved in `localStorage`.
- Acceptance criteria:
  - [ ] On first load only level 1 is selectable.
  - [ ] Winning level N unlocks level N+1.
  - [ ] After a page reload, the unlocked levels are still unlocked.
  - [ ] Any unlocked level can be replayed.
  - [ ] If `localStorage` is unavailable or holds invalid data, the game still runs with only level 1 unlocked and no crash.
  - [ ] The 5 levels get harder (smaller start delay, faster water, more blocked cells or a larger grid) and each can be completed with a valid route.
- Origin: Stated (5 hand-made levels, localStorage); Assumption (sequential unlock, difficulty levers)

### R-008 Pre-generated image assets
- Priority: Must
- Description: All graphics (pipe pieces, water fill frames, grid cells, blocked cells, source, drain, UI buttons, background) exist as PNG files committed to the repo under `assets/`. The artwork is one PNG per frame in `assets/frames/`, drawn once by a generator script kept in `tools/` and editable directly from then on — by hand or through `tools/edit_asset.py`. `assets/atlas.png` and `assets/atlas.json` are derived from those files and are never hand-edited. A boot scene loads them through the Phaser loader before the menu scene starts, and gameplay uses them as sprites or images. Nothing is drawn at runtime; there is no per-frame shape drawing in gameplay scenes.
- Acceptance criteria:
  - [ ] Every graphic in the game comes from a PNG file in `assets/`, and the boot scene has loaded them all before the menu scene starts.
  - [ ] The game scenes contain no `Graphics` shape-drawing calls and no `generateTexture` calls.
  - [ ] `tools/generate_assets.py` bootstraps `assets/frames/` and leaves frames that already exist untouched; packing the frames is lossless and deterministic, reproducing `assets/atlas.png` and `assets/atlas.json` byte for byte.
  - [ ] Asset generation is an authoring step only — running the game still needs no build step, no Python and no network (R-001).
  - [ ] No asset is requested from a remote host at runtime.
- Origin: Stated (revised in 0.6: assets are pre-generated image files, not textures generated by browser JS; revised in 0.12: the frames are individual committed PNGs with the atlas derived, at the requester's direction, so any single image can be tweaked without going back through the generator)

### R-009 Menus and feedback
- Priority: Should
- Description: A level select screen, an in-level restart button and a readable HUD.
- Acceptance criteria:
  - [ ] The level select shows all 5 levels, with locked ones visibly distinct.
  - [ ] During a level, a button returns to level select and another restarts the level.
  - [ ] The queue, countdown/water status and level number are visible during play.
  - [ ] The game title "Pipe Nightmare" is shown on the menu and on the game screen during play.
- Origin: Assumption

### R-010 Testable game logic
- Priority: Should
- Description: Grid, pieces, rotation, queue and water-step rules live in pure JavaScript modules with no Phaser dependency, covered by Node tests.
- Acceptance criteria:
  - [ ] `node --test` runs and passes.
  - [ ] Tests cover: piece openings per rotation, queue refill, placement rules, rotation lock, a water path that wins, and a water path that spills (gap, dead end, blocked cell, edge).
  - [ ] Game scenes call the logic modules for rules instead of re-implementing them.
- Origin: Assumption

### R-011 Scoring
- Priority: Must
- Description: Winning a level gives a score that falls as more tiles are used. Best score per level is saved.
- Acceptance criteria:
  - [ ] Score is computed by a pure function of tiles placed: `score = max(0, 1000 - 50 * tilesPlaced)`, where `tilesPlaced` counts every piece placed in the attempt (rotations do not count).
  - [ ] Placing more pieces never increases the score; examples: 10 tiles -> 500, 20 tiles -> 0, 25 tiles -> 0.
  - [ ] The win screen shows the score and tiles used; the HUD shows the live tile count during play.
  - [ ] The best score per level is saved in `localStorage`, survives a reload, and is shown on the level select; a lower score on a replay does not overwrite it.
  - [ ] A lost level gives no score.
  - [ ] Invalid or missing saved scores are treated as no score, with no crash.
- Origin: Stated (more tiles used, lower score); Assumption (formula, counting rule, saving best)

## 4. Out of scope
- T-junctions, crosses and any branching water
- Pre-placed or fixed pipes (other than the source and drain)
- Level editor and endless mode
- Sound and music
- Online leaderboard, accounts, server-side saving or any backend
- Mobile-specific layout (touch is a bonus only if it works for free)
- Per-placement timers, skipping or discarding queue pieces

## 5. Constraints and technical notes
- Platform: desktop browser, mouse input. Hosted as static files.
- Stack: Phaser 3.90.0 (exact version pinned, vendored into the repo at `lib/phaser.min.js`), plain JavaScript ES modules, no bundler, no runtime dependencies. Files: `index.html`, `README.md`, `.gitignore`, `src/` (scenes, logic), `levels/` (JSON), `tests/`, `assets/` (generated PNGs), `tools/` (asset generator, level tuner, headless playtest harness), `lib/` (vendored Phaser).
- Graphics are pre-generated PNG files in `assets/`: one per frame in `assets/frames/`, drawn once by `tools/generate_assets.py` (Python 3 + Pillow) and packed into `assets/atlas.png`, which Phaser loads at boot (R-008). The loose frames are the artwork and are meant to be edited directly; the atlas is a derived file. Pillow is an authoring-time dependency only; it is not needed to run or test the game.
- Decorations that are added to the pipes (snow, icicles, moss, flakes) come from a generated sheet rather than per-frame calls: `tools/make_decals.py` draws or re-slices a sheet and cuts it into `assets/decals/` by detecting shapes over a keyed background, and `tools/place_decals.py` pastes them onto the pipe frames using `assets/decals/placement.json`. The model and the artist own what a decoration looks like; the JSON and the code own where it goes, and the code additionally keeps the bore, the open-end collars and every tile edge clear, because those are frame-contract regions. Placement composites onto pristine copies in `assets/frames/base/`, so it is idempotent, and `--undo` reverses it.
- Editing artwork without the generator: `tools/edit_asset.py <frame>|--group <set> --prompt "..."` asks `qwen-image-3.0-pro` for an adjusted version of an existing image and writes it to `assets/proposals/` (`--apply` puts it in `assets/frames/` and repacks). The model's answer always gets the frame's own alpha back, and for pipe frames also its own bore and joint pixels, because a live call repainted the bore as background (silhouette IoU 0.53). `tools/fetch_skin.py` remains for whole-material skins, which `generate_assets.py --skin <name>` applies only to frames it still has to draw. Neither network call is ever part of building or running the game, and shading, silhouettes and A-011's frame contract stay owned by code.
- Asset resolution: every frame is authored at 2 PNG pixels per world unit, so a 64-unit tile is a 128px frame. The world stays 1280x720 with 64-unit tiles and no layout or logic constant changes; `src/assets.js` is the single place that knows the ratio and draws sprites at 0.5 scale and nine-slice insets at 2x. `assets/atlas.json` records `meta.scale` and `meta.worldTile` so the two stay in step.
- Phaser 3 has no device-pixel-ratio handling for the main framebuffer: the canvas is always exactly `width` x `height` and CSS stretches it. On a 2x display each canvas pixel therefore becomes 2 physical pixels. The 2x source detail is what keeps that from looking soft; a zoom-based DPR workaround was evaluated and rejected because it adds no real detail over fixed-resolution textures.
- Builder model: Claude Sonnet (tier A), context default, tool Claude Code.
- Build/test commands: none (no build step); `node --test` (Node 24 does not accept a bare directory argument). The game is also checked by playtest via `python3 -m http.server`, and driven end to end by `node tools/headless.mjs tools/scenarios/<name>.mjs`, which serves the repo, runs it in headless Chrome, fails on any console error, and asserts that no request leaves the machine.

## 6. Assumptions and open questions
- A-001 (resolved) Phaser 3.90.0 is the pinned version, vendored at `lib/phaser.min.js`.
- A-002 Queue shows 5 pieces by default and has no skip — proposed default
- A-003 Click rotates 90° clockwise; placed pieces cannot be removed — proposed default
- A-004 Source and drain are fixed markers outside the grid edge, on rows set by the level — proposed default
- A-005 Levels unlock sequentially and the order is fixed — proposed default
- A-006 Levels are JSON files, one per level — proposed default
- A-007 Water speed is constant within a level, apart from the optional player fast-forward (R-005); difficulty rises across levels — proposed default
- A-008 "Tiles used" means every piece placed during the attempt, including ones off the final route; score = max(0, 1000 - 50 x tiles placed); best score per level is stored in localStorage — proposed default, needs confirmation
- A-009 Visual style: a dark slate blueprint board with faint engineering grid lines, and cool "space-age" steel pipework — a smooth gradient across the tube wall with a specular band, coupling collars at each open end, and cyan water with a bright liquid core that glows as it fills. The source is drawn as a wall tap with a valve wheel and a drop at the mouth; the drain as a bucket with a handle and water already in it. Not specified by the requester; chosen by the builder and re-renderable by editing the palette and shape functions in `tools/generate_assets.py`.
- A-010 Water fill is animated by switching between pre-rendered frames (one per piece shape, entry side and fill step) rather than by masking at runtime, so that R-008's "nothing drawn at runtime" holds — proposed default
- A-011 Frames are authored at 2 PNG pixels per world unit (see §5). The frame contract is unchanged — `pipe_<shape>`, `water_<shape>_<entry>_<step>` with the same six shape keys — so only the drawing code needed to learn about scale. Two properties of the artwork are load-bearing and are checked by script, not by eye: each pipe frame must cross exactly its declared edge midpoints, and the water front must land on step/10 of the tile length.
- Q-001 (resolved) Name is "Pipe Nightmare".
- Q-002 (resolved) Scores are included, see R-011.

## 7. Task backlog
Statuses: `todo` not started · `in-progress` implemented, not every acceptance criterion verified yet · `done` implemented and verified.

- T-001 Scaffold: `index.html`, vendored Phaser, asset generator producing `assets/`, boot scene loading all assets, empty menu scene — Requirements: R-001, R-008 — Status: done
- T-002 Pure logic modules (pieces, rotation, grid, queue, water step) with Node tests — Requirements: R-003, R-004, R-005, R-006, R-010 — Status: done
- T-003 Level format, loader with validation, and 5 level files — Requirements: R-002, R-007 — Status: done
- T-004 Game scene: grid, queue display, placing and rotating — Requirements: R-003, R-004, R-009 — Status: done
- T-005 Water flow animation, tile locking, win and lose screens — Requirements: R-005, R-006 — Status: done
- T-006 Level select, unlock progress in localStorage, error handling — Requirements: R-007, R-009 — Status: done
- T-007 Scoring: score function with tests, tile counter, score on win screen, best scores saved and shown on level select — Requirements: R-011 — Status: done
- T-008 Tune the 5 levels by playtest and confirm each is winnable — Requirements: R-002, R-007, R-011 — Status: done

### What is verified
- `node --test` — 71/71 pass.
- `node tools/tune-levels.mjs` — all 5 levels winnable; shortest routes 8/9/10/13/15 tiles, perfect scores 600/550/500/350/250, level length 30.6s down to 22.6s.
- `smoke.mjs` — PASS: boots clean, Phaser 3.90.0 from `lib/`, 146 atlas frames at 128px, `title` and `bg` textures present, 36 network requests all same-origin (R-001).
- `win-level-1.mjs` — PASS: real clicks win level 1 in 8 tiles, score 600 with fast-forward on (R-005: 3x does not change the score), level 2 unlocked and loaded.
- `failures.mjs` — PASS: spilling at the source shows the lose screen with "no score" and saves nothing; Retry resets and switches 3x back off; a tile the water has passed refuses to rotate while a tile ahead of it still turns; corrupt localStorage falls back to level 1 only with no crash; a level file that is not valid JSON routes to a readable error screen with no console error.
- `clear-all-levels.mjs` — PASS: all five levels beaten with real clicks at 1x, best scores `{1:600, 2:550, 3:500, 4:350, 5:250}`, all five unlocked.
- Asset contract — 0 edge mismatches across the six pipe frames (each crosses exactly its declared openings), water front strictly increasing with max deviation 0.008 from step/10, the full-tile water centreline flat at 232 with no spike at the exit, and the atlas reproduces byte for byte — since 0.12 that means the round trip through 146 loose PNGs in `assets/frames/` hashes identically to the committed `assets/atlas.png` and `assets/atlas.json`, and re-running the generator leaves existing frames untouched.
- Screenshots inspected: menu, board mid-level, win, lose, level select after a win, broken-level error, and level 4 and 5 clears.

### Resume here
1. A-008 is still marked "needs confirmation". R-011's formula is what is implemented and tested, so confirming it would just close the assumption.
2. The route solver in `src/logic/route.js` assumes any two adjacent open cells can be joined, which holds only because the queue is unlimited and offers both piece types. If a future change caps the queue or adds piece types, that assumption needs revisiting.
3. The canvas is still a fixed 1280x720 framebuffer, so on a 2x display the browser stretches it. The 2x source detail hides this well, but a genuinely native-HiDPI build would mean raising the world resolution and re-deriving every layout constant.
4. `tools/scenarios/diag.mjs` and `probe.mjs` are leftover debugging scratch, not tests; safe to delete.
5. §5 still records the builder as "Claude Sonnet (tier A) … tool Claude Code", inherited from the spec's origin and no longer accurate for this build.

## 8. Change log
- 0.1 — Initial draft from /spec-plus interview.
- 0.2 — Approved. Renamed to Pipe Nightmare; added R-011 scoring (fewer tiles = higher score), A-008, T-007; tuning moved to T-008; resolved Q-001, Q-002.
- 0.3 — R-009: added the on-screen game title (menu and game screen) after review of the first working GUI.
- 0.4 — R-005: added an optional player-controlled fast-forward (3x) button; water speed is otherwise still constant within a level.
- 0.5 — Reset every task in §7 to `todo`. The backlog had been carried over from a completed build of this spec; the project is being restarted from scratch. No requirement changed.
- 0.6 — R-008 rewritten at the requester's direction: graphics are now pre-generated PNG assets in `assets/`, authored offline by `tools/generate_assets.py`, instead of textures generated at boot by browser JS. §5 stack and file list updated; A-001 resolved to Phaser 3.90.0; A-009 (visual style) and A-010 (frame-based water fill) added; T-001 reworded.
- 0.7 — Backlog statuses set from the actual build state (T-001..T-004 `done`, T-005..T-008 `in-progress`), with a record of what has been verified, what has not, and where to resume. Levels re-tuned at the requester's direction: their 8x8 level 1 and 6x6 level 2 grids and wall layouts kept, water tempo set to 2400/2000/1700/1400/1100 ms per tile. R-007 read as allowing an individual level to have a smaller grid, because its difficulty levers are joined by "or".
- 0.8 — All eight tasks `done` after end-to-end verification in headless Chrome: every level beaten with real mouse input, and the spill, retry, rotation-lock, corrupt-storage and invalid-level paths exercised. Level fetches are now cache-busted (`src/levelUrl.js`) — without it Chrome can serve a stale level JSON and R-002's "no code change" criterion silently fails. `smoke.mjs` additionally asserts that no request leaves the machine, covering R-001. Added `README.md` and a `.gitignore` that excludes the plaintext `api` key at the repo root.
- 0.9 — Artwork rebuilt at 2 PNG pixels per world unit (128px tile frames) and redrawn: pipes are now gradient-shaded steel with specular banding and coupling collars, the source is a tap with a valve wheel and a drop at the mouth, the drain is a bucket. `bg` and `title` moved out of the atlas into their own files, so the atlas is 146 frames. A-009 rewritten, A-011 and the §5 resolution notes added. Two defects found and fixed on the way: the level-URL cache-bust counter reset on reload, so it could still serve stale JSON across a page load; and `load.json` threw an uncaught SyntaxError on a malformed level file, so the menu now loads levels as text and parses them itself, keeping the console clean. A HiDPI framebuffer workaround was measured and rejected — it adds no detail over fixed-resolution textures.
- 0.10 — Fixed a reported glitch: a bright dot left behind on every completed tile. Two compounding causes in `draw_water` — the fill gradient ended on the dark edge colour, so bands painted widest-first left the centreline dark (luminance 78) instead of bright, and the separate meniscus highlight was then the only bright mark, sitting at the tile exit (214) on the full frame. The gradient now ends bright, the meniscus is gone, and the full-tile centreline measures a flat 232 with no spike. Added `tools/scenarios/water-midflow.mjs`, which captures the board part-way along a route — the only place this artifact was visible.
- 0.11 — Added optional AI material skins as an authoring step: `tools/fetch_skin.py` fetches swatches from `qwen-image-3.0-pro` and `generate_assets.py --skin <name>` transfers their hue and grain onto the existing frames, keeping procedural shading and alpha. Restyling whole frames was measured and rejected — the model repaints a pipe's dark bore as background (silhouette IoU 0.53 against the source alpha), which would hollow every tile and break A-011 — so the model supplies material only. Swatches are committed under `assets/skins/` to keep R-008's byte-for-byte regeneration and R-001's no-network rule intact; without `--skin` the generator still reproduces the committed `assets/` exactly, verified by hash, by an empty alpha-difference bounding box, by the edge and water-front checks, and by `smoke.mjs` and `water-midflow.mjs` on a skinned atlas.
- 0.12 — Artwork moved out of the generator and into the repo: every frame is now an individual PNG in `assets/frames/`, and `assets/atlas.png`/`atlas.json` are derived by packing those files. Requested so that a single image can be tweaked at will, alone or as a group, without going back through Python — the generator is a bootstrap that leaves existing frames alone (`--force` redraws, `--pack-only` only repacks). Added `tools/edit_asset.py`, which asks `qwen-image-3.0-pro` for an adjusted version of one frame or a group and lands it in `assets/proposals/` unless `--apply` is passed. R-008's "deleting `assets/` and re-running restores identical files" criterion was reworded: hand-edited PNGs cannot be reproducible, so the property that remains is that packing the frames is lossless and deterministic — verified by the round trip through 146 loose PNGs hashing byte-identical to the committed atlas, by `smoke.mjs` and `node --test` (71/71) unchanged, and by the edge and water-front checks after an applied edit. `src/` did not change: `setFrame` only works within one texture, and the water fill and rotation both animate by swapping frames, so the atlas stays the runtime format. Three guards run on every model answer because a live call showed the model cannot be trusted with them — the frame's own alpha, its bore, and its pixels anywhere the original was semi-transparent (the flat background bleeds through the contact shadow).
- 0.13 — Added the decoration pipeline: `tools/make_decals.py` (generate or re-slice a decoration sheet, detect shapes over a keyed background, cut them into `assets/decals/`) and `tools/place_decals.py` (paste them onto the pipe frames from an editable `placement.json`, idempotent via pristine copies in `assets/frames/base/`, `--undo` to reverse). This is the model-side answer to "ice and snow on the pipes": the guards in `edit_asset.py` restore the frame's own alpha, so a per-frame call physically cannot add pixels outside the existing outline, and drawing the features in code was rejected as unreachable for an artist. The placer keeps the bore, the open-end collars and the middle of every edge clear by construction — measured on a first attempt that let an icicle reach a closed south edge and produce one edge mismatch, and let wide caps overhang the other arm's bore at four of the six shapes. Also `tools/image_model.py`, so the endpoint protocol lives in one place. `assets/frames/` is now tracked: note that the artwork it captured had already been re-materialled to a warm copper by a `--skin` run outside this session, with a swatch that is not in the repo, so the committed look changes from the 0.9 steel described in A-009 — the steel is still one `generate_assets.py --force` plus a repack away, and `HEAD~1` holds it.
