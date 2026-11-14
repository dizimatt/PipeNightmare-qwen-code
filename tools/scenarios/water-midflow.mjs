// Captures the board with water part-way along the route, which is where the
// leftover "dot" on completed tiles was visible.

export async function run(t) {
  await t.goto();
  await t.click(176, 470);
  await t.wait(700);

  const geo = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return { ox: s.originX, oy: s.originY, row: s.level.sourceRow, width: s.level.width };
  `);
  await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    s.queue.rng = () => 0.1;
    s.queue.items = s.queue.items.map(() => 'straight');
    s.refreshQueue();
    return 1;
  `);
  for (let col = 0; col < geo.width; col += 1) {
    await t.click(geo.ox + col * 64 + 32, geo.oy + geo.row * 64 + 32);
  }

  await t.click(1080, 44);                       // 3x
  let wet = 0;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && wet < 4) {
    wet = (await t.game()).game.pathLen;
    if (wet < 4) await t.wait(120);
  }
  console.log(`water has entered ${wet} tiles`);
  await t.shot('water-midflow');

  const st = await t.game();
  if (st.game.flowPhase !== 'flowing') throw new Error(`expected flowing, got ${st.game.flowPhase}`);
  console.log('captured mid-flow');
}
