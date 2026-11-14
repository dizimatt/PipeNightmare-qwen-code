// R-002: the level file is the whole definition of a level, so anything the
// game needs must be data here. Validation returns readable messages rather
// than throwing, so the caller can show them instead of a blank screen.

export const LEVEL_FIELDS = ['width', 'height', 'sourceRow', 'drainRow', 'blocked', 'queueSize', 'startDelayMs', 'waterMsPerTile'];

function isInt(v) {
  return Number.isInteger(v);
}

export function validateLevel(raw, label = 'level') {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`${label}: expected a JSON object, got ${Array.isArray(raw) ? 'an array' : typeof raw}`], level: null };
  }

  for (const field of LEVEL_FIELDS) {
    if (raw[field] === undefined) errors.push(`${label}: missing required field "${field}"`);
  }
  if (errors.length) return { ok: false, errors, level: null };

  const { width, height } = raw;
  if (!isInt(width) || width < 2) errors.push(`${label}: "width" must be an integer of at least 2, got ${JSON.stringify(width)}`);
  if (!isInt(height) || height < 1) errors.push(`${label}: "height" must be an integer of at least 1, got ${JSON.stringify(height)}`);

  if (isInt(width) && isInt(height)) {
    if (!isInt(raw.sourceRow) || raw.sourceRow < 0 || raw.sourceRow >= height) {
      errors.push(`${label}: "sourceRow" must be 0..${height - 1}, got ${JSON.stringify(raw.sourceRow)}`);
    }
    if (!isInt(raw.drainRow) || raw.drainRow < 0 || raw.drainRow >= height) {
      errors.push(`${label}: "drainRow" must be 0..${height - 1}, got ${JSON.stringify(raw.drainRow)}`);
    }
  }

  if (!Array.isArray(raw.blocked)) {
    errors.push(`${label}: "blocked" must be an array of {row, col}, got ${JSON.stringify(raw.blocked)}`);
  } else {
    const seen = new Set();
    raw.blocked.forEach((cell, i) => {
      if (cell === null || typeof cell !== 'object' || !isInt(cell.row) || !isInt(cell.col)) {
        errors.push(`${label}: blocked[${i}] must have integer "row" and "col", got ${JSON.stringify(cell)}`);
        return;
      }
      if (!isInt(width) || !isInt(height)) return;
      if (cell.row < 0 || cell.row >= height || cell.col < 0 || cell.col >= width) {
        errors.push(`${label}: blocked[${i}] row ${cell.row}, col ${cell.col} is outside the ${width}x${height} grid`);
        return;
      }
      const key = `${cell.row},${cell.col}`;
      if (seen.has(key)) {
        errors.push(`${label}: blocked[${i}] row ${cell.row}, col ${cell.col} is listed twice`);
        return;
      }
      seen.add(key);
      if (cell.row === raw.sourceRow && cell.col === 0) {
        errors.push(`${label}: blocked[${i}] seals the cell the source flows into`);
      }
      if (cell.row === raw.drainRow && cell.col === width - 1) {
        errors.push(`${label}: blocked[${i}] seals the cell the drain empties from`);
      }
    });
  }

  if (!isInt(raw.queueSize) || raw.queueSize < 1) {
    errors.push(`${label}: "queueSize" must be a positive integer, got ${JSON.stringify(raw.queueSize)}`);
  }
  if (typeof raw.startDelayMs !== 'number' || !Number.isFinite(raw.startDelayMs) || raw.startDelayMs <= 0) {
    errors.push(`${label}: "startDelayMs" must be a positive number, got ${JSON.stringify(raw.startDelayMs)}`);
  }
  if (typeof raw.waterMsPerTile !== 'number' || !Number.isFinite(raw.waterMsPerTile) || raw.waterMsPerTile <= 0) {
    errors.push(`${label}: "waterMsPerTile" must be a positive number, got ${JSON.stringify(raw.waterMsPerTile)}`);
  }

  if (errors.length) return { ok: false, errors, level: null };

  return {
    ok: true,
    errors: [],
    level: {
      name: typeof raw.name === 'string' ? raw.name : label,
      width,
      height,
      sourceRow: raw.sourceRow,
      drainRow: raw.drainRow,
      blocked: raw.blocked.map(({ row, col }) => ({ row, col })),
      queueSize: raw.queueSize,
      startDelayMs: raw.startDelayMs,
      waterMsPerTile: raw.waterMsPerTile
    }
  };
}

export function parseLevelJson(text, label = 'level') {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`${label}: not valid JSON — ${err.message}`], level: null };
  }
  return validateLevel(raw, label);
}
