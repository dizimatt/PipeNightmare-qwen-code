// Headless verification harness for Pipe Nightmare.
//
// Serves the repo over HTTP, drives a real Chrome over the DevTools protocol,
// and fails loudly on any console error or uncaught exception — which is how
// R-001's "starts the game with no console errors" gets checked for real.
//
//   node tools/headless.mjs tools/scenarios/smoke.mjs
//
// A scenario exports `async function run(t)`, where t offers:
//   t.goto(path)      navigate and settle
//   t.click(x, y)     real mouse click in 1280x720 game coordinates
//   t.eval(js)        await an expression inside the page
//   t.shot(name)      screenshot to .qwen/shots/<name>.png
//   t.wait(ms)        pause
//   t.game()          the live Phaser scene state, as plain data
//   t.errors          every console error / exception seen so far
//
// No third-party dependencies: Node 24 ships a global WebSocket.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SHOTS = path.join(ROOT, '.qwen', 'shots');
const HTTP_PORT = Number(process.env.HTTP_PORT || 8573);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html`;

mkdirSync(SHOTS, { recursive: true });

const procs = [];
async function killAll() {
  for (const p of procs) {
    try { p.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function spawnWait(cmd, args, ready, label) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(child);
  let buf = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not become ready\n${buf}`)), 30000);
    const onData = (d) => {
      buf += d.toString();
      if (ready(buf)) { clearTimeout(timer); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`${label} exited early (${c})\n${buf}`)); });
  });
}

async function waitForHttp(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 404) return;
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  throw new Error(`${label} never answered on ${url}`);
}

function spawnDetached(cmd, args, label) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(child);
  child.on('exit', (c) => {
    if (c !== 0 && c !== null) console.error(`note: ${label} exited with ${c}`);
  });
  return child;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ''}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn) { this.listeners.push(fn); }
}

async function connectCdp() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = (await res.json()).filter((t) => t.type === 'page');
      if (targets.length) {
        const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
        });
        return new CDP(ws);
      }
    } catch { /* chrome not up yet */ }
    await sleep(250);
  }
  throw new Error('could not reach the Chrome debugging endpoint');
}

const GAME_STATE = `(() => {
  const g = window.__pipeNightmareGame;
  if (!g) return { ready: false };
  const scenes = g.scene.scenes.map(s => ({ key: s.sys.settings.key, active: s.sys.isActive() }));
  const out = { ready: g.isBooted, scenes };
  const game = g.scene.getScene('game');
  if (game && game.level) {
    out.game = {
      level: game.levelIndex,
      phase: game.phase,
      over: game.over,
      fast: game.fast,
      tiles: game.grid ? game.grid.tilesPlaced : null,
      queue: game.queue ? game.queue.view() : null,
      flowPhase: game.flow ? game.flow.phase : null,
      pathLen: game.flow ? game.flow.path.length : 0,
      spill: game.flow && game.flow.spill ? game.flow.spill.reason : null,
      countdown: game.countdown,
      waterMs: game.level.waterMsPerTile,
      delayMs: game.level.startDelayMs
    };
  }
  return out;
})()`;

async function main() {
  const scenarioPath = process.argv[2];
  if (!scenarioPath) throw new Error('usage: node tools/headless.mjs <scenario.mjs>');
  const scenario = await import(pathToFileURL(path.resolve(ROOT, scenarioPath)).href);

  spawnDetached(
    'python3',
    ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1', '--directory', ROOT],
    'http.server'
  );
  await waitForHttp(BASE, 'http.server');

  const profile = mkdtempSync(path.join(tmpdir(), 'pn-chrome-'));
  const chrome = await spawnWait(
    'google-chrome',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1280,720',
      '--hide-scrollbars',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank'
    ],
    (b) => /DevTools listening/.test(b),
    'chrome'
  );

  const cdp = await connectCdp();
  const errors = [];
  const logs = [];
  const requests = [];

  cdp.on((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      requests.push(msg.params.request.url);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`Uncaught: ${d.exception?.description || d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params;
      const text = args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push(`[${type}] ${text}`);
      if (type === 'error') errors.push(`console.error: ${text}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push(`[log:${e.level}] ${e.text}`);
      if (e.level === 'error') errors.push(`${e.source}: ${e.text}`);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  // --window-size is not the viewport in headless Chrome, so pin it exactly
  // to the game's design size or screenshots crop the bottom row.
  // DEVICE_SCALE=2 emulates a HiDPI display; that is how the pixelation
  // report was reproduced.
  const scale = Number(process.env.DEVICE_SCALE || 1);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: scale, mobile: false
  });

  // ES module load failures are not always reported through the Runtime
  // domain, so capture them inside the page from the very first script.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__harnessErrors = [];
      window.addEventListener('error', (e) => {
        window.__harnessErrors.push(String(e.message || e.error || 'error') + (e.filename ? ' at ' + e.filename : ''));
      });
      window.addEventListener('unhandledrejection', (e) => {
        window.__harnessErrors.push('unhandled rejection: ' + String(e.reason));
      });
    `
  });

  let canvasRect = null;
  const t = {
    errors,
    logs,
    requests,
    async goto(url = BASE) {
      await cdp.send('Page.navigate', { url: url.startsWith('http') ? url : BASE.replace('index.html', url) });
      await sleep(1800);
      canvasRect = null;
    },
    async wait(ms) { await sleep(ms); },
    async eval(expr) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true,
        returnByValue: true
      });
      if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
      return r.result.value;
    },
    async game() {
      const r = await cdp.send('Runtime.evaluate', { expression: GAME_STATE, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(`game probe threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r.result.value;
    },
    async pageErrors() {
      return (await t.eval('return window.__harnessErrors || [];')) || [];
    },
    async rect() {
      if (canvasRect) return canvasRect;
      canvasRect = await t.eval(`const c = document.querySelector('canvas').getBoundingClientRect();
        return { x: c.x, y: c.y, w: c.width, h: c.height };`);
      return canvasRect;
    },
    async click(gx, gy) {
      const r = await t.rect();
      const px = r.x + (gx / 1280) * r.w;
      const py = r.y + (gy / 720) * r.h;
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', {
          type, x: px, y: py, button: 'left', clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0
        });
      }
      await sleep(60);
    },
    async shot(name) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(SHOTS, `${name}.png`);
      writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    }
  };

  let code = 0;
  try {
    await scenario.run(t);
  } catch (err) {
    errors.push(`scenario assertion failed: ${err.message}`);
    code = 1;
  }

  for (const e of await t.pageErrors().catch(() => [])) errors.push(`page error: ${e}`);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    code = 1;
  } else {
    console.log('PASS — no console errors or exceptions');
  }
  if (process.env.SHOW_LOGS && logs.length) {
    console.log('\npage console:');
    for (const l of logs.slice(-40)) console.log(`  ${l}`);
  }

  cdp.ws.close();
  await killAll();
  process.exit(code);
}

main().catch(async (err) => {
  console.error('harness error:', err.message);
  await killAll();
  process.exit(2);
});
