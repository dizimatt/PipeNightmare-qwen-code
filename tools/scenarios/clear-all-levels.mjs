// Beats all five levels with real mouse input. The route for each level is
// computed in the page by the same solver the tests use, the queue is then
// scripted to hand out exactly the pieces that route needs, and every tile
// is placed and rotated by clicking it — so this exercises the whole game,
// not just the rules underneath it.
//
// Played at 1x on purpose: the bot clicks at a fixed real-time rate, so the
// unaccelerated water is the harder-but-fair test of whether a level is
// actually playable.

const CARDS = [176, 408, 640, 872, 1104];   // level select card centres
const LEVEL_SELECT_BTN = [700, 400];

async function menuActive(t) {
  const st = await t.game();
  return !!st.scenes?.find((s) => s.key === 'menu')?.active;
}

export async function run(t) {
  await t.goto();
  if (!(await menuActive(t))) throw new Error('menu not running after load');

  const report = [];

  for (let level = 1; level <= 5; level += 1) {
    if (!(await menuActive(t))) throw new Error(`menu was not showing before level ${level}`);

    await t.click(CARDS[level - 1], 470);
    await t.wait(800);

    let st = await t.game();
    if (!st.game || st.game.level !== level) throw new Error(`level ${level} did not start: ${JSON.stringify(st)}`);

    const plan = await t.eval(`
      const m = await import('/src/logic/route.js');
      const s = window.__pipeNightmareGame.scene.getScene('game');
      const route = m.findRoute(s.level);
      if (!route) return { error: 'no route' };
      const pieces = m.piecesForRoute(s.level, route);
      return { ox: s.originX, oy: s.originY, pieces, ms: s.level.waterMsPerTile, delay: s.level.startDelayMs };
    `);
    if (plan.error) throw new Error(`level ${level}: ${plan.error}`);

    await t.eval(`
      const s = window.__pipeNightmareGame.scene.getScene('game');
      const seq = ${JSON.stringify(plan.pieces.map((p) => p.type))};
      s.queue.items = seq.slice(0, s.queue.size);
      let i = s.queue.items.length;
      s.queue.rng = () => (seq[i++] === 'straight' ? 0.1 : 0.9);
      s.refreshQueue();
      return s.queue.view();
    `);

    for (const p of plan.pieces) {
      const x = plan.ox + p.col * 64 + 32;
      const y = plan.oy + p.row * 64 + 32;
      for (let turn = 0; turn <= p.rotation; turn += 1) await t.click(x, y);
    }

    await t.wait(150);
    st = await t.game();
    if (st.game.tiles !== plan.pieces.length) {
      throw new Error(`level ${level}: placed ${st.game.tiles}, route wanted ${plan.pieces.length}`);
    }

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      st = await t.game();
      if (st.game.over) break;
      await t.wait(300);
    }
    if (!st.game.over) throw new Error(`level ${level} never resolved`);
    if (st.game.flowPhase !== 'won') {
      throw new Error(`level ${level} did not win: ${st.game.flowPhase} (${st.game.spill}) after ${st.game.tiles} tiles`);
    }

    const expected = Math.max(0, 1000 - 50 * plan.pieces.length);
    await t.shot(`clear-level-${level}`);
    report.push(`level ${level}: ${plan.pieces.length} tiles, score ${expected}`);

    await t.click(...LEVEL_SELECT_BTN);
    await t.wait(900);
  }

  const saved = await t.eval(`return JSON.parse(localStorage.getItem('pipe-nightmare.v1') || 'null');`);
  if (!saved) throw new Error('nothing saved after clearing the game');
  if (saved.unlocked !== 5) throw new Error(`expected all 5 unlocked, got ${saved.unlocked}`);
  for (let level = 1; level <= 5; level += 1) {
    if (!Number.isInteger(saved.best[level]) || saved.best[level] <= 0) {
      throw new Error(`level ${level} has no usable best score: ${JSON.stringify(saved.best)}`);
    }
  }

  await t.shot('menu-all-cleared');
  console.log(report.join('\n'));
  console.log(`saved best: ${JSON.stringify(saved.best)}`);
}
