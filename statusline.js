#!/usr/bin/env node
// statusman — a two-line Claude Code statusline.
//
//   Rebellions-Lime | daekyeong.kim | Opus 5 | xhigh | statusman | …/src/statusman
//   ██░░░░░░░░░░░░░ 13% 26k | █|███░░░░░░░░░░ 30% 4h25m | ...
//
// The statusline is a list of components (see COMPONENTS). Each one knows how
// to render itself into a column budget and may shrink or bow out when the
// budget is tight; `~/.claude/statusman/settings.json` says which are switched on.
//
// Everything above the IO section is pure: the lines are built from data that
// was already read, and the clock, the terminal width and the settings are all
// arguments, so the tests in test/ can assert on the output without any of them.

"use strict";

const { mkdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const { spawn } = require("child_process");
const { join, basename, dirname } = require("path");
const { homedir } = require("os");

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
/** Bright blue: plain blue is too dark to read against most terminal grounds. */
const BLUE = "\x1b[94m";
const RED = "\x1b[31m";

const BAR_FILLED = "█";
const BAR_EMPTY = "░";
/** Marks how far into the window we are, so pace can be read off the meter. */
const BAR_TICK = "|";
/**
 * Narrowest meter worth drawing. Under five cells the fill rounds to the same
 * block or two across most of the range, so the bar stops carrying anything
 * the percentage beside it does not already give — the row drops to text
 * instead of drawing a stub.
 */
const MIN_BAR_CELLS = 5;
/**
 * Columns Claude Code keeps for itself around the statusline. Measured, not
 * derived: with `padding: 0` and COLUMNS=119, a row came back cut at 115
 * columns, so four is what the surrounding layout takes.
 *
 * A row can still fall a few columns short of the edge — the bars share one
 * width, so whatever does not divide evenly between them stays unused.
 */
const RESERVED_COLUMNS = 4;
const FALLBACK_COLUMNS = 80;
/**
 * Line counts the statusline can be laid out in. Two is the default: one line
 * of identity, one row of gauges. Four splits each of those in half, which
 * buys every component about twice the columns — worth it on a narrow terminal
 * or when the bars are what you are watching.
 */
const LINE_COUNTS = [2, 4];
const DEFAULT_LINES = 2;

const FIVE_HOUR_MS = 5 * 3600_000;
const SEVEN_DAY_MS = 7 * 86400_000;
/**
 * How old the usage snapshot may get before refresh.js is sent after a new one.
 * The scoped weekly cap it carries moves over hours, so ten minutes of staleness
 * costs a percentage point at most.
 */
const REFRESH_TTL_MS = 10 * 60_000;
/**
 * How long one refresh is left to finish. The statusline redraws every few
 * seconds and the request takes a few, so without this every redraw in between
 * would start another one.
 */
const REFRESH_LOCK_MS = 60_000;

const isRecord = (v) => typeof v === "object" && v !== null;
const clampPercent = (p) => (Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0);
const percentColor = (p) => (p >= 85 ? RED : p >= 60 ? YELLOW : GREEN);

// --- text measurement ------------------------------------------------------

const ELLIPSIS = "…";
/** Below this a clipped string is all ellipsis and no content. */
const MIN_TEXT_COLUMNS = 2;
/** Below this a path is all ellipsis and no path, so the cwd is dropped instead. */
const MIN_PATH_COLUMNS = 3;

/**
 * Ranges whose code points occupy two terminal columns (East Asian Wide and
 * Fullwidth, plus the emoji blocks that render wide). A Korean session name is
 * the common case here: counting its characters as one column each overruns the
 * line and Claude Code truncates the end of it away.
 */
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];

/** Columns a plain (escape-free) string occupies. */
function textWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    width += WIDE_RANGES.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1;
  }
  return width;
}

/** `text` cut to `budget` columns from the end, the cut marked with an ellipsis. */
function clip(text, budget) {
  if (!text || budget < MIN_TEXT_COLUMNS) return "";
  if (textWidth(text) <= budget) return text;
  let kept = "";
  for (const char of text) {
    if (textWidth(kept + char + ELLIPSIS) > budget) break;
    kept += char;
  }
  return kept ? kept + ELLIPSIS : "";
}

/**
 * A path trimmed to `budget` columns from the front, because the tail — the
 * directory actually being worked in — is the informative half:
 * `/Users/me/src/statusman` in 16 columns becomes `…/src/statusman`.
 *
 * Whole segments go first so what remains is still a readable path; only when
 * the last segment alone will not fit does it cut mid-segment.
 */
function fitPathTail(path, budget) {
  if (!path || budget < MIN_PATH_COLUMNS) return "";
  if (textWidth(path) <= budget) return path;

  const segments = path.split("/").filter(Boolean);
  for (let i = 1; i < segments.length; i++) {
    const tail = `${ELLIPSIS}/${segments.slice(i).join("/")}`;
    if (textWidth(tail) <= budget) return tail;
  }

  const chars = [...(segments[segments.length - 1] || "")];
  let kept = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i] + kept;
    if (textWidth(ELLIPSIS + next) > budget) break;
    kept = next;
  }
  return kept ? ELLIPSIS + kept : "";
}

// --- formatting ------------------------------------------------------------

/**
 * Fixed-width meter. A non-zero percentage always lights at least one cell.
 *
 * `elapsedShare` marks how far the window itself has run, so the two can be
 * compared at a glance: fill left of the tick means the budget is lasting, fill
 * past it means it is burning faster than the clock.
 */
function renderBar(percent, cells, elapsedShare) {
  const clamped = clampPercent(percent);
  const scaled = Math.round((clamped / 100) * cells);
  const filled = clamped === 0 ? 0 : Math.max(1, scaled);
  const tick =
    elapsedShare === undefined
      ? -1
      : Math.min(cells - 1, Math.floor((clampPercent(elapsedShare) / 100) * cells));
  const color = percentColor(clamped);
  let out = "";
  let open = "";
  for (let cell = 0; cell < cells; cell++) {
    // A tick sitting outside the fill gets its own color so it reads as a mark
    // rather than as fill; inside the fill it keeps the fill color, because a
    // cyan tick on the only lit cell makes a busy window look idle.
    const want = cell === tick && cell >= filled ? CYAN : cell < filled ? color : DIM;
    if (want !== open) {
      out += (open ? RESET : "") + want;
      open = want;
    }
    out += cell === tick ? BAR_TICK : cell < filled ? BAR_FILLED : BAR_EMPTY;
  }
  return out + (open ? RESET : "");
}

/** 812 -> "812", 102178 -> "102k", 1_240_000 -> "1.2M". */
function formatTokens(tokens) {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

/** Coarse duration: "3h58m", "4d13h", "12m", "<1m". */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "<1m";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `${hours}h${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d${rem}h` : `${days}d`;
}

/** Epoch seconds (stdin) or an ISO string (usage API) -> epoch ms; NaN when unusable. */
function toEpochMs(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return NaN;
    // Anything below ~2001 in ms is really a seconds-based timestamp.
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value) return Date.parse(value);
  return NaN;
}

/** Time left in the window, e.g. "3h58m"; empty when unknown or already past. */
function formatReset(resetsAt, now) {
  const at = toEpochMs(resetsAt);
  if (Number.isNaN(at) || at <= now) return "";
  return formatDuration(at - now);
}

/**
 * How much of the window has already run, 0-100. Undefined when the window
 * length is unknown (the context gauge) or the reset stamp is unusable — the
 * meter then draws no tick rather than guessing a position.
 */
function elapsedPercent(windowMs, resetsAt, now) {
  if (!windowMs) return undefined;
  const at = toEpochMs(resetsAt);
  if (Number.isNaN(at) || at <= now) return undefined;
  const remaining = Math.min(windowMs, at - now);
  return ((windowMs - remaining) / windowMs) * 100;
}

// --- model -----------------------------------------------------------------

/** A rate-limit window from either payload shape, or undefined when absent. */
function readWindow(w, percentKey) {
  if (!isRecord(w)) return undefined;
  const percent = w[percentKey];
  if (typeof percent !== "number") return undefined;
  const resetsAt = w.resets_at;
  return {
    percent,
    resetsAt: typeof resetsAt === "string" || typeof resetsAt === "number" ? resetsAt : null,
  };
}

/**
 * Rate-limit precedence: the live `rate_limits` block Claude Code puts on stdin
 * (windows carry `used_percentage`), then a cached /api/oauth/usage snapshot
 * (windows carry `utilization`). Both are optional; either half can be missing.
 */
function pickLimits(stdin, cache) {
  const live = isRecord(stdin) ? stdin.rate_limits : undefined;
  const cached = isRecord(cache) ? cache.utilization : undefined;
  return {
    fiveHour: readWindow(isRecord(live) ? live.five_hour : undefined, "used_percentage")
      ?? readWindow(isRecord(cached) ? cached.five_hour : undefined, "utilization"),
    sevenDay: readWindow(isRecord(live) ? live.seven_day : undefined, "used_percentage")
      ?? readWindow(isRecord(cached) ? cached.seven_day : undefined, "utilization"),
    spend: readWindow(isRecord(live) ? live.spend_limit : undefined, "used_percentage"),
    cached,
  };
}

/**
 * The fourth gauge: whatever budget is being spent besides the two plan-wide
 * windows. In practice that is the model-scoped weekly cap — a second weekly
 * allowance a single model draws on, which no other gauge shows — and failing
 * that, purchased extra-usage credits. Undefined when the account has neither,
 * so the line simply ends after the weekly window.
 *
 * A scoped cap is worth showing even while `is_active` is false: the flag marks
 * which limit is currently binding, not whether the cap exists.
 */
function buildScoped(limits, now) {
  const list = isRecord(limits.cached) && Array.isArray(limits.cached.limits) ? limits.cached.limits : [];
  const candidates = list.filter((l) => isRecord(l) && l.kind === "weekly_scoped" && typeof l.percent === "number");
  // Still prefer the binding one when several models report a cap.
  const scoped = candidates.find((l) => l.is_active === true) ?? candidates[0];
  if (scoped) {
    const model = isRecord(scoped.scope) && isRecord(scoped.scope.model) ? scoped.scope.model.display_name : undefined;
    return {
      percent: scoped.percent,
      resetsAt: scoped.resets_at,
      windowMs: SEVEN_DAY_MS,
      // The weekly gauge already prints this reset; the model name identifies
      // the cap instead, which the countdown could not.
      trailer: typeof model === "string" && model ? model : "scoped",
    };
  }

  if (limits.spend) {
    return {
      percent: limits.spend.percent,
      resetsAt: limits.spend.resetsAt,
      trailer: formatReset(limits.spend.resetsAt, now) || "credits",
    };
  }

  const extra = isRecord(limits.cached) ? limits.cached.extra_usage : undefined;
  if (isRecord(extra) && extra.is_enabled === true && typeof extra.utilization === "number") {
    return { percent: extra.utilization, trailer: "credits" };
  }
  return undefined;
}

/** Everything the components draw from, read once per render. */
function buildContext(sources, now) {
  const { stdin, config, cache } = sources;
  const account = isRecord(config) ? config.oauthAccount : undefined;
  const email = isRecord(account) && typeof account.emailAddress === "string" ? account.emailAddress : undefined;

  const modelInfo = isRecord(stdin) && isRecord(stdin.model) ? stdin.model : undefined;
  const model = modelInfo
    ? (typeof modelInfo.display_name === "string" && modelInfo.display_name) || modelInfo.id
    : undefined;

  const effortInfo = isRecord(stdin) ? stdin.effort : undefined;
  const workspace = isRecord(stdin) ? stdin.workspace : undefined;
  const cwd = isRecord(workspace) && typeof workspace.current_dir === "string" ? workspace.current_dir : undefined;

  const cw = isRecord(stdin) ? stdin.context_window : undefined;
  let context;
  if (isRecord(cw) && typeof cw.used_percentage === "number") {
    const size = typeof cw.context_window_size === "number" ? cw.context_window_size : 0;
    const used = typeof cw.total_input_tokens === "number"
      ? cw.total_input_tokens
      : (size ? Math.round((cw.used_percentage / 100) * size) : undefined);
    // Tokens used, without the window size: the percentage already says how
    // much of the window that is, so the denominator only costs columns. With
    // neither field on stdin there is no count to print — a trailing "0" beside
    // a non-zero percentage reads as a bug, so the gauge goes without.
    context = { percent: cw.used_percentage, trailer: used === undefined ? undefined : formatTokens(used) };
  }

  const limits = pickLimits(stdin, cache);
  return {
    org: isRecord(account) && typeof account.organizationName === "string" ? account.organizationName : undefined,
    account: email ? email.split("@")[0] : undefined,
    model: typeof model === "string" && model ? model : undefined,
    effort: isRecord(effortInfo) && effortInfo.level != null ? String(effortInfo.level) : undefined,
    // `session_name` only exists once the session has been named; the working
    // directory is the next-best label for telling two windows apart.
    session:
      (isRecord(stdin) && typeof stdin.session_name === "string" && stdin.session_name) ||
      (cwd ? basename(cwd) : undefined),
    cwd,
    context,
    fiveHour: limits.fiveHour && {
      percent: limits.fiveHour.percent,
      resetsAt: limits.fiveHour.resetsAt,
      windowMs: FIVE_HOUR_MS,
      trailer: formatReset(limits.fiveHour.resetsAt, now),
    },
    sevenDay: limits.sevenDay && {
      percent: limits.sevenDay.percent,
      resetsAt: limits.sevenDay.resetsAt,
      windowMs: SEVEN_DAY_MS,
      trailer: formatReset(limits.sevenDay.resetsAt, now),
    },
    scoped: buildScoped(limits, now),
  };
}

// --- components ------------------------------------------------------------

const SEP = " | ";
const DIM_SEP = `${DIM}${SEP}${RESET}`;

/**
 * The statusline's parts, in the order they are drawn. `id` is what
 * `/statusman on|off` takes and what `~/.claude/statusman/settings.json` stores.
 *
 * `kind` decides how a component reacts to a tight budget: "text" clips its
 * tail, "path" rewrites itself from the front, and "gauge" sheds its child
 * views — the bar, then the trailer — under the row layout in layoutGauges.
 */
const COMPONENTS = [
  { id: "org", line: { 2: 1, 4: 1 }, kind: "text", color: CYAN, pick: (c) => c.org },
  { id: "account", line: { 2: 1, 4: 1 }, kind: "text", color: CYAN, pick: (c) => c.account },
  { id: "model", line: { 2: 1, 4: 1 }, kind: "text", color: YELLOW, pick: (c) => c.model },
  // Model and effort describe one thing — what is answering — so they share a color.
  { id: "effort", line: { 2: 1, 4: 1 }, kind: "text", color: YELLOW, pick: (c) => c.effort },
  { id: "session", line: { 2: 1, 4: 2 }, kind: "text", color: MAGENTA, pick: (c) => c.session },
  { id: "cwd", line: { 2: 1, 4: 2 }, kind: "path", color: BLUE, pick: (c) => c.cwd },
  { id: "ctx", line: { 2: 2, 4: 3 }, kind: "gauge", pick: (c) => c.context },
  { id: "5h", line: { 2: 2, 4: 3 }, kind: "gauge", pick: (c) => c.fiveHour },
  { id: "week", line: { 2: 2, 4: 4 }, kind: "gauge", pick: (c) => c.sevenDay },
  { id: "scoped", line: { 2: 2, 4: 4 }, kind: "gauge", pick: (c) => c.scoped },
];

const COMPONENT_IDS = COMPONENTS.map((c) => c.id);

/**
 * Which child views a gauge row draws, richest first. Every gauge in the row
 * uses the same one so the columns keep lining up: the bar goes first, once the
 * width it could be given falls under MIN_BAR_CELLS, and the trailer next.
 */
const GAUGE_VIEWS = [
  { bar: true, trailer: true },
  { bar: false, trailer: true },
  { bar: false, trailer: false },
];

/** Percentage as it is printed. Padded only under a bar, where it is a column. */
function percentText(gauge, views) {
  const text = `${Math.round(clampPercent(gauge.percent))}%`;
  return views.bar ? text.padStart(4) : text;
}

/** Columns a gauge needs for everything except its bar. */
function gaugeTextWidth(gauge, views) {
  const trailer = views.trailer && gauge.trailer ? textWidth(gauge.trailer) + 1 : 0;
  return textWidth(percentText(gauge, views)) + trailer;
}

const rowWidth = (gauges, views, cells) =>
  gauges.reduce(
    (sum, g) => sum + gaugeTextWidth(g, views) + (views.bar ? cells : 0),
    SEP.length * (gauges.length - 1),
  );

/**
 * Lay every gauge row out together: one bar width and one set of child views
 * across all of them, so a four-line statusline reads as one block rather than
 * rows whose bars stop at slightly different places. Each row keeps its own
 * budget, since the text beside it differs.
 *
 * Gauges are dropped from the right only when even the leanest row overflows —
 * a percentage with nothing beside it is still worth its columns.
 */
function layoutGaugeRows(rows) {
  const leanest = GAUGE_VIEWS[GAUGE_VIEWS.length - 1];
  const kept = rows.map((row) => {
    const gauges = row.gauges.slice();
    while (gauges.length > 1 && rowWidth(gauges, leanest, 0) > row.columns) gauges.pop();
    return { columns: row.columns, gauges };
  });

  for (const views of GAUGE_VIEWS) {
    if (!views.bar) {
      if (kept.every((row) => rowWidth(row.gauges, views, 0) <= row.columns)) return { rows: kept, views, cells: 0 };
      continue;
    }
    // One width for all of them, so the bars line up as a block; any remainder
    // is left as slack at the end of each line rather than widening one bar.
    const cells = Math.min(...kept.map((row) =>
      Math.floor((row.columns - rowWidth(row.gauges, views, 0)) / row.gauges.length)));
    if (cells >= MIN_BAR_CELLS) return { rows: kept, views, cells };
  }
  return { rows: kept, views: leanest, cells: 0 };
}

function renderGauge(gauge, views, cells, now) {
  const clamped = clampPercent(gauge.percent);
  const bar = views.bar ? renderBar(gauge.percent, cells, elapsedPercent(gauge.windowMs, gauge.resetsAt, now)) : "";
  const percent = `${percentColor(clamped)}${percentText(gauge, views)}${RESET}`;
  const trailer = views.trailer && gauge.trailer ? ` ${DIM}${gauge.trailer}${RESET}` : "";
  return `${bar}${percent}${trailer}`;
}

/**
 * Text components, each given the columns the ones before it left over. The
 * width comes back with the string because the caller cannot measure it: the
 * colors are already in it.
 */
function renderTextLine(components, context, columns) {
  const parts = [];
  let used = 0;
  for (const component of components) {
    const value = component.pick(context);
    if (!value) continue;
    const gap = parts.length ? SEP.length : 0;
    const budget = columns - used - gap;
    const text = component.kind === "path" ? fitPathTail(value, budget) : clip(value, budget);
    if (!text) continue;
    used += gap + textWidth(text);
    parts.push(`${component.color}${text}${RESET}`);
  }
  return { colored: parts.join(DIM_SEP), width: used };
}

/**
 * Build the statusline. Each line collects its components, the text on it takes
 * the columns it needs, and every gauge row is then laid out against the rest
 * together. Empty lines are dropped, so an empty array means print nothing at
 * all; an unknown line count falls back to the default.
 */
function render(sources, now, columns, disabled = new Set(), lines = DEFAULT_LINES) {
  const layout = LINE_COUNTS.includes(lines) ? lines : DEFAULT_LINES;
  const context = buildContext(sources, now);

  const rows = [];
  for (let index = 1; index <= layout; index++) {
    const components = COMPONENTS.filter((c) => !disabled.has(c.id) && c.line[layout] === index);
    // Text goes first and takes what it needs; the gauges stretch into the
    // rest. Neither layout puts both kinds on one line, but a row that did
    // would still come out right rather than lose half of itself.
    const text = renderTextLine(components.filter((c) => c.kind !== "gauge"), context, columns);
    const gauges = components.filter((c) => c.kind === "gauge").map((c) => c.pick(context)).filter(Boolean);
    rows.push({ text, gauges, columns: columns - (text.width ? text.width + SEP.length : 0) });
  }

  const gaugeRows = rows.filter((row) => row.gauges.length > 0);
  const gaugeLayout = gaugeRows.length ? layoutGaugeRows(gaugeRows) : undefined;
  let next = 0;
  return rows
    .map((row) => {
      const parts = row.text.colored ? [row.text.colored] : [];
      if (row.gauges.length > 0) {
        const { views, cells } = gaugeLayout;
        const gauges = gaugeLayout.rows[next++].gauges;
        parts.push(gauges.map((gauge) => renderGauge(gauge, views, cells, now)).join(DIM_SEP));
      }
      return parts.join(DIM_SEP);
    })
    .filter(Boolean);
}

// --- IO --------------------------------------------------------------------

const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
};

const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/**
 * statusman's own corner of the Claude Code config directory. Everything it
 * writes goes in here; the files it only reads — the account block, the OAuth
 * credentials, Claude Code's own settings — stay where Claude Code keeps them.
 */
const statusmanDir = () => join(claudeConfigDir(), "statusman");

/** Make sure `path` has a directory to be written into. */
const ensureDirFor = (path) => mkdirSync(dirname(path), { recursive: true });

/** Where the on/off state lives. `/statusman` is the front end for this file. */
const settingsPath = () => process.env.STATUSMAN_CONFIG || join(statusmanDir(), "settings.json");

/** Ids switched off. Unknown ids are kept as-is, so a typo stays visible in --list. */
function readDisabled() {
  const settings = readJsonFile(settingsPath());
  const disabled = isRecord(settings) && Array.isArray(settings.disabled) ? settings.disabled : [];
  return new Set(disabled.filter((id) => typeof id === "string"));
}

/**
 * Store the off ids in the order the components are drawn. Ids nobody
 * recognises keep their place at the end rather than being dropped, so a typo
 * survives an unrelated --on/--off and stays visible in --list.
 */
function writeDisabled(disabled) {
  const unknown = [...disabled].filter((id) => !COMPONENT_IDS.includes(id));
  return writeSettings((settings) => {
    settings.disabled = [...COMPONENT_IDS.filter((id) => disabled.has(id)), ...unknown];
  });
}

/** How many lines to lay out. Anything unrecognised reads as the default. */
function readLines() {
  const settings = readJsonFile(settingsPath());
  const lines = isRecord(settings) ? settings.lines : undefined;
  return LINE_COUNTS.includes(lines) ? lines : DEFAULT_LINES;
}

function writeSettings(mutate) {
  const path = settingsPath();
  const settings = readJsonFile(path) ?? {};
  mutate(settings);
  try {
    ensureDirFor(path);
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (error) {
    // Marked so the CLI reports it as what it is — an unwritable config dir —
    // rather than following it with the usage text like a mistyped flag.
    const failure = new Error(`cannot write ${path}: ${error.message}`);
    failure.isWriteFailure = true;
    throw failure;
  }
  return path;
}

/**
 * Usable columns. stdout is a pipe here, so `process.stdout.columns` is unset;
 * Claude Code passes the terminal's width through the environment instead.
 */
function terminalColumns(env = process.env) {
  const raw = Number.parseInt(env.STATUSMAN_COLUMNS || env.COLUMNS || "", 10);
  const columns = Number.isFinite(raw) && raw > 0 ? raw : (process.stdout.columns || FALLBACK_COLUMNS);
  return Math.max(MIN_BAR_CELLS, columns - RESERVED_COLUMNS);
}

/**
 * Where a cached /api/oauth/usage snapshot may live. The first is where
 * refresh.js writes; a snapshot some other tool left is read just as happily.
 * With none of them present stdin alone drives the gauges.
 */
function usageCachePaths() {
  return [process.env.STATUSMAN_USAGE_CACHE, join(statusmanDir(), "usage-cache.json")].filter(Boolean);
}

/** Whether the snapshot is old enough to refetch and no fetch is already out. */
function shouldRefresh(cache, lockPath, now) {
  const fetchedAt = isRecord(cache) && typeof cache.fetchedAtMs === "number" ? cache.fetchedAtMs : 0;
  if (now - fetchedAt < REFRESH_TTL_MS) return false;
  const lock = statSync(lockPath, { throwIfNoEntry: false });
  return !lock || now - lock.mtimeMs > REFRESH_LOCK_MS;
}

/**
 * Send refresh.js after a new snapshot, detached and unwatched. The render that
 * starts it still draws from the old one — the request takes seconds — so this
 * costs the statusline nothing but the spawn.
 */
function refreshUsageCache(cache, now = Date.now()) {
  const lockPath = `${usageCachePaths()[0]}.lock`;
  if (!shouldRefresh(cache, lockPath, now)) return false;
  try {
    // Written before the spawn rather than by the child: one writer, and the
    // lock is in place before the next render can look at it.
    ensureDirFor(lockPath);
    writeFileSync(lockPath, "");
    spawn(process.execPath, [join(__dirname, "refresh.js")], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    // An unwritable config dir or a missing refresher: the cache stays as it is.
    return false;
  }
}

function collectSources() {
  let stdinData = "";
  // Claude Code pipes the statusline JSON in; a run from the shell has a TTY
  // on fd 0, where reading it would block until the user pressed Ctrl-D.
  if (!process.stdin.isTTY) {
    try {
      stdinData = readFileSync(0, "utf-8");
    } catch { /* no stdin */ }
  }
  let stdin;
  try {
    stdin = stdinData ? JSON.parse(stdinData) : undefined;
  } catch { /* not JSON */ }

  let cache;
  for (const path of usageCachePaths()) {
    cache = readJsonFile(path);
    if (cache) break;
  }

  return { stdin, config: readJsonFile(join(homedir(), ".claude.json")), cache };
}

// --- command line ----------------------------------------------------------

const USAGE = `statusman — components: ${COMPONENT_IDS.join(", ")}

  --list              show the layout, every component and whether it is on
  --lines <2|4>       lay the statusline out in two lines (default) or four
  --on <id>...        switch components on
  --off <id>...       switch components off
  --toggle <id>...    flip components

With no flag the statusline is rendered from the JSON on stdin.`;

function listComponents(disabled, lines, context, hasStdin) {
  const rows = COMPONENTS.map((component) => {
    const value = component.pick(context);
    const state = disabled.has(component.id) ? "off" : "on";
    const detail = !value
      ? "(no data)"
      : component.kind === "gauge"
        ? `${Math.round(clampPercent(value.percent))}%${value.trailer ? ` ${value.trailer}` : ""}`
        : value;
    return `  ${component.id.padEnd(8)} ${state.padEnd(4)} line ${component.line[lines]}  ${detail}`;
  });
  const unknown = [...disabled].filter((id) => !COMPONENT_IDS.includes(id));
  return [
    `${lines}-line layout, components (${settingsPath()})`,
    ...rows,
    ...(unknown.length ? [`  unknown ids in settings: ${unknown.join(", ")}`] : []),
    // Most components read the JSON Claude Code puts on stdin, which a run
    // from the shell has none of — say so rather than let it read as "broken".
    ...(hasStdin ? [] : ["", "no statusline JSON on stdin, so stdin-fed components read (no data)"]),
  ].join("\n");
}

/** Apply --lines. Returns a report, or throws on a bad line count. */
function setLines(ids) {
  const lines = Number.parseInt(ids[0], 10);
  if (!LINE_COUNTS.includes(lines)) throw new Error(`--lines takes one of ${LINE_COUNTS.join(", ")}`);
  const path = writeSettings((settings) => { settings.lines = lines; });
  return `${lines}-line layout\nsaved to ${path}`;
}

/** Apply one of --on/--off/--toggle. Returns a report, or throws on a bad id. */
function applyFlag(flag, ids, disabled) {
  if (ids.length === 0) throw new Error(`${flag} needs at least one component id`);
  const unknown = ids.filter((id) => !COMPONENT_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown component: ${unknown.join(", ")}`);
  for (const id of ids) {
    if (flag === "--on") disabled.delete(id);
    else if (flag === "--off") disabled.add(id);
    else if (disabled.has(id)) disabled.delete(id);
    else disabled.add(id);
  }
  const path = writeDisabled(disabled);
  const state = ids.map((id) => `${id} ${disabled.has(id) ? "off" : "on"}`).join(", ");
  return `${state}\nsaved to ${path}`;
}

function main(argv) {
  const flag = argv.find((arg) => arg.startsWith("--"));
  const ids = argv.filter((arg) => !arg.startsWith("--"));

  if (flag === "--help") return console.log(USAGE);
  if (flag === "--list") {
    const sources = collectSources();
    return console.log(
      listComponents(readDisabled(), readLines(), buildContext(sources, Date.now()), Boolean(sources.stdin)),
    );
  }
  if (flag === "--lines" || flag === "--on" || flag === "--off" || flag === "--toggle") {
    try {
      return console.log(flag === "--lines" ? setLines(ids) : applyFlag(flag, ids, readDisabled()));
    } catch (error) {
      // A bad argument is worth the usage text; an unwritable settings file is
      // not, and printing it there reads as though the flag were mistyped.
      console.error(error.isWriteFailure ? error.message : `${error.message}\n\n${USAGE}`);
      process.exitCode = 1;
      return undefined;
    }
  }
  if (flag) {
    console.error(`unknown flag: ${flag}\n\n${USAGE}`);
    process.exitCode = 1;
    return undefined;
  }
  const sources = collectSources();
  const disabled = readDisabled();
  // The snapshot exists for the scoped gauge; with that switched off there is
  // nothing in it the statusline still needs, so nothing to go and fetch.
  if (!disabled.has("scoped")) refreshUsageCache(sources.cache);
  for (const line of render(sources, Date.now(), terminalColumns(), disabled, readLines())) {
    console.log(line);
  }
  return undefined;
}

// --- exports --------------------------------------------------------------

// The pure half of the module is exported for the tests in test/. Requiring
// the file never renders anything: the CLI runs only as the entry point.
module.exports = {
  COMPONENTS,
  COMPONENT_IDS,
  DEFAULT_LINES,
  GAUGE_VIEWS,
  LINE_COUNTS,
  MIN_BAR_CELLS,
  SEP,
  applyFlag,
  buildContext,
  claudeConfigDir,
  clip,
  ensureDirFor,
  fitPathTail,
  formatDuration,
  formatTokens,
  layoutGaugeRows,
  listComponents,
  readDisabled,
  readJsonFile,
  readLines,
  refreshUsageCache,
  render,
  renderBar,
  setLines,
  settingsPath,
  shouldRefresh,
  statusmanDir,
  terminalColumns,
  textWidth,
  toEpochMs,
  usageCachePaths,
  writeDisabled,
  writeSettings,
};

if (require.main === module) main(process.argv.slice(2));
