#!/usr/bin/env node
// Reports, for every level file, whether it is winnable and what a perfect
// run costs. Used to tune the five levels (T-008) without guessing.
//
//   node tools/tune-levels.mjs

import { readFileSync } from 'node:fs';
import { validateLevel } from '../src/logic/level.js';
import { findRoute, piecesForRoute } from '../src/logic/route.js';
import { Grid } from '../src/logic/grid.js';
import { createFlow, stepWater, FlowPhase, formatSpill } from '../src/logic/water.js';
import { scoreFor } from '../src/logic/scoring.js';
import { LEVEL_COUNT } from '../src/logic/storage.js';

const TILE = 64;
let allOk = true;
const rows = [];

for (let n = 1; n <= LEVEL_COUNT; n += 1) {
  const label = `level-${n}.json`;
  const res = validateLevel(JSON.parse(readFileSync(new URL(`../levels/${label}`, import.meta.url), 'utf8')), label);
  if (!res.ok) {
    console.log(`${label}: INVALID — ${res.errors.join('; ')}`);
    allOk = false;
    continue;
  }
  const level = res.level;
  const route = findRoute(level);
  if (!route) {
    console.log(`${label}: NO ROUTE`);
    allOk = false;
    continue;
  }

  const grid = new Grid(level);
  piecesForRoute(level, route).forEach((p) => grid.place(p.row, p.col, p.type, p.rotation));
  let flow = createFlow(level);
  for (let i = 0; i < 500 && flow.phase === FlowPhase.FLOWING; i += 1) flow = stepWater(flow, grid);
  if (flow.phase !== FlowPhase.WON) {
    console.log(`${label}: route exists but the sim says ${flow.phase} — ${formatSpill(flow.spill)}`);
    allOk = false;
    continue;
  }

  const turns = route.length - 1;
  const tiles = grid.tilesPlaced;
  const seconds = level.startDelayMs / 1000 + (tiles + 1) * (level.waterMsPerTile / 1000);
  rows.push({ n, name: level.name, cells: level.width * level.height, blocked: level.blocked.length, tiles, score: scoreFor(tiles), delay: level.startDelayMs, ms: level.waterMsPerTile, seconds });
}

const pad = (s, w) => String(s).padEnd(w);
console.log(pad('lv', 3) + pad('name', 15) + pad('cells', 7) + pad('walls', 7) + pad('route', 7) + pad('score', 7) + pad('delay', 8) + pad('ms/tile', 9) + 'level length');
for (const r of rows) {
  console.log(
    pad(r.n, 3) + pad(r.name, 15) + pad(r.cells, 7) + pad(r.blocked, 7) + pad(r.tiles, 7) +
    pad(r.score, 7) + pad(r.delay, 8) + pad(r.ms, 9) + `${r.seconds.toFixed(1)}s`
  );
}

const mono = (key, dir) => rows.every((r, i) => i === 0 || (dir === 'down' ? r[key] < rows[i - 1][key] : r[key] >= rows[i - 1][key]));
console.log('\ncurves: cells non-shrinking', mono('cells', 'up'),
  '| walls non-decreasing', mono('blocked', 'up'),
  '| delay strictly down', mono('delay', 'down'),
  '| water strictly faster', mono('ms', 'down'),
  '| score strictly down', mono('score', 'down'));
console.log(allOk ? '\nall levels winnable' : '\nSOME LEVELS BROKEN');
process.exit(allOk ? 0 : 1);
