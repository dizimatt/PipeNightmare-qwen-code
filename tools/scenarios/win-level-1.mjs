// Plays level 1 to a win through real mouse input, then checks scoring,
// unlocking and saved progress. Nothing is derived from the tuning: the
// scenario reads the level's own width and rows out of the running game.
//
// Determinism comes from the queue's injected rng (R-003), not from stubbing
// Math.random: Phaser also uses Math.random to make texture UUIDs, so a
// constant Math.random makes every generated UUID collide and the Text
// factory then throws.

export async function run(t) {
  await t.goto();
  await t.click(176, 470);            // level 1 card
  await t.wait(700);

  let st = await t.game();
  if (!st.game) throw new Error(`game scene did not start: ${JSON.stringify(st.scenes)}`);
  if (st.game.level !== 1) throw new Error(`expected level 1, got ${st.game.level}`);
  if (st.game.tiles !== 0 || st.game.phase !== 'countdown') {
    throw new Error(`unexpected fresh state: ${JSON.stringify(st.game)}`);
  }
  if (st.game.flowPhase !== null) {
    throw new Error(`water should not be flowing during the delay: ${st.game.flowPhase}`);
  }

  const geo = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    const onRow = s.level.blocked.some(b => b.row === s.level.sourceRow);
    return { ox: s.originX, oy: s.originY, row: s.level.sourceRow, width: s.level.width,
             drain: s.level.drainRow, blockedOnRow: onRow };
  `);
  if (geo.drain !== geo.row) {
    throw new Error(`level 1 is no longer a straight shot (source row ${geo.row}, drain row ${geo.drain})`);
  }
  if (geo.blockedOnRow) throw new Error('level 1 now has a blocked cell on the corridor row');

  await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    s.queue.rng = () => 0.1;
    s.queue.items = s.queue.items.map(() => 'straight');
    s.refreshQueue();
    return 1;
  `);

  const cell = (col) => [geo.ox + col * 64 + 32, geo.oy + geo.row * 64 + 32];

  await t.click(1080, 44);            // fast forward on: 3x, and must not change the score
  await t.wait(100);
  st = await t.game();
  if (!st.game.fast) throw new Error('fast forward did not engage');

  for (let col = 0; col < geo.width; col += 1) await t.click(...cell(col));
  await t.wait(200);

  st = await t.game();
  if (st.game.tiles !== geo.width) throw new Error(`expected ${geo.width} tiles placed, got ${st.game.tiles}`);
  if (st.game.queue.length !== 5) throw new Error(`queue should stay at 5, got ${st.game.queue.length}`);
  if (st.game.queue.some((q) => q !== 'straight')) throw new Error(`queue refilled wrong: ${st.game.queue}`);

  await t.shot('play-board');

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    st = await t.game();
    if (st.game.over) break;
    await t.wait(250);
  }
  if (!st.game.over) throw new Error(`level never resolved: ${JSON.stringify(st.game)}`);
  if (st.game.flowPhase !== 'won') throw new Error(`expected a win, got ${st.game.flowPhase} (${st.game.spill})`);
  if (st.game.pathLen !== geo.width) throw new Error(`water should cross ${geo.width} tiles, path=${st.game.pathLen}`);

  const expected = Math.max(0, 1000 - 50 * geo.width);
  await t.wait(300);
  await t.shot('play-win');

  const saved = await t.eval(`return JSON.parse(localStorage.getItem('pipe-nightmare.v1') || 'null');`);
  if (!saved) throw new Error('progress was not saved');
  if (saved.unlocked !== 2) throw new Error(`expected level 2 unlocked, got ${saved.unlocked}`);
  if (saved.best['1'] !== expected) {
    throw new Error(`expected score ${expected} for ${geo.width} tiles at 3x, got ${JSON.stringify(saved.best)}`);
  }

  await t.click(640, 470);            // "Level 2" button
  await t.wait(900);
  st = await t.game();
  if (!st.game || st.game.level !== 2) throw new Error(`next level did not load: ${JSON.stringify(st)}`);
  if (st.game.tiles !== 0) throw new Error('next level should start with no tiles placed');
  if (st.game.fast) throw new Error('a new level should start with fast forward off');
  await t.shot('play-level2');

  await t.eval(`window.__pipeNightmareGame.scene.getScene('game').scene.start('menu'); return 1;`);
  await t.wait(1000);
  await t.shot('menu-after-win');

  console.log(`level 1 won: ${geo.width} tiles, score ${expected} at 3x, level 2 unlocked and loaded`);
}
