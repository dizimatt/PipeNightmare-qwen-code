// Every PNG in assets/ is authored at ASSET_SCALE pixels per world unit (see
// tools/generate_assets.py). The game world stays 1280x720 with 64-unit tiles
// so no layout or logic constant changes; each sprite is simply drawn at
// 1/ASSET_SCALE, which is what buys the extra detail.

export const ASSET_SCALE = 2;
export const DRAW_SCALE = 1 / ASSET_SCALE;

export function image(scene, x, y, key, frame = null, extraScale = 1) {
  const obj = frame ? scene.add.image(x, y, key, frame) : scene.add.image(x, y, key);
  return obj.setScale(DRAW_SCALE * extraScale);
}

// `corner` is the nine-slice inset in world units; the source frame is
// ASSET_SCALE times larger, so it has to be scaled up to match.
export function slice(scene, x, y, key, frame, width, height, corner = 20) {
  const s = corner * ASSET_SCALE;
  return scene.add.nineslice(x, y, key, frame, width, height, s, s, s, s);
}
