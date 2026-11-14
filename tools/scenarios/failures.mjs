// Covers the ways the game is supposed to fail or refuse: spilling, retry,
// rotation lock once the water has entered a tile, corrupt localStorage, and
// a level file that is not valid JSON.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const LEVEL1 = path.join(ROOT, 'levels', 'level-1.json');

async function untilOver(t, ms = 40000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const st = await t.game();
    if (st.game?.over) return st;
    await t.wait(250);
  }
  throw new Error(`level never resolved: ${JSON.stringify((await t.game()).game)}`);
}

export async function run(t) {
  await t.goto();

  const geo = async () => t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return { ox: s.originX, oy: s.originY, row: s.level.sourceRow, width: s.level.width };
  `);

  // ---- spilling with nothing placed -------------------------------------
  await t.click(176, 470);
  await t.wait(600);
  await t.click(1080, 44);                       // 3x
  const done1 = await untilOver(t);
  const g1 = done1.game;

  if (g1.flowPhase !== 'spilled') throw new Error(`expected spilled, got ${JSON.stringify(g1)}`);
  if (g1.spill !== 'gap') throw new Error(`expected a gap spill at the source, got ${g1.spill}`);
  if (g1.tiles !== 0) throw new Error(`nothing should have been placed, tiles=${g1.tiles}`);

  await t.shot('lose-screen');
  const afterLoss = await t.eval(`return JSON.parse(localStorage.getItem('pipe-nightmare.v1') || 'null');`);
  if (afterLoss) throw new Error(`a lost level must save nothing, stored ${JSON.stringify(afterLoss)}`);

  // ---- retry restores the starting state --------------------------------
  await t.click(520, 400);                       // Retry
  await t.wait(900);
  let st = await t.game();
  if (st.game.over || st.game.tiles !== 0 || st.game.phase !== 'countdown') {
    throw new Error(`retry did not reset: ${JSON.stringify(st.game)}`);
  }
  if (st.game.fast) throw new Error('retry should switch fast forward back off');

  // ---- a tile the water has entered cannot be rotated -------------------
  const g = await geo();
  const cell = (col) => [g.ox + col * 64 + 32, g.oy + g.row * 64 + 32];

  await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    s.queue.rng = () => 0.1;
    s.queue.items = s.queue.items.map(() => 'straight');
    s.refreshQueue();
    return 1;
  `);
  for (let col = 0; col < g.width; col += 1) await t.click(...cell(col));
  await t.click(1080, 44);                       // 3x

  let wet = 0;
  const wetDeadline = Date.now() + 30000;
  while (Date.now() < wetDeadline && wet < 2) {
    wet = (await t.game()).game.pathLen;
    if (wet < 2) await t.wait(150);
  }
  if (wet < 2) throw new Error(`water never reached the second tile (path=${wet})`);

  const before = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return { r: s.grid.at(s.level.sourceRow, 0).rotation, locked: s.grid.isLocked(s.level.sourceRow, 0) };
  `);
  if (!before.locked) throw new Error('water has passed this tile but it is not locked');
  await t.click(...cell(0));
  const after = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return s.grid.at(s.level.sourceRow, 0).rotation;
  `);
  if (after !== before.r) throw new Error(`locked tile rotated ${before.r} -> ${after}`);

  // A tile ahead of the water must still turn.
  const far = Math.min(wet + 2, g.width - 1);
  const farState = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return { locked: s.grid.isLocked(s.level.sourceRow, ${far}), r: s.grid.at(s.level.sourceRow, ${far}).rotation };
  `);
  if (farState.locked) throw new Error(`tile ${far} should still be ahead of the water`);
  await t.click(...cell(far));
  const farAfter = await t.eval(`
    const s = window.__pipeNightmareGame.scene.getScene('game');
    return s.grid.at(s.level.sourceRow, ${far}).rotation;
  `);
  if (farAfter !== (farState.r + 1) % 4) throw new Error(`unlocked tile did not rotate: ${farState.r} -> ${farAfter}`);

  // ---- corrupt localStorage must not stop the menu ----------------------
  await t.eval(`localStorage.setItem('pipe-nightmare.v1', '{{{ not json'); return 1;`);
  await t.goto();
  const unlockedAfterGarbage = await t.eval(`
    const m = await import('/src/logic/storage.js');
    return m.loadProgress().unlocked;
  `);
  if (unlockedAfterGarbage !== 1) throw new Error(`garbage store gave unlocked=${unlockedAfterGarbage}`);
  const menuState = await t.game();
  if (!menuState.scenes.find((s) => s.key === 'menu')?.active) {
    throw new Error('menu did not survive a corrupt store');
  }

  // ---- a level file that is not valid JSON ------------------------------
  const original = readFileSync(LEVEL1, 'utf8');
  try {
    writeFileSync(LEVEL1, '{ "width": 5, oops');
    await t.goto();
    await t.wait(600);

    const broken = await t.eval(`
      const m = await import('/src/logic/level.js');
      return m.parseLevelJson('{ "width": 5, oops', 'level-1.json').errors;
    `);
    if (!broken?.length || !/not valid JSON/.test(broken[0])) {
      throw new Error(`parser gave ${JSON.stringify(broken)}`);
    }

    await t.click(176, 470);                     // the broken card
    await t.wait(800);
    const scenes = (await t.game()).scenes;
    if (!scenes.find((s) => s.key === 'error')?.active) {
      throw new Error(`broken level did not route to the error scene: ${JSON.stringify(scenes)}`);
    }
    await t.shot('broken-level-error');
  } finally {
    writeFileSync(LEVEL1, original);
  }

  if (readFileSync(LEVEL1, 'utf8') !== original) throw new Error('level-1.json was not restored');

  await t.goto();
  await t.wait(600);
  if (!(await t.game()).scenes.find((s) => s.key === 'menu')?.active) {
    throw new Error('menu did not come back after restoring the level file');
  }

  console.log('lose, retry, rotation lock, corrupt storage and broken level data all handled');
}
