export const LEVEL_COUNT = 5;
const STORE_KEY = 'pipe-nightmare.v1';

export function defaultProgress() {
  return { unlocked: 1, best: {} };
}

function validScore(v) {
  return Number.isInteger(v) && v >= 0 && v <= 1000;
}

function validLevelKey(v) {
  return Number.isInteger(v) && v >= 1 && v <= LEVEL_COUNT;
}

// R-007 / R-011: a missing, blocked or corrupt store must never stop the
// game. Everything degrades to "only level 1 unlocked, no scores".
export function loadProgress(storage) {
  let raw = null;
  try {
    const s = storage ?? globalThis.localStorage;
    if (!s) return defaultProgress();
    raw = s.getItem(STORE_KEY);
  } catch {
    return defaultProgress();
  }
  if (!raw) return defaultProgress();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultProgress();
  }
  if (parsed === null || typeof parsed !== 'object') return defaultProgress();

  const unlocked = Number.isInteger(parsed.unlocked)
    ? Math.min(LEVEL_COUNT, Math.max(1, parsed.unlocked))
    : 1;

  const best = {};
  if (parsed.best !== null && typeof parsed.best === 'object' && !Array.isArray(parsed.best)) {
    for (const [k, v] of Object.entries(parsed.best)) {
      const level = Number(k);
      if (validLevelKey(level) && validScore(v)) best[level] = v;
    }
  }
  return { unlocked, best };
}

export function saveProgress(progress, storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    if (!s) return false;
    s.setItem(STORE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function isUnlocked(progress, level) {
  return level >= 1 && level <= progress.unlocked;
}

export function bestScore(progress, level) {
  return validScore(progress.best?.[level]) ? progress.best[level] : null;
}

// R-007: winning level N unlocks N+1.
export function withUnlock(progress, level) {
  const unlocked = Math.min(LEVEL_COUNT, Math.max(progress.unlocked, level + 1));
  return { ...progress, unlocked };
}

// R-011: a lower score on a replay must not overwrite the best.
export function withBest(progress, level, score) {
  if (!validLevelKey(level) || !validScore(score)) return progress;
  const current = bestScore(progress, level);
  if (current !== null && current >= score) return progress;
  return { ...progress, best: { ...progress.best, [level]: score } };
}
