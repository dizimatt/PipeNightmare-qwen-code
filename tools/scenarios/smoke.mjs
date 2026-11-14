export async function run(t) {
  await t.goto();

  const state = await t.game();
  if (!state || !state.ready) throw new Error(`Phaser never booted: ${JSON.stringify(state)}`);

  const active = state.scenes.filter((s) => s.active).map((s) => s.key);
  if (!active.includes('menu')) {
    throw new Error(`menu scene is not running (active: ${JSON.stringify(active)}, all: ${JSON.stringify(state.scenes)})`);
  }

  const frames = await t.eval(`
    const g = window.__pipeNightmareGame;
    const tex = g.textures.get('atlas');
    return {
      atlas: tex.getFrameNames().filter(n => n !== '__BASE').length,
      title: g.textures.exists('title'),
      bg: g.textures.exists('bg'),
      size: g.textures.get('atlas').get('pipe_ew').width
    };
  `);
  if (frames.atlas < 140) throw new Error(`atlas loaded only ${frames.atlas} frames`);
  if (!frames.title || !frames.bg) throw new Error(`standalone textures missing: ${JSON.stringify(frames)}`);
  if (frames.size !== 128) throw new Error(`expected 128px tile frames, got ${frames.size}`);

  // R-001: Phaser and every asset must come from the repo, not a CDN.
  // blob: URLs are unwrapped first because Phaser builds its worker from a
  // same-origin blob rather than fetching anything remote.
  const external = t.requests.filter((u) => {
    const raw = u.startsWith('blob:') ? u.slice('blob:'.length) : u;
    if (raw.startsWith('data:')) return false;
    try {
      return new URL(raw).hostname !== '127.0.0.1';
    } catch {
      return true;
    }
  });
  if (external.length) throw new Error(`requests left the machine: ${external.join(', ')}`);

  const version = await t.eval(`return window.Phaser.VERSION;`);
  if (version !== '3.90.0') throw new Error(`expected vendored Phaser 3.90.0, got ${version}`);

  await t.shot('smoke-menu');
  console.log(`menu running, Phaser ${version}, ${frames.atlas} atlas frames at ${frames.size}px, `
    + `${t.requests.length} requests all local`);
}
