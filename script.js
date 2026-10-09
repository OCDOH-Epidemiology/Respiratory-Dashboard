/**
 * Orange County Respiratory Illness Dashboard
 * Loads activity + weekly series from data/weekly.json
 */

// =============================================================================
// DASHBOARD CONTROLS — edit these to update the header date, gauge, and trend
//   LAST_UPDATED: display date shown as "Dashboard last updated: …"
//   level:  1 = Low,  2 = Moderate,  3 = High
//   trend:  1 = Decreasing,  2 = Staying the Same,  3 = Increasing
// These override values from data/weekly.json.
// =============================================================================
const LAST_UPDATED = "October 9, 2026";

const ACTIVITY = {
  level: 2,
  trend: 3,
};

const LEVEL_LABELS = {
  1: "Low",
  2: "Moderate",
  3: "High",
};

const LEVEL_CLASS = {
  1: "is-low",
  2: "is-moderate",
  3: "is-high",
};

const TREND_LABELS = {
  1: "Decreasing",
  2: "Staying the Same",
  3: "Increasing",
};

const PATHOGEN_COLORS = {
  covid: "#2F9E6A",
  flu: "#7B5EA7",
  rsv: "#3A8FB7",
};

/**
 * Distinct line patterns + point shapes so ED series are not distinguished
 * by color alone (WCAG 1.4.1).
 */
const PATHOGEN_LINE_STYLES = {
  covid: { borderDash: [], pointStyle: "circle" },
  flu: { borderDash: [8, 4], pointStyle: "triangle" },
  rsv: { borderDash: [2, 3], pointStyle: "rectRot" },
};

const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isDarkScheme = () => colorSchemeQuery.matches;

/**
 * Canvas colors for Chart.js (canvas pixels are not styled by CSS).
 * Contrast vs. panel background: light #ffffff, dark #121c2b.
 */
function chartTheme() {
  if (isDarkScheme()) {
    return {
      text: "#b6c2d2", // 9.49:1
      grid: "rgba(232, 238, 245, 0.14)",
      needle: "#e8eef5", // 14.66:1
      barLabel: "#e8eef5", // 14.66:1
      vaxFill: "#5B8DEF", // 5.30:1
      vaxTrack: "#33445c",
      acute: "#E87722", // 5.78:1
      acuteFill: "rgba(232, 119, 34, 0.18)",
      school: "#e8eef5", // 14.66:1
      schoolFill: "rgba(232, 238, 245, 0.12)",
    };
  }
  return {
    text: "#666666", // 5.74:1
    grid: "rgba(0, 0, 0, 0.1)",
    needle: "#0f172a",
    barLabel: "#152033",
    vaxFill: "#004C7D", // 9.01:1
    vaxTrack: "#E6E2D8",
    acute: "#C2410C", // 5.18:1
    acuteFill: "rgba(194, 65, 12, 0.12)",
    school: "#0f172a",
    schoolFill: "rgba(15, 23, 42, 0.12)",
  };
}

function applyChartDefaults() {
  if (typeof Chart === "undefined") return;
  const t = chartTheme();
  Chart.defaults.color = t.text;
  Chart.defaults.borderColor = t.grid;
}

let announceTimer = null;
/** Single polite live region for user-initiated updates (WCAG 4.1.3). */
function announce(message) {
  const el = document.getElementById("liveAnnouncer");
  if (!el || !message) return;
  el.textContent = "";
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    el.textContent = message;
  }, 150);
}

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let dashboardData = null;
let activityLevel = ACTIVITY.level;
let activityTrend = ACTIVITY.trend;
let rangeMode = "season"; // "season" | "all"
let gaugeChart = null;
/** Animated needle angle in degrees; -90 is leftmost of the semicircle. */
let needleAngle = -90;
let needleAnimFrame = null;
/**
 * The needle sweep runs once per page load, and only after BOTH the data has
 * loaded and the dial is on screen, so it is never missed (e.g. after a reload
 * while scrolled down). Reduced motion places the needle with no sweep.
 */
let gaugeSweepLevel = null; // target level once data has loaded
let gaugeInView = false;
let gaugeSweepDone = false;
let gaugeViewObserver = null;
let edChart = null;
let acuteEdChart = null;
let schoolChart = null;
let vaxDonutChart = null;
let vaxBarChart = null;
let vaxPathogen = "covid"; // "covid" | "flu"
let vaxDimension = "overall"; // "overall" | "age" | "gender"
let vaxTransitionToken = 0;
let vaxHasRendered = false;
/** Bar chart build deferred until the stage is visible (Overall → Age/Gender). */
let vaxBarPendingBuild = null;

/** Per-chart week index ranges into the current season/all domain. */
const chartBrushes = {
  ed: { start: 0, end: 0 },
  acuteEd: { start: 0, end: 0 },
  school: { start: 0, end: 0 },
};
const BRUSH_KEYS = Object.keys(chartBrushes);

const VAX_FADE_MS = 220;
const VAX_PATHOGEN_LABELS = {
  covid: "COVID-19",
  flu: "Influenza",
};

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDisplayDate(isoOrDate) {
  const d = typeof isoOrDate === "string" ? parseISODate(isoOrDate) : isoOrDate;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function seasonStartFor(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth(); // 0-based
  if (m >= 9) return new Date(y, 9, 3); // Oct 3 of this year
  return new Date(y - 1, 9, 3);
}

function getSeasonBounds(meta) {
  const start = meta?.seasonStart
    ? parseISODate(meta.seasonStart)
    : seasonStartFor(new Date());
  const end = meta?.seasonEnd
    ? parseISODate(meta.seasonEnd)
    : new Date(start.getFullYear() + 1, 4, 7); // May 7 next year
  return { start, end };
}

function startOfLocalDay(dateObj) {
  return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
}

/** True while today is within the configured season window (inclusive). */
function isSeasonActive(meta, asOf = new Date()) {
  const { start, end } = getSeasonBounds(meta);
  const today = startOfLocalDay(asOf);
  return today >= start && today <= end;
}

/**
 * After seasonEnd, completed-season weeks remain in the file and are shown under
 * “All available data”. Default the Trends toggle to that view.
 */
function applySeasonAvailability(meta) {
  const toggle = document.querySelector(
    '.charts-section .season-toggle[aria-label="Select time range"]'
  );
  const buttons = toggle
    ? toggle.querySelectorAll(".season-btn[data-range]")
    : document.querySelectorAll(".season-btn[data-range]");
  const seasonBtn = [...buttons].find((b) => b.getAttribute("data-range") === "season");
  const active = isSeasonActive(meta);

  if (seasonBtn) {
    seasonBtn.disabled = !active;
    seasonBtn.title = active
      ? ""
      : "Season ended; that range is included in All available data.";
  }

  if (!active) {
    rangeMode = "all";
    buttons.forEach((b) => {
      const isAll = b.getAttribute("data-range") === "all";
      b.classList.toggle("active", isAll);
      b.setAttribute("aria-pressed", isAll ? "true" : "false");
    });
  }
}

function filterWeeks(weeks, meta, mode) {
  if (!Array.isArray(weeks)) return [];
  // Past seasonEnd, always show the full archive (includes the completed season).
  if (mode !== "season" || !isSeasonActive(meta)) return weeks.slice();
  const { start, end } = getSeasonBounds(meta);
  return weeks.filter((w) => {
    const d = parseISODate(w.weekEnding);
    return d >= start && d <= end;
  });
}

function getDomainWeeks() {
  if (!dashboardData) return [];
  return filterWeeks(dashboardData.weeks, dashboardData.meta, rangeMode);
}

function clampBrushRange(brush, maxIndex) {
  if (maxIndex < 0) {
    brush.start = 0;
    brush.end = 0;
    return;
  }
  brush.start = Math.max(0, Math.min(brush.start, maxIndex));
  brush.end = Math.max(0, Math.min(brush.end, maxIndex));
  if (brush.start > brush.end) {
    const tmp = brush.start;
    brush.start = brush.end;
    brush.end = tmp;
  }
}

function resetBrushRanges(domainLength) {
  const end = Math.max(0, domainLength - 1);
  BRUSH_KEYS.forEach((key) => {
    chartBrushes[key].start = 0;
    chartBrushes[key].end = end;
  });
}

function clampAllBrushes(domainLength) {
  const maxIndex = Math.max(0, domainLength - 1);
  BRUSH_KEYS.forEach((key) => clampBrushRange(chartBrushes[key], maxIndex));
}

function sliceByBrush(weeks, brushKey) {
  if (!weeks.length) return [];
  const brush = chartBrushes[brushKey];
  clampBrushRange(brush, weeks.length - 1);
  return weeks.slice(brush.start, brush.end + 1);
}

function xTickLimit(weekCount) {
  if (weekCount <= 12) return weekCount;
  if (weekCount <= 40) return 12;
  return 16;
}

function setBrushVisibility(brushKey, visible) {
  const el = document.querySelector(`[data-brush="${brushKey}"]`);
  if (!el) return;
  el.classList.toggle("d-none", !visible);
}

function syncBrushUI(brushKey, domainWeeks) {
  const root = document.querySelector(`[data-brush="${brushKey}"]`);
  if (!root) return;

  const n = domainWeeks.length;
  if (n < 1) {
    root.classList.add("d-none");
    return;
  }

  const brush = chartBrushes[brushKey];
  clampBrushRange(brush, n - 1);
  const denom = Math.max(n - 1, 1);
  const startPct = (brush.start / denom) * 100;
  const endPct = (brush.end / denom) * 100;

  const selection = root.querySelector("[data-brush-selection]");
  const startHandle = root.querySelector('[data-brush-handle="start"]');
  const endHandle = root.querySelector('[data-brush-handle="end"]');
  const label = root.querySelector("[data-brush-label]");

  if (selection) {
    selection.style.left = `${startPct}%`;
    selection.style.width = `${Math.max(endPct - startPct, 0)}%`;
  }
  if (startHandle) {
    startHandle.style.left = `${startPct}%`;
    startHandle.setAttribute("aria-valuemin", "0");
    startHandle.setAttribute("aria-valuemax", String(n - 1));
    startHandle.setAttribute("aria-valuenow", String(brush.start));
    startHandle.setAttribute(
      "aria-valuetext",
      formatDisplayDate(domainWeeks[brush.start].weekEnding)
    );
  }
  if (endHandle) {
    endHandle.style.left = `${endPct}%`;
    endHandle.setAttribute("aria-valuemin", "0");
    endHandle.setAttribute("aria-valuemax", String(n - 1));
    endHandle.setAttribute("aria-valuenow", String(brush.end));
    endHandle.setAttribute(
      "aria-valuetext",
      formatDisplayDate(domainWeeks[brush.end].weekEnding)
    );
  }
  if (label) {
    const startLabel = formatDisplayDate(domainWeeks[brush.start].weekEnding);
    const endLabel = formatDisplayDate(domainWeeks[brush.end].weekEnding);
    label.textContent =
      brush.start === brush.end
        ? `Week ending ${startLabel}`
        : `${startLabel} – ${endLabel}`;
  }
}

function syncAllBrushUI(domainWeeks) {
  BRUSH_KEYS.forEach((key) => syncBrushUI(key, domainWeeks));
}

function seriesHasValues(weeks, key) {
  return weeks.some((w) => w[key] !== null && w[key] !== undefined);
}

function setEmptyState(canvasId, emptyId, isEmpty) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  if (!canvas || !empty) return;
  canvas.classList.toggle("d-none", isEmpty);
  empty.classList.toggle("d-none", !isEmpty);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateHeader(meta) {
  const display =
    LAST_UPDATED ||
    meta.lastUpdatedDisplay ||
    (meta.lastUpdated ? formatDisplayDate(meta.lastUpdated) : "—");
  const headerUpdated = document.getElementById("header-updated");
  const updateDate = document.getElementById("update-date");
  const statusMessage = document.getElementById("statusMessage");
  const statusAlert = document.getElementById("statusAlert");
  if (headerUpdated) headerUpdated.textContent = display;
  if (updateDate) updateDate.textContent = display;
  if (statusMessage) {
    statusMessage.textContent = meta.statusMessage
      ? ` ${meta.statusMessage}`
      : "";
  }
  if (statusAlert) {
    statusAlert.setAttribute("role", "status");
    statusAlert.setAttribute("aria-live", "polite");
  }
}

function showLoadError(message) {
  const statusMessage = document.getElementById("statusMessage");
  const statusAlert = document.getElementById("statusAlert");
  if (statusMessage) statusMessage.textContent = ` ${message}`;
  if (statusAlert) {
    statusAlert.setAttribute("role", "alert");
    statusAlert.setAttribute("aria-live", "assertive");
  }
}

function updateActivityUI(activity) {
  activityLevel = ACTIVITY.level ?? activity?.level ?? 1;
  activityTrend = ACTIVITY.trend ?? activity?.trend ?? 2;

  const textElement = document.getElementById("activityText");
  if (textElement) {
    textElement.classList.remove("is-low", "is-moderate", "is-high");
    textElement.classList.add(LEVEL_CLASS[activityLevel] || "is-low");
    textElement.textContent = LEVEL_LABELS[activityLevel] || "Low";
  }

  const trendEl = document.getElementById("trendButton");
  if (trendEl) {
    switch (activityTrend) {
      case 1:
        trendEl.innerHTML =
          '<span class="trend-arrow" style="color:#007a3d" aria-hidden="true">▼</span> Decreasing';
        break;
      case 3:
        trendEl.innerHTML =
          '<span class="trend-arrow" style="color:#b42318" aria-hidden="true">▲</span> Increasing';
        break;
      default:
        trendEl.innerHTML =
          '<span class="trend-same" aria-hidden="true"></span> Staying the Same';
        break;
    }
  }

  requestGaugeSweep(activityLevel);
}

function updateRangeCaption(meta, mode, weeks) {
  const el = document.getElementById("rangeCaption");
  if (!el) return;
  if (mode === "season") {
    const label = meta.seasonLabel ? ` (${meta.seasonLabel})` : "";
    const start = meta.seasonStart
      ? formatDisplayDate(meta.seasonStart)
      : weeks[0]
        ? formatDisplayDate(weeks[0].weekEnding)
        : null;
    const end = meta.seasonEnd
      ? formatDisplayDate(meta.seasonEnd)
      : weeks.length
        ? formatDisplayDate(weeks[weeks.length - 1].weekEnding)
        : null;
    if (!start || !end) {
      el.textContent = "No weekly data available for this range yet.";
      return;
    }
    el.textContent = `Showing current respiratory season${label}: ${start} – ${end}.`;
    return;
  }
  if (!weeks.length) {
    el.textContent = "No weekly data available for this range yet.";
    return;
  }
  const first = formatDisplayDate(weeks[0].weekEnding);
  const last = formatDisplayDate(weeks[weeks.length - 1].weekEnding);
  el.textContent = `Showing all available weeks: ${first} – ${last}.`;
}

function peakOf(weeks, key) {
  let best = null;
  for (const w of weeks) {
    const v = w[key];
    if (v == null || Number.isNaN(Number(v))) continue;
    if (!best || Number(v) > best.value) best = { value: Number(v), weekEnding: w.weekEnding };
  }
  return best;
}

function rangeText(weeks) {
  if (!weeks.length) return "";
  const first = formatDisplayDate(weeks[0].weekEnding);
  const last = formatDisplayDate(weeks[weeks.length - 1].weekEnding);
  return first === last ? `week ending ${first}` : `weeks ending ${first} to ${last}`;
}

function weekCountText(n) {
  return `${n} ${n === 1 ? "week" : "weeks"}`;
}

function renderEdSummary(weeks) {
  if (!weeks.length) {
    setText("edChartSummary", "No emergency department visit data available.");
    return;
  }

  const latest = weeks[weeks.length - 1];
  const peaks = [
    ["COVID-19", peakOf(weeks, "edCovid")],
    ["flu", peakOf(weeks, "edFlu")],
    ["RSV", peakOf(weeks, "edRsv")],
  ]
    .filter(([, p]) => p)
    .map(([name, p]) => `${name} ${formatPercent(p.value)}% (week ending ${formatDisplayDate(p.weekEnding)})`);
  setText(
    "edChartSummary",
    `Emergency department visit chart, ${weekCountText(weeks.length)}, ${rangeText(weeks)}. ` +
      `Latest week ending ${formatDisplayDate(latest.weekEnding)}: COVID-19 ${formatPercent(latest.edCovid)}%, flu ${formatPercent(latest.edFlu)}%, RSV ${formatPercent(latest.edRsv)}%.` +
      (peaks.length ? ` Highest in this range: ${peaks.join("; ")}.` : "") +
      " All weekly values are in the data table below the chart."
  );
}

function renderSchoolSummary(weeks) {
  if (!weeks.length) {
    setText("schoolChartSummary", "No school absenteeism data available.");
    return;
  }

  const withValues = weeks.filter(
    (w) => w.schoolAbsenteeism !== null && w.schoolAbsenteeism !== undefined
  );
  if (!withValues.length) {
    setText(
      "schoolChartSummary",
      `School absenteeism chart covers ${weekCountText(weeks.length)}; values are not yet available.`
    );
    return;
  }
  const latest = withValues[withValues.length - 1];
  const peak = peakOf(withValues, "schoolAbsenteeism");
  setText(
    "schoolChartSummary",
    `School absenteeism chart with ${weekCountText(withValues.length)} of values, ${rangeText(weeks)}. ` +
      `Latest week ending ${formatDisplayDate(latest.weekEnding)}: ${formatPercent(latest.schoolAbsenteeism)}% absent. ` +
      `Highest in this range: ${formatPercent(peak.value)}% (week ending ${formatDisplayDate(peak.weekEnding)}). ` +
      "All weekly values are in the data table below the chart."
  );
}

function renderAcuteEdSummary(weeks) {
  if (!weeks.length) {
    setText("acuteEdChartSummary", "No acute respiratory ED visit data available.");
    return;
  }

  const withValues = weeks.filter(
    (w) => w.edAcuteRespiratory !== null && w.edAcuteRespiratory !== undefined
  );
  if (!withValues.length) {
    setText(
      "acuteEdChartSummary",
      `Acute respiratory ED visit chart covers ${weekCountText(weeks.length)}; values are not yet available.`
    );
    return;
  }
  const latest = withValues[withValues.length - 1];
  const peak = peakOf(withValues, "edAcuteRespiratory");
  setText(
    "acuteEdChartSummary",
    `Acute respiratory ED visit chart with ${weekCountText(withValues.length)} of values, ${rangeText(weeks)}. ` +
      `Latest week ending ${formatDisplayDate(latest.weekEnding)}: ${Number(latest.edAcuteRespiratory).toLocaleString()} visits. ` +
      `Highest in this range: ${Math.round(peak.value).toLocaleString()} visits (week ending ${formatDisplayDate(peak.weekEnding)}). ` +
      "All weekly values are in the data table below the chart."
  );
}

// -----------------------------------------------------------------------------
// Accessible data tables (WCAG 1.1.1 / 1.3.1): full values for the selected weeks
// -----------------------------------------------------------------------------
const NO_DATA_CELL =
  '<span aria-hidden="true">—</span><span class="visually-hidden">No data</span>';

const fmtTablePercent = (v) => `${Number(v).toFixed(2)}%`;
const fmtTableCount = (v) => Math.round(Number(v)).toLocaleString();

const TREND_TABLES = {
  ed: {
    label: "Emergency department visit percentage",
    cols: [
      ["edCovid", fmtTablePercent],
      ["edFlu", fmtTablePercent],
      ["edRsv", fmtTablePercent],
    ],
  },
  acuteEd: {
    label: "Acute respiratory emergency department visits",
    cols: [["edAcuteRespiratory", fmtTableCount]],
  },
  school: {
    label: "School absenteeism",
    cols: [["schoolAbsenteeism", fmtTablePercent]],
  },
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setTableVisible(key, visible) {
  const wrap = document.getElementById(`${key}TableWrap`);
  if (wrap) wrap.classList.toggle("d-none", !visible);
}

function renderTrendTable(key, weeks, visible = true) {
  const config = TREND_TABLES[key];
  const body = document.getElementById(`${key}TableBody`);
  const caption = document.getElementById(`${key}TableCaption`);
  if (!config || !body || !caption) return;

  setTableVisible(key, visible && weeks.length > 0);
  if (!visible || !weeks.length) {
    body.innerHTML = "";
    return;
  }

  caption.textContent = `${config.label}, ${rangeText(weeks)} (${weekCountText(weeks.length)}, newest first)`;
  const rows = [];
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const w = weeks[i];
    const cells = config.cols
      .map(([field, fmt]) => {
        const v = w[field];
        const has = v != null && !Number.isNaN(Number(v));
        return `<td>${has ? escapeHtml(fmt(v)) : NO_DATA_CELL}</td>`;
      })
      .join("");
    rows.push(`<tr><th scope="row">${escapeHtml(formatDisplayDate(w.weekEnding))}</th>${cells}</tr>`);
  }
  body.innerHTML = rows.join("");
}

function renderVaxTable(rows, captionText) {
  const body = document.getElementById("vaxTableBody");
  const caption = document.getElementById("vaxTableCaption");
  if (!body || !caption) return;
  if (!rows || !rows.length) {
    setTableVisible("vax", false);
    body.innerHTML = "";
    return;
  }
  setTableVisible("vax", true);
  caption.textContent = captionText;
  body.innerHTML = rows
    .map(([label, value]) => {
      const has = value != null && !Number.isNaN(Number(value));
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${has ? escapeHtml(formatVaxPercent(value)) : NO_DATA_CELL}</td></tr>`;
    })
    .join("");
}

// -----------------------------------------------------------------------------
// Tooltips: Escape dismisses (WCAG 1.4.13); re-enabled when the pointer leaves
// -----------------------------------------------------------------------------
function activeCharts() {
  return [edChart, acuteEdChart, schoolChart, vaxBarChart].filter(Boolean);
}

function clearChartTooltip(chart) {
  if (!chart?.tooltip) return;
  chart.tooltip.setActiveElements([], { x: 0, y: 0 });
  chart.setActiveElements([]);
  chart.tooltip.opacity = 0;
  chart.update("none");
}

function dismissChartTooltips() {
  let dismissed = false;
  activeCharts().forEach((chart) => {
    const tip = chart.tooltip;
    const active = tip?.getActiveElements?.() || [];
    const visible = tip && tip.opacity > 0;
    if (!active.length && !visible) return;
    dismissed = true;
    // Keep tooltips off until the pointer leaves the canvas so Esc stays dismissed
    // without moving the pointer (WCAG 1.4.13). Chart.js can still fire hover
    // events while enabled=false, so also gate via _a11yTooltipPaused + onHover.
    if (!chart._a11yTooltipPaused) {
      chart._a11yTooltipPaused = true;
      chart._a11yPrevOnHover = chart.options.onHover;
      chart.options.onHover = (event, elements, chartInst) => {
        if (chartInst._a11yTooltipPaused) {
          clearChartTooltip(chartInst);
          return;
        }
        if (typeof chartInst._a11yPrevOnHover === "function") {
          return chartInst._a11yPrevOnHover(event, elements, chartInst);
        }
      };
      chart.canvas.addEventListener(
        "pointerleave",
        () => {
          chart._a11yTooltipPaused = false;
          chart.options.onHover = chart._a11yPrevOnHover;
          chart._a11yPrevOnHover = undefined;
          if (chart.options?.plugins?.tooltip) {
            chart.options.plugins.tooltip.enabled = true;
          }
          // Reset stale active elements so the next hover shows the tooltip again.
          clearChartTooltip(chart);
        },
        { once: true }
      );
    }
    if (chart.options?.plugins?.tooltip) {
      chart.options.plugins.tooltip.enabled = false;
    }
    clearChartTooltip(chart);
  });
  return dismissed;
}

function needleAngleForLevel(level) {
  switch (level) {
    case 1:
      return -60;
    case 2:
      return 0;
    case 3:
      return 60;
    default:
      return -60;
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function maybeStartGaugeSweep() {
  if (gaugeSweepDone || gaugeSweepLevel == null || !gaugeInView) return;
  gaugeSweepDone = true;
  if (gaugeViewObserver) {
    gaugeViewObserver.disconnect();
    gaugeViewObserver = null;
  }
  animateGaugeNeedle(gaugeSweepLevel);
}

function requestGaugeSweep(level) {
  gaugeSweepLevel = level;
  // Reduced motion, or the one sweep already happened: place/move directly.
  if (gaugeSweepDone || prefersReducedMotion()) {
    gaugeSweepDone = true;
    if (gaugeViewObserver) {
      gaugeViewObserver.disconnect();
      gaugeViewObserver = null;
    }
    animateGaugeNeedle(level);
    return;
  }
  maybeStartGaugeSweep();
}

function observeGaugeVisibility() {
  const target = document.querySelector(".half-doughnut") || document.getElementById("doughnutChart");
  if (!target || typeof IntersectionObserver === "undefined") {
    gaugeInView = true;
    return;
  }
  gaugeViewObserver = new IntersectionObserver(
    (entries) => {
      gaugeInView = entries.some((entry) => entry.isIntersecting);
      maybeStartGaugeSweep();
    },
    { threshold: 0.5 }
  );
  gaugeViewObserver.observe(target);
}

function animateGaugeNeedle(level) {
  const target = needleAngleForLevel(level);
  if (!gaugeChart) {
    needleAngle = target;
    return;
  }

  if (needleAnimFrame != null) {
    cancelAnimationFrame(needleAnimFrame);
    needleAnimFrame = null;
  }

  if (prefersReducedMotion()) {
    needleAngle = target;
    gaugeChart.update("none");
    return;
  }

  const start = needleAngle;
  const delta = target - start;
  if (Math.abs(delta) < 0.01) {
    needleAngle = target;
    gaugeChart.update("none");
    return;
  }

  const duration = 900;
  const startTime = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    needleAngle = start + delta * easeOutCubic(t);
    gaugeChart.update("none");
    if (t < 1) {
      needleAnimFrame = requestAnimationFrame(tick);
    } else {
      needleAngle = target;
      needleAnimFrame = null;
    }
  };

  needleAnimFrame = requestAnimationFrame(tick);
}

const gaugeNeedle = {
  id: "gaugeNeedle",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data || meta.data.length === 0) return;
    const firstArc = meta.data[0];
    const xCenter = firstArc.x;
    const yCenter = firstArc.y;
    const outerRadius = firstArc.outerRadius - 6;
    ctx.save();
    ctx.translate(xCenter, yCenter);
    ctx.rotate((needleAngle * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(0, -outerRadius);
    ctx.lineTo(5, 0);
    const needleColor = chartTheme().needle;
    ctx.fillStyle = needleColor;
    ctx.fill();
    ctx.strokeStyle = needleColor;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.restore();
  },
};

function chartMotionOptions() {
  if (prefersReducedMotion()) {
    return { duration: 0 };
  }
  return {
    animateScale: true,
    animateRotate: true,
    duration: 900,
    easing: "easeOutCubic",
  };
}

function barMotionOptions() {
  if (prefersReducedMotion()) return false;
  return {
    duration: 750,
    easing: "easeOutCubic",
    delay: (ctx) => (ctx.type === "data" ? ctx.dataIndex * 45 : 0),
  };
}

function initGauge() {
  const canvas = document.getElementById("doughnutChart");
  if (!canvas) return;
  gaugeChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Low", "Moderate", "High"],
      datasets: [
        {
          label: "Risk Level",
          data: [20, 20, 20],
          backgroundColor: ["#00D26A", "#FCD53E", "#F8312F"],
          borderColor: ["#000000", "#000000", "#000000"],
          borderWidth: 2,
          circumference: 180,
          rotation: 270,
          borderRadius: 10,
        },
      ],
    },
    options: {
      aspectRatio: 1.5,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      animation: chartMotionOptions(),
    },
    plugins: [gaugeNeedle],
  });
}

function weekTooltipTitle(weeks) {
  return (items) => {
    const idx = items[0]?.dataIndex;
    if (idx == null || !weeks[idx]) return "";
    return `Week ending ${formatDisplayDate(weeks[idx].weekEnding)}`;
  };
}

function trendBrushMotion(animate) {
  if (prefersReducedMotion() || !animate) return false;
  return {
    duration: 320,
    easing: "easeOutCubic",
  };
}

/** Y-axis tick steps so chart maxes land on clean whole numbers. */
const TREND_Y_STEP = {
  ed: 2,
  acuteEd: 200,
  school: 1,
};

function visibleSeriesMax(weeks, keys, step = 1) {
  let max = 0;
  let found = false;
  for (const w of weeks) {
    for (const key of keys) {
      const v = w[key];
      if (v == null || Number.isNaN(Number(v))) continue;
      found = true;
      if (Number(v) > max) max = Number(v);
    }
  }
  if (!found) return undefined;
  const tick = Math.max(1, Number(step) || 1);
  if (max <= 0) return tick;
  // Headroom above the peak, snapped to the chart's tick step (e.g. 11→12, 1388→1400).
  return Math.max(tick, Math.ceil((max * 1.12) / tick) * tick);
}

function brushWindow(domainWeeks, brushKey) {
  const brush = chartBrushes[brushKey];
  clampBrushRange(brush, domainWeeks.length - 1);
  return {
    brush,
    visible: domainWeeks.slice(brush.start, brush.end + 1),
  };
}

/**
 * One visible week: center the point. Two+: normal edge-to-edge line chart.
 * Also enlarges lone points so a single week is easy to see.
 */
function applySparseXLayout(chart, visibleCount) {
  if (!chart?.options?.scales?.x) return;
  const single = visibleCount <= 1;
  chart.options.scales.x.offset = single;
  for (const ds of chart.data.datasets) {
    if (ds._sparseBaseRadius == null) {
      ds._sparseBaseRadius = ds.pointRadius ?? 2;
      ds._sparseBaseHoverRadius = ds.pointHoverRadius ?? 5;
    }
    ds.pointRadius = single ? Math.max(ds._sparseBaseRadius * 2.2, 5) : ds._sparseBaseRadius;
    ds.pointHoverRadius = single
      ? Math.max(ds._sparseBaseHoverRadius * 1.4, 7)
      : ds._sparseBaseHoverRadius;
  }
}

/** Zoom a trend chart to the brush window without rebuilding series data. */
function applyTrendBrushWindow(chart, brushKey, domainWeeks, yKeys, { animate = true } = {}) {
  if (!chart || !domainWeeks.length) return;
  const { brush, visible } = brushWindow(domainWeeks, brushKey);

  chart.options.scales.x.min = brush.start;
  chart.options.scales.x.max = brush.end;
  chart.options.scales.x.ticks.maxTicksLimit = xTickLimit(visible.length);
  applySparseXLayout(chart, visible.length);

  const yMax = visibleSeriesMax(visible, yKeys, TREND_Y_STEP[brushKey] ?? 1);
  if (yMax == null) delete chart.options.scales.y.max;
  else chart.options.scales.y.max = yMax;

  chart.options.animation = trendBrushMotion(animate);
  chart.stop();
  chart.update();
}

function buildEdChart(domainWeeks, { animate = true } = {}) {
  const canvas = document.getElementById("edChart");
  if (!canvas) return;

  const hasAny =
    seriesHasValues(domainWeeks, "edCovid") ||
    seriesHasValues(domainWeeks, "edFlu") ||
    seriesHasValues(domainWeeks, "edRsv");
  setEmptyState("edChart", "edEmpty", !hasAny);
  setBrushVisibility("ed", hasAny);
  renderEdSummary(sliceByBrush(domainWeeks, "ed"));
  renderTrendTable("ed", sliceByBrush(domainWeeks, "ed"), hasAny);

  if (!hasAny) {
    if (edChart) {
      edChart.destroy();
      edChart = null;
    }
    return;
  }

  const { brush, visible } = brushWindow(domainWeeks, "ed");
  const labels = domainWeeks.map((w) => formatDisplayDate(w.weekEnding));
  const covid = domainWeeks.map((w) => w.edCovid);
  const flu = domainWeeks.map((w) => w.edFlu);
  const rsv = domainWeeks.map((w) => w.edRsv);
  const yMax = visibleSeriesMax(visible, ["edCovid", "edFlu", "edRsv"], TREND_Y_STEP.ed);

  if (edChart) {
    edChart.data.labels = labels;
    edChart.data.datasets[0].data = covid;
    edChart.data.datasets[1].data = flu;
    edChart.data.datasets[2].data = rsv;
    edChart.options.plugins.tooltip.callbacks.title = weekTooltipTitle(domainWeeks);
    applyTrendBrushWindow(edChart, "ed", domainWeeks, ["edCovid", "edFlu", "edRsv"], {
      animate,
    });
    return;
  }

  edChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "COVID-19",
          data: covid,
          borderColor: PATHOGEN_COLORS.covid,
          backgroundColor: PATHOGEN_COLORS.covid,
          borderDash: PATHOGEN_LINE_STYLES.covid.borderDash,
          pointStyle: PATHOGEN_LINE_STYLES.covid.pointStyle,
          tension: 0.25,
          spanGaps: true,
          pointRadius: 2.5,
          pointHoverRadius: 6,
        },
        {
          label: "Flu",
          data: flu,
          borderColor: PATHOGEN_COLORS.flu,
          backgroundColor: PATHOGEN_COLORS.flu,
          borderDash: PATHOGEN_LINE_STYLES.flu.borderDash,
          pointStyle: PATHOGEN_LINE_STYLES.flu.pointStyle,
          tension: 0.25,
          spanGaps: true,
          pointRadius: 2.5,
          pointHoverRadius: 6,
        },
        {
          label: "RSV",
          data: rsv,
          borderColor: PATHOGEN_COLORS.rsv,
          backgroundColor: PATHOGEN_COLORS.rsv,
          borderDash: PATHOGEN_LINE_STYLES.rsv.borderDash,
          pointStyle: PATHOGEN_LINE_STYLES.rsv.pointStyle,
          tension: 0.25,
          spanGaps: true,
          pointRadius: 2.5,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: trendBrushMotion(animate),
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxHeight: 8, padding: 14 } },
        tooltip: {
          usePointStyle: true,
          callbacks: {
            title: weekTooltipTitle(domainWeeks),
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: ${v.toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          min: brush.start,
          max: brush.end,
          offset: visible.length <= 1,
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: xTickLimit(visible.length),
          },
          title: { display: true, text: "Week ending" },
        },
        y: {
          beginAtZero: true,
          ...(yMax != null ? { max: yMax } : {}),
          title: { display: true, text: "% of ED visits" },
          ticks: {
            callback: (v) => `${v}%`,
          },
        },
      },
    },
  });
  applySparseXLayout(edChart, visible.length);
  if (visible.length <= 1) edChart.update("none");
}

function buildAcuteEdChart(domainWeeks, { animate = true } = {}) {
  const canvas = document.getElementById("acuteEdChart");
  if (!canvas) return;

  const hasAny = seriesHasValues(domainWeeks, "edAcuteRespiratory");
  setEmptyState("acuteEdChart", "acuteEdEmpty", !hasAny);
  setBrushVisibility("acuteEd", hasAny);
  renderAcuteEdSummary(sliceByBrush(domainWeeks, "acuteEd"));
  renderTrendTable("acuteEd", sliceByBrush(domainWeeks, "acuteEd"), hasAny);

  if (!hasAny) {
    if (acuteEdChart) {
      acuteEdChart.destroy();
      acuteEdChart = null;
    }
    return;
  }

  const { brush, visible } = brushWindow(domainWeeks, "acuteEd");
  const labels = domainWeeks.map((w) => formatDisplayDate(w.weekEnding));
  const values = domainWeeks.map((w) => w.edAcuteRespiratory);
  const yMax = visibleSeriesMax(visible, ["edAcuteRespiratory"], TREND_Y_STEP.acuteEd);

  if (acuteEdChart) {
    acuteEdChart.data.labels = labels;
    acuteEdChart.data.datasets[0].data = values;
    acuteEdChart.options.plugins.tooltip.callbacks.title =
      weekTooltipTitle(domainWeeks);
    applyTrendBrushWindow(
      acuteEdChart,
      "acuteEd",
      domainWeeks,
      ["edAcuteRespiratory"],
      { animate }
    );
    return;
  }

  acuteEdChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Acute respiratory ED visits",
          data: values,
          borderColor: chartTheme().acute,
          backgroundColor: chartTheme().acuteFill,
          fill: true,
          tension: 0.25,
          spanGaps: true,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: trendBrushMotion(animate),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: weekTooltipTitle(domainWeeks),
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return "ED visits: —";
              return `ED visits: ${Math.round(v).toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x: {
          min: brush.start,
          max: brush.end,
          offset: visible.length <= 1,
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: xTickLimit(visible.length),
          },
          title: { display: true, text: "Week ending" },
        },
        y: {
          beginAtZero: true,
          ...(yMax != null ? { max: yMax } : {}),
          title: { display: true, text: "ED visits" },
          ticks: {
            callback: (v) => Number(v).toLocaleString(),
          },
        },
      },
    },
  });
  applySparseXLayout(acuteEdChart, visible.length);
  if (visible.length <= 1) acuteEdChart.update("none");
}

function buildSchoolChart(domainWeeks, { animate = true } = {}) {
  const canvas = document.getElementById("schoolChart");
  if (!canvas) return;

  const hasAny = seriesHasValues(domainWeeks, "schoolAbsenteeism");
  setEmptyState("schoolChart", "schoolEmpty", !hasAny);
  setBrushVisibility("school", hasAny);
  renderSchoolSummary(sliceByBrush(domainWeeks, "school"));
  renderTrendTable("school", sliceByBrush(domainWeeks, "school"), hasAny);

  if (!hasAny) {
    if (schoolChart) {
      schoolChart.destroy();
      schoolChart = null;
    }
    return;
  }

  const { brush, visible } = brushWindow(domainWeeks, "school");
  const labels = domainWeeks.map((w) => formatDisplayDate(w.weekEnding));
  const values = domainWeeks.map((w) => w.schoolAbsenteeism);
  const yMax = visibleSeriesMax(visible, ["schoolAbsenteeism"], TREND_Y_STEP.school);

  if (schoolChart) {
    schoolChart.data.labels = labels;
    schoolChart.data.datasets[0].data = values;
    schoolChart.options.plugins.tooltip.callbacks.title =
      weekTooltipTitle(domainWeeks);
    applyTrendBrushWindow(schoolChart, "school", domainWeeks, ["schoolAbsenteeism"], {
      animate,
    });
    return;
  }

  schoolChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Student absenteeism",
          data: values,
          borderColor: chartTheme().school,
          backgroundColor: chartTheme().schoolFill,
          fill: true,
          tension: 0.25,
          spanGaps: false,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: trendBrushMotion(animate),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: weekTooltipTitle(domainWeeks),
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return "Absenteeism: —";
              return `Absenteeism: ${v.toFixed(2)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          min: brush.start,
          max: brush.end,
          offset: visible.length <= 1,
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: xTickLimit(visible.length),
          },
          title: { display: true, text: "Week ending" },
        },
        y: {
          beginAtZero: true,
          ...(yMax != null ? { max: yMax } : {}),
          title: { display: true, text: "% absent (open schools)" },
          ticks: {
            callback: (v) => `${v}%`,
          },
        },
      },
    },
  });
  applySparseXLayout(schoolChart, visible.length);
  if (visible.length <= 1) schoolChart.update("none");
}

const TREND_BRUSH_YKEYS = {
  ed: ["edCovid", "edFlu", "edRsv"],
  acuteEd: ["edAcuteRespiratory"],
  school: ["schoolAbsenteeism"],
};

function chartForBrush(brushKey) {
  if (brushKey === "ed") return edChart;
  if (brushKey === "acuteEd") return acuteEdChart;
  if (brushKey === "school") return schoolChart;
  return null;
}

function refreshOneTrendChart(brushKey, domainWeeks, { animate = true } = {}) {
  const weeks = sliceByBrush(domainWeeks, brushKey);
  if (brushKey === "ed") renderEdSummary(weeks);
  else if (brushKey === "acuteEd") renderAcuteEdSummary(weeks);
  else if (brushKey === "school") renderSchoolSummary(weeks);
  renderTrendTable(brushKey, weeks, Boolean(chartForBrush(brushKey)));

  applyTrendBrushWindow(
    chartForBrush(brushKey),
    brushKey,
    domainWeeks,
    TREND_BRUSH_YKEYS[brushKey],
    { animate }
  );
  syncBrushUI(brushKey, domainWeeks);
}

function refreshCharts({ resetBrushes = false, animate = true } = {}) {
  if (!dashboardData) return;
  const domainWeeks = getDomainWeeks();
  if (resetBrushes) resetBrushRanges(domainWeeks.length);
  else clampAllBrushes(domainWeeks.length);

  updateRangeCaption(dashboardData.meta, rangeMode, domainWeeks);
  syncAllBrushUI(domainWeeks);
  buildEdChart(domainWeeks, { animate });
  buildAcuteEdChart(domainWeeks, { animate });
  buildSchoolChart(domainWeeks, { animate });
  refreshVaccinations();
}

function formatVaxPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (Number.isInteger(n)) return `${n}%`;
  return `${n.toFixed(1)}%`;
}

const barValueLabels = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || meta.hidden) return;
    ctx.save();
    ctx.fillStyle = chartTheme().barLabel;
    ctx.font = '600 12px "Public Sans", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    meta.data.forEach((bar, i) => {
      const raw = chart.data.datasets[0]?.data?.[i];
      if (raw == null || Number.isNaN(Number(raw))) return;
      ctx.fillText(formatVaxPercent(raw), bar.x, bar.y - 4);
    });
    ctx.restore();
  },
};

function getVaxPathogenData() {
  const vax = dashboardData?.vaccinations;
  if (!vax) return null;
  return vax[vaxPathogen] || null;
}

function updateVaxTitles() {
  const pathogenLabel = VAX_PATHOGEN_LABELS[vaxPathogen] || "COVID-19";
  const titleEl = document.getElementById("vax-chart-title");
  const captionEl = document.getElementById("vax-chart-caption");
  if (!titleEl || !captionEl) return;

  if (vaxDimension === "overall") {
    titleEl.textContent = `Total up-to-date ${pathogenLabel} vaccine coverage`;
    captionEl.textContent =
      "Percent of the New York State population vaccinated.";
  } else if (vaxDimension === "age") {
    titleEl.textContent = `${pathogenLabel} vaccination by age`;
    captionEl.textContent =
      "Percent vaccinated in each age group (NYS).";
  } else {
    titleEl.textContent = `${pathogenLabel} vaccination by gender`;
    captionEl.textContent =
      "Percent vaccinated by gender (NYS).";
  }
}

function updateVaxCaptionAndFootnote() {
  const vax = dashboardData?.vaccinations;
  const caption = document.getElementById("vaxCaption");
  const footnote = document.getElementById("vaxFootnote");
  const pathogenLabel = VAX_PATHOGEN_LABELS[vaxPathogen] || "COVID-19";

  if (caption) {
    if (!vax) {
      caption.textContent = "Vaccination coverage data is not available yet.";
    } else {
      const asOf = vax.asOfDisplay || (vax.asOf ? formatDisplayDate(vax.asOf) : null);
      caption.textContent = asOf
        ? `Showing ${pathogenLabel} coverage as of ${asOf}.`
        : `Showing ${pathogenLabel} coverage.`;
    }
  }

  if (footnote && vax) {
    const parts = [
      "Coverage figures are New York State vaccination rates.",
    ];
    if (vax.asOfDisplay || vax.asOf) {
      parts.push(
        `Data as of ${vax.asOfDisplay || formatDisplayDate(vax.asOf)}.`
      );
    }
    const links = [];
    if (vax.sourceUrl) {
      links.push(
        `<a href="${vax.sourceUrl}" target="_blank" rel="noopener noreferrer">NYS vaccination data<span class="visually-hidden"> (opens in a new tab)</span></a>`
      );
    }
    if (vax.demographicsUrl) {
      links.push(
        `<a href="${vax.demographicsUrl}" target="_blank" rel="noopener noreferrer">demographics<span class="visually-hidden"> (opens in a new tab)</span></a>`
      );
    }
    footnote.innerHTML =
      parts.join(" ") +
      (links.length ? ` Source: ${links.join(" · ")}.` : "");
  }
}

function setVaxEmpty(isEmpty) {
  if (isEmpty) setTableVisible("vax", false);
  const empty = document.getElementById("vaxEmpty");
  const overallWrap = document.getElementById("vaxOverallWrap");
  const barWrap = document.getElementById("vaxBarWrap");
  if (empty) empty.classList.toggle("d-none", !isEmpty);
  if (isEmpty) {
    if (overallWrap) overallWrap.classList.add("d-none");
    if (barWrap) barWrap.classList.add("d-none");
  }
}

function destroyVaxCharts() {
  if (vaxDonutChart) {
    vaxDonutChart.destroy();
    vaxDonutChart = null;
  }
  if (vaxBarChart) {
    vaxBarChart.destroy();
    vaxBarChart = null;
  }
  vaxBarPendingBuild = null;
}

function buildVaxDonut(percent) {
  const canvas = document.getElementById("vaxDonutChart");
  const valueEl = document.getElementById("vaxDonutValue");
  const overallWrap = document.getElementById("vaxOverallWrap");
  const barWrap = document.getElementById("vaxBarWrap");
  if (!canvas) return;

  if (overallWrap) overallWrap.classList.remove("d-none");
  if (barWrap) barWrap.classList.add("d-none");
  if (vaxBarChart) {
    vaxBarChart.destroy();
    vaxBarChart = null;
  }

  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  if (valueEl) valueEl.textContent = formatVaxPercent(percent);

  const data = {
    labels: ["Vaccinated", "Remaining"],
    datasets: [
      {
        data: [pct, 100 - pct],
        backgroundColor: [chartTheme().vaxFill, chartTheme().vaxTrack],
        borderWidth: 0,
        hoverOffset: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    rotation: -90,
    circumference: 180,
    cutout: "72%",
    animation: chartMotionOptions(),
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };

  if (vaxDonutChart) {
    vaxDonutChart.data = data;
    vaxDonutChart.options = options;
    vaxDonutChart.update();
  } else {
    vaxDonutChart = new Chart(canvas, {
      type: "doughnut",
      data,
      options,
    });
  }

  const pathogenLabel = VAX_PATHOGEN_LABELS[vaxPathogen] || "COVID-19";
  setText(
    "vaxChartSummary",
    `Total up-to-date ${pathogenLabel} vaccine coverage: ${formatVaxPercent(percent)}.`
  );
  renderVaxTable(
    [["All ages (New York State)", percent]],
    `Total up-to-date ${pathogenLabel} vaccine coverage (percent of population)`
  );
}

/** Show the bar canvas and tear down any prior vax chart without drawing bars yet. */
function prepareVaxBarStage() {
  const overallWrap = document.getElementById("vaxOverallWrap");
  const barWrap = document.getElementById("vaxBarWrap");
  if (overallWrap) overallWrap.classList.add("d-none");
  if (barWrap) barWrap.classList.remove("d-none");
  if (vaxDonutChart) {
    vaxDonutChart.destroy();
    vaxDonutChart = null;
  }
  if (vaxBarChart) {
    vaxBarChart.destroy();
    vaxBarChart = null;
  }
}

function applyVaxBarCopy(map, axisLabel) {
  const labels = Object.keys(map || {});
  const values = labels.map((k) => map[k]);
  const pathogenLabel = VAX_PATHOGEN_LABELS[vaxPathogen] || "COVID-19";
  const dimLabel = vaxDimension === "age" ? "age" : "gender";
  const parts = labels.map((lab, i) => `${lab} ${formatVaxPercent(values[i])}`);
  setText(
    "vaxChartSummary",
    `${pathogenLabel} vaccination by ${dimLabel}: ${parts.join("; ")}.`
  );
  renderVaxTable(
    labels.map((lab, i) => [lab, values[i]]),
    `${pathogenLabel} vaccination by ${dimLabel} (percent vaccinated, NYS)`
  );
  return { labels, values };
}

function buildVaxBar(map, axisLabel, { animate = true } = {}) {
  const canvas = document.getElementById("vaxBarChart");
  if (!canvas) return;

  prepareVaxBarStage();

  const { labels, values } = applyVaxBarCopy(map, axisLabel);
  const maxVal = Math.max(0, ...values.map((v) => Number(v) || 0));
  const yMax = Math.max(10, Math.ceil((maxVal * 1.25) / 5) * 5);

  const data = {
    labels,
    datasets: [
      {
        label: "Percent vaccinated",
        data: values,
        backgroundColor: chartTheme().vaxFill,
        borderWidth: 0,
        borderRadius: 2,
        maxBarThickness: 48,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: animate ? barMotionOptions() : false,
    layout: { padding: { top: 18 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (v == null) return "—";
            return formatVaxPercent(v);
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: axisLabel },
        grid: { display: false },
        ticks: { maxRotation: 45, minRotation: 0, autoSkip: false },
      },
      y: {
        beginAtZero: true,
        max: yMax,
        title: { display: true, text: "Percentage vaccinated" },
        ticks: {
          callback: (v) => `${v}%`,
        },
        grid: {
          color: chartTheme().grid,
          borderDash: [4, 4],
        },
      },
    },
  };

  // Always create fresh so Chart.js runs its from-zero bar rise.
  if (vaxBarChart) {
    vaxBarChart.destroy();
    vaxBarChart = null;
  }
  vaxBarChart = new Chart(canvas, {
    type: "bar",
    data,
    options,
    plugins: [barValueLabels],
  });
}

/** Finish a bar build that waited until the fade-in made the canvas visible. */
function flushPendingVaxBarBuild() {
  if (!vaxBarPendingBuild) return;
  const { map, axisLabel } = vaxBarPendingBuild;
  vaxBarPendingBuild = null;
  buildVaxBar(map, axisLabel, { animate: true });
}

function renderVaccinationsContent({ deferBarChart = false } = {}) {
  updateVaxTitles();
  updateVaxCaptionAndFootnote();
  vaxBarPendingBuild = null;

  const pathogen = getVaxPathogenData();
  if (!pathogen) {
    destroyVaxCharts();
    setVaxEmpty(true);
    setText("vaxChartSummary", "Vaccination data is not available.");
    return;
  }

  if (vaxDimension === "overall") {
    if (pathogen.overallPercent == null) {
      destroyVaxCharts();
      setVaxEmpty(true);
      setText("vaxChartSummary", "Overall vaccination coverage is not available.");
      return;
    }
    setVaxEmpty(false);
    buildVaxDonut(pathogen.overallPercent);
    return;
  }

  const map =
    vaxDimension === "age" ? pathogen.byAge : pathogen.byGender;
  if (!map || !Object.keys(map).length) {
    destroyVaxCharts();
    setVaxEmpty(true);
    setText(
      "vaxChartSummary",
      vaxDimension === "age"
        ? "Vaccination by age is not available."
        : "Vaccination by gender is not available."
    );
    return;
  }

  setVaxEmpty(false);
  const axisLabel = vaxDimension === "age" ? "Age group" : "Gender";

  if (deferBarChart) {
    // Canvas must be visible before Chart.js creates bars, or the rise finishes unseen.
    prepareVaxBarStage();
    applyVaxBarCopy(map, axisLabel);
    vaxBarPendingBuild = { map, axisLabel };
    return;
  }

  buildVaxBar(map, axisLabel, { animate: !prefersReducedMotion() });
}

function resizeVaxCharts() {
  if (vaxDonutChart) vaxDonutChart.resize();
  if (vaxBarChart) vaxBarChart.resize();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshVaccinations(options = {}) {
  const { animate = false } = options;
  const stage = document.getElementById("vaxChartStage");
  const useAnim =
    animate && vaxHasRendered && stage && !prefersReducedMotion();
  const token = ++vaxTransitionToken;

  if (useAnim) {
    stage.classList.remove("is-entering");
    stage.classList.add("is-leaving");
    await waitMs(VAX_FADE_MS);
    if (token !== vaxTransitionToken) return;
  }

  // Defer creating the bar chart until after fade-in (Overall → Age/Gender).
  renderVaccinationsContent({ deferBarChart: useAnim });
  vaxHasRendered = true;

  if (useAnim) {
    stage.classList.add("is-entering");
    stage.classList.remove("is-leaving");
    // Force a reflow so the enter transition starts from opacity 0
    void stage.offsetWidth;
    requestAnimationFrame(() => {
      if (token !== vaxTransitionToken) return;
      stage.classList.remove("is-entering");
      if (!vaxBarPendingBuild) resizeVaxCharts();
    });
    await waitMs(VAX_FADE_MS);
    if (token !== vaxTransitionToken) return;
    // Build bars after fade-in so Chart.js's from-zero rise is fully visible
    // (creating during opacity:0 made Overall → Age look already finished).
    if (vaxBarPendingBuild) flushPendingVaxBarBuild();
    else resizeVaxCharts();
  }
}

function bindSeasonToggle() {
  const toggle = document.querySelector(
    '.charts-section .season-toggle[aria-label="Select time range"]'
  );
  const buttons = toggle
    ? toggle.querySelectorAll(".season-btn")
    : document.querySelectorAll('.season-btn[data-range]');
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-range");
      if (!next || next === rangeMode) return;
      rangeMode = next;
      buttons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      refreshCharts({ resetBrushes: true });
      announce(document.getElementById("rangeCaption")?.textContent || "");
    });
  });
}

function bindChartBrushes() {
  document.querySelectorAll("[data-brush]").forEach((root) => {
    const brushKey = root.getAttribute("data-brush");
    if (!brushKey || !chartBrushes[brushKey]) return;

    const rail = root.querySelector(".chart-brush-rail");
    const selection = root.querySelector("[data-brush-selection]");
    const startHandle = root.querySelector('[data-brush-handle="start"]');
    const endHandle = root.querySelector('[data-brush-handle="end"]');
    if (!rail || !startHandle || !endHandle) return;

    const indexFromClientX = (clientX) => {
      const weeks = getDomainWeeks();
      const n = weeks.length;
      if (n <= 1) return 0;
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(t * (n - 1));
    };

    let brushRaf = 0;
    let pendingAnimate = true;

    const flushBrushChange = () => {
      brushRaf = 0;
      if (!dashboardData) return;
      refreshOneTrendChart(brushKey, getDomainWeeks(), { animate: pendingAnimate });
    };

    const applyBrushChange = ({ animate = true, immediate = false } = {}) => {
      pendingAnimate = animate;
      if (immediate) {
        if (brushRaf) {
          cancelAnimationFrame(brushRaf);
          brushRaf = 0;
        }
        flushBrushChange();
        return;
      }
      if (brushRaf) return;
      brushRaf = requestAnimationFrame(flushBrushChange);
    };

    const beginDrag = (mode, pointerId, targetEl, clientX) => {
      const brush = chartBrushes[brushKey];
      const weeks = getDomainWeeks();
      if (weeks.length < 1) return;

      const dragState = {
        mode,
        pointerId,
        originIndex: indexFromClientX(clientX),
        originStart: brush.start,
        originEnd: brush.end,
      };

      root.classList.add("is-dragging");
      targetEl.classList.add("is-dragging");
      if (mode === "window" && selection) selection.classList.add("is-dragging");

      const onMove = (ev) => {
        if (ev.pointerId !== dragState.pointerId) return;
        const idx = indexFromClientX(ev.clientX);
        if (dragState.mode === "start") {
          brush.start = Math.min(idx, brush.end);
        } else if (dragState.mode === "end") {
          brush.end = Math.max(idx, brush.start);
        } else {
          const delta = idx - dragState.originIndex;
          const span = dragState.originEnd - dragState.originStart;
          const maxStart = Math.max(0, weeks.length - 1 - span);
          brush.start = Math.max(0, Math.min(maxStart, dragState.originStart + delta));
          brush.end = brush.start + span;
        }
        // Track the pointer 1:1 while dragging; settle with easing on release.
        applyBrushChange({ animate: false });
      };

      const onUp = (ev) => {
        if (ev.pointerId !== dragState.pointerId) return;
        root.classList.remove("is-dragging");
        targetEl.classList.remove("is-dragging");
        if (selection) selection.classList.remove("is-dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        applyBrushChange({ animate: true, immediate: true });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };

    startHandle.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      startHandle.focus({ preventScroll: true });
      beginDrag("start", ev.pointerId, startHandle, ev.clientX);
    });

    endHandle.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      endHandle.focus({ preventScroll: true });
      beginDrag("end", ev.pointerId, endHandle, ev.clientX);
    });

    if (selection) {
      selection.addEventListener("pointerdown", (ev) => {
        if (ev.button != null && ev.button !== 0) return;
        if (ev.target.closest(".chart-brush-handle")) return;
        ev.preventDefault();
        beginDrag("window", ev.pointerId, selection, ev.clientX);
      });
    }

    rail.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      if (ev.target.closest(".chart-brush-handle, [data-brush-selection]")) return;
      ev.preventDefault();
      const brush = chartBrushes[brushKey];
      const idx = indexFromClientX(ev.clientX);
      if (Math.abs(idx - brush.start) <= Math.abs(idx - brush.end)) {
        brush.start = Math.min(idx, brush.end);
        beginDrag("start", ev.pointerId, startHandle, ev.clientX);
      } else {
        brush.end = Math.max(idx, brush.start);
        beginDrag("end", ev.pointerId, endHandle, ev.clientX);
      }
      applyBrushChange({ animate: false });
    });

    const onKey = (which) => (ev) => {
      const brush = chartBrushes[brushKey];
      const weeks = getDomainWeeks();
      if (weeks.length < 1) return;
      const max = weeks.length - 1;
      let delta = 0;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") delta = -1;
      else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") delta = 1;
      else if (ev.key === "PageDown") delta = -4;
      else if (ev.key === "PageUp") delta = 4;
      else if (ev.key === "Home") {
        if (which === "start") brush.start = 0;
        else brush.end = brush.start;
        ev.preventDefault();
        applyBrushChange({ animate: true, immediate: true });
        return;
      } else if (ev.key === "End") {
        if (which === "end") brush.end = max;
        else brush.start = brush.end;
        ev.preventDefault();
        applyBrushChange({ animate: true, immediate: true });
        return;
      } else {
        return;
      }
      ev.preventDefault();
      if (which === "start") brush.start = Math.max(0, Math.min(brush.end, brush.start + delta));
      else brush.end = Math.max(brush.start, Math.min(max, brush.end + delta));
      applyBrushChange({ animate: true, immediate: true });
    };

    startHandle.addEventListener("keydown", onKey("start"));
    endHandle.addEventListener("keydown", onKey("end"));
  });
}

function bindVaxToggles() {
  const pathogenBtns = document.querySelectorAll("[data-vax-pathogen]");
  pathogenBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-vax-pathogen");
      if (!next || next === vaxPathogen) return;
      vaxPathogen = next;
      pathogenBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      refreshVaccinations({ animate: true }).then(announceVaxChange);
    });
  });

  const dimensionBtns = document.querySelectorAll("[data-vax-dimension]");
  dimensionBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-vax-dimension");
      if (!next || next === vaxDimension) return;
      vaxDimension = next;
      dimensionBtns.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
      refreshVaccinations({ animate: true }).then(announceVaxChange);
    });
  });
}

function announceVaxChange() {
  const title = document.getElementById("vax-chart-title")?.textContent || "";
  const summary = document.getElementById("vaxChartSummary")?.textContent || "";
  announce(`${title}. ${summary}`.trim());
}

/** Rebuild canvases when the OS light/dark preference changes. */
function rebuildChartsForTheme() {
  applyChartDefaults();
  if (gaugeChart) {
    gaugeChart.destroy();
    gaugeChart = null;
  }
  initGauge();
  if (gaugeChart) gaugeChart.update("none");
  [edChart, acuteEdChart, schoolChart].forEach((c) => c && c.destroy());
  edChart = null;
  acuteEdChart = null;
  schoolChart = null;
  destroyVaxCharts();
  if (dashboardData) refreshCharts({ animate: false });
}

function initRevealAndBackToTop() {
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && !prefersReducedMotion()) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("reveal-in"));
  }

  const backToTopBtn = document.getElementById("backToTop");
  if (backToTopBtn) {
    const toggleBtn = () => {
      const show = window.scrollY > 300;
      backToTopBtn.hidden = !show;
    };
    toggleBtn();
    window.addEventListener("scroll", toggleBtn, { passive: true });
    backToTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      const skipTarget = document.getElementById("main-content");
      if (skipTarget) skipTarget.focus({ preventScroll: true });
    });
  }
}

async function loadDashboardData() {
  const res = await fetch("./data/weekly.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load weekly.json (${res.status})`);
  return res.json();
}

document.addEventListener("DOMContentLoaded", async () => {
  applyChartDefaults();
  initGauge();
  observeGaugeVisibility();
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" || ev.key === "Esc") dismissChartTooltips();
  });
  if (colorSchemeQuery.addEventListener) {
    colorSchemeQuery.addEventListener("change", rebuildChartsForTheme);
  } else if (colorSchemeQuery.addListener) {
    colorSchemeQuery.addListener(rebuildChartsForTheme);
  }
  bindSeasonToggle();
  bindChartBrushes();
  bindVaxToggles();
  initRevealAndBackToTop();

  try {
    dashboardData = await loadDashboardData();
    updateHeader(dashboardData.meta || {});
    updateActivityUI(ACTIVITY);
    applySeasonAvailability(dashboardData.meta || {});
    refreshCharts({ resetBrushes: true });
  } catch (err) {
    console.error(err);
    showLoadError("Unable to load weekly data. Check data/weekly.json.");
    updateActivityUI(ACTIVITY);
    setEmptyState("edChart", "edEmpty", true);
    setEmptyState("acuteEdChart", "acuteEdEmpty", true);
    setEmptyState("schoolChart", "schoolEmpty", true);
    setBrushVisibility("ed", false);
    setBrushVisibility("acuteEd", false);
    setBrushVisibility("school", false);
    ["ed", "acuteEd", "school"].forEach((key) => setTableVisible(key, false));
    setVaxEmpty(true);
  }
});
