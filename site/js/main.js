import { gee } from "./stats.js";
import { decodeEeg, eegClusters, behaviorClusters, erpSummary, proportion } from "./data.js";
import { el, text, scale, linePath, bandPath, svgFor, responsive, ticks } from "./charts.js";
import { measureFrameInterval, framesFor, makeTrials, runTask, summarize } from "./task.js";

const $ = (s) => document.querySelector(s);
const dataUrl = (f) => new URL(`../data/${f}`, import.meta.url);

const PRESETS = ["P2", "N2", "P3", "LPP"];
const EXPOSURES = [17, 33, 50, 67, 100, 150];
const CONTROL = { moral: "non-moral", fashion: "non-fashion" };

const state = {
  behavior: null,
  eeg: null,
  you: null,                       // task summary once finished
  test: "pz", block: "moral", pool: true,
  window: { preset: "P3" },
  frameMs: 1000 / 60,
};

/* ---------- formatting ---------- */

const fmt = (v, d = 2) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const pct = (v) => `${(100 * v).toFixed(1)}%`;
function fmtP(p) {
  if (p < 0.001) return "< .001";
  return "= " + p.toFixed(3).replace(/^0/, "");
}
const pCell = (p) => (p < 0.001 ? "<.001" : p.toFixed(3).replace(/^0/, ""));
const windowName = (w) => (w.preset ? w.preset : `${w.from} to ${w.to} ms`);
function windowRange(w) {
  if (!w.preset) return [w.from, w.to];
  return state.eeg.meta.presets[w.preset];
}

/* ---------- contrasts ---------- */

// Level 1 minus level 0. For Cz the page reports category minus control,
// the opposite sign to R's default coding.
function contrast(test, block, pool) {
  if (test === "pz") {
    return { electrode: "Pz", level0: [[block, false]], level1: [[block, true]],
             labels: ["non-words", "words"] };
  }
  const lv = (wt) => (pool ? [[wt, true], [wt, false]] : [[wt, true]]);
  return { electrode: "Cz", level0: lv(CONTROL[block]), level1: lv(block),
           labels: [`${CONTROL[block]}`, `${block}`] };
}

function fitBoth(c, window) {
  const clusters = eegClusters(state.eeg, c, window);
  return {
    fixed: gee(clusters, "gaussian"),
    published: gee(clusters, "gaussian", { trialClusters: true }),
  };
}

/* ---------- task ---------- */

function exposureMs() { return EXPOSURES[+$("#exposure").value]; }

function updateExposureLabel() {
  const ms = exposureMs();
  const frames = framesFor(ms, state.frameMs);
  const hz = Math.round(1000 / state.frameMs);
  $("#exposure-out").textContent = `${ms} ms`;
  $("#frames-out").textContent =
    `${frames} frame${frames > 1 ? "s" : ""} on your ${hz} Hz screen, ${(frames * state.frameMs).toFixed(1)} ms`;
}

function setupTask() {
  const startBtn = $("#start");
  const wordBtn = $("#answer-word");
  const nonBtn = $("#answer-nonword");
  let ctl = null;

  measureFrameInterval().then((ms) => { state.frameMs = ms; updateExposureLabel(); });
  $("#exposure").addEventListener("input", updateExposureLabel);
  updateExposureLabel();

  const finish = (results) => {
    ctl = null;
    $("#stage").classList.add("idle");
    startBtn.textContent = "Start again";
    wordBtn.disabled = nonBtn.disabled = true;
    $("#exposure").disabled = false;
    if (results.length) showTaskResult(summarize(results), results.length);
  };

  startBtn.addEventListener("click", () => {
    if (ctl) { ctl.stop(); return; }
    if (!state.behavior) return;
    const trials = makeTrials(state.behavior.stimuli, 5);
    $("#exposure").disabled = true;
    $("#stage").classList.remove("idle");
    wordBtn.disabled = nonBtn.disabled = false;
    startBtn.textContent = "Stop";
    $("#progress").textContent = `Trial 1 of ${trials.length}`;
    ctl = runTask({
      stage: $("#stage"), trials, frameMs: state.frameMs, exposureMs: exposureMs(),
      onProgress: (i, n) => { $("#progress").textContent = i < n ? `Trial ${i + 1} of ${n}` : `Done, ${n} trials`; },
      onDone: finish,
    });
    wordBtn.focus({ preventScroll: true });
  });

  wordBtn.addEventListener("click", () => ctl?.respond(true));
  nonBtn.addEventListener("click", () => ctl?.respond(false));
  document.addEventListener("keydown", (e) => {
    if (!ctl || e.repeat) return;
    if (e.key === "1") { ctl.respond(true); e.preventDefault(); }
    if (e.key === "5") { ctl.respond(false); e.preventDefault(); }
  });
}

function showTaskResult(sum, done) {
  const get = (k) => sum[k];
  const words = ["moral", "non-moral", "fashion", "non-fashion"].map((wt) => get(`${wt}|word`));
  const nonwords = ["moral", "non-moral", "fashion", "non-fashion"].map((wt) => get(`${wt}|nonword`));
  const tot = (arr) => arr.reduce((a, x) => ({ n: a.n + x.n, c: a.c + x.correct }), { n: 0, c: 0 });
  const w = tot(words), nw = tot(nonwords);
  const acc = (x) => (x.n ? x.correct / x.n : NaN);
  state.you = {
    moral: { x: acc(get("non-moral|word")), y: acc(get("moral|word")) },
    fashion: { x: acc(get("non-fashion|word")), y: acc(get("fashion|word")) },
  };
  const s = sum.shownMs;
  const lab = state.behavior ? labWordAccuracy() : null;
  const p = $("#task-result");
  p.hidden = false;
  p.textContent =
    `You answered ${w.c} of ${w.n} words and ${nw.c} of ${nw.n} non-words correctly` +
    (done < 40 ? ` in ${done} trials` : "") + ". " +
    `On words: moral ${get("moral|word").correct}/${get("moral|word").n}, ` +
    `non-moral ${get("non-moral|word").correct}/${get("non-moral|word").n}, ` +
    `fashion ${get("fashion|word").correct}/${get("fashion|word").n}, ` +
    `non-fashion ${get("non-fashion|word").correct}/${get("non-fashion|word").n}. ` +
    (s ? `The letters were up for a median of ${s.median.toFixed(1)} ms (${s.min.toFixed(1)} to ${s.max.toFixed(1)}). ` : "") +
    (lab ? `Participants in the lab got ${pct(lab)} of words right. ` : "") +
    "Your point is now on the plots below.";
  $("#you-note").textContent = "Your result is the red ring.";
  drawScatters();
}

/* ---------- behavior ---------- */

function labWordAccuracy() {
  const b = state.behavior;
  const cells = ["moral|word", "non-moral|word", "fashion|word", "non-fashion|word"];
  const per = b.subjects.map((s) => proportion(b, s, cells));
  return per.reduce((a, v) => a + v, 0) / per.length;
}

function drawScatter(container, block) {
  const b = state.behavior;
  const pts = b.subjects.map((s) => ({
    x: proportion(b, s, [`${CONTROL[block]}|word`]),
    y: proportion(b, s, [`${block}|word`]),
  }));
  const you = state.you?.[block];
  const all = pts.concat(you && Number.isFinite(you.x) && Number.isFinite(you.y) ? [you] : []);
  const lo = Math.min(0.5, Math.floor(Math.min(...all.flatMap((p) => [p.x, p.y])) * 10) / 10);
  const width = Math.max(240, container.clientWidth);
  const size = Math.min(width, 320);
  const m = { l: 44, r: 12, t: 26, b: 40 };
  const { svg } = svgFor(container, size, `${block} word accuracy against control word accuracy, one dot per participant`);
  const plot = Math.min(width - m.l - m.r, size - m.t - m.b);
  const x = scale(lo, 1, m.l, m.l + plot);
  const y = scale(lo, 1, m.t + plot, m.t);
  text(svg, m.l, 15, `${block[0].toUpperCase()}${block.slice(1)} words`, { class: "title" });
  const ax = el("g", { class: "axis" }, svg);
  el("line", { x1: m.l, x2: m.l + plot, y1: m.t + plot, y2: m.t + plot }, ax);
  el("line", { x1: m.l, x2: m.l, y1: m.t, y2: m.t + plot }, ax);
  for (const v of ticks(lo, 1, lo < 0.5 ? 0.25 : 0.1)) {
    el("line", { x1: x(v), x2: x(v), y1: m.t + plot, y2: m.t + plot + 4 }, ax);
    text(ax, x(v), m.t + plot + 16, `${Math.round(v * 100)}`, { "text-anchor": "middle" });
    el("line", { x1: m.l - 4, x2: m.l, y1: y(v), y2: y(v) }, ax);
    text(ax, m.l - 7, y(v) + 4, `${Math.round(v * 100)}`, { "text-anchor": "end" });
  }
  text(svg, m.l + plot, m.t + plot + 34, `% correct, ${CONTROL[block]} words`, { class: "label", "text-anchor": "end" });
  text(svg, 0, 0, `% correct, ${block} words`, {
    class: "label", "text-anchor": "end", transform: `translate(${m.l - 32},${m.t}) rotate(-90)`,
  });
  el("line", { class: "diag", x1: x(lo), y1: y(lo), x2: x(1), y2: y(1) }, svg);
  for (const p of pts) el("circle", { class: "dot", cx: x(p.x), cy: y(p.y), r: 3 }, svg);
  if (you && Number.isFinite(you.x) && Number.isFinite(you.y)) {
    el("circle", { class: "you", cx: x(you.x), cy: y(you.y), r: 7 }, svg);
    const right = x(you.x) < m.l + plot - 40;
    text(svg, x(you.x) + (right ? 11 : -11), y(you.y) + 4, "you", { class: "you-label", "text-anchor": right ? "start" : "end" });
  }
}

function drawScatters() {
  if (!state.behavior) return;
  drawScatter($("#scatter-moral"), "moral");
  drawScatter($("#scatter-fashion"), "fashion");
}

function behaviorText() {
  const b = state.behavior;
  const parts = ["moral", "fashion"].map((block) => {
    const mean = (cell) => b.subjects.reduce((a, s) => a + proportion(b, s, [cell]), 0) / b.subjects.length;
    const cat = mean(`${block}|word`), con = mean(`${CONTROL[block]}|word`);
    const fit = gee(behaviorClusters(b, [`${CONTROL[block]}|word`], [`${block}|word`]), "binomial");
    return { block, cat, con, fit };
  });
  const [m, f] = parts;
  const sig = (x) => (x.fit.p < 0.05 ? "significant" : "not significant");
  $("#behavior-text").innerHTML =
    `On moral words participants were ${pct(m.cat)} correct, against ${pct(m.con)} on non-moral words. ` +
    `That difference was ${sig(m)} (GEE, <i>b</i> = ${fmt(m.fit.estimate)} log odds, <i>p</i> ${fmtP(m.fit.p)}). ` +
    `On fashion words they were ${pct(f.cat)} correct, against ${pct(f.con)} on non-fashion words, ` +
    `which was ${sig(f)} (<i>b</i> = ${fmt(f.fit.estimate)}, <i>p</i> ${fmtP(f.fit.p)}). ` +
    (f.fit.p < 0.05 && m.fit.p >= 0.05
      ? "So in our data the pop-out showed up for the control category, not for morality."
      : "");
}

function sampleText() {
  const b = state.behavior;
  const byReason = {};
  for (const r of Object.values(b.excluded)) byReason[r] = (byReason[r] || 0) + 1;
  const reasons = Object.entries(byReason).map(([r, n]) => `${n} ${r}`);
  const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}` : reasons[0];
  $("#sample-text").textContent =
    `The data set has ${b.sessions.length} sessions from Vassar College students. ` +
    `We excluded ${Object.keys(b.excluded).length}: ${list}. ` +
    `The fashion block repeat was a bug in the experiment script. That leaves ${b.subjects.length} participants for every analysis on this page.`;
  const live = document.querySelector('[data-live="word-accuracy"]');
  if (live) live.textContent = pct(labWordAccuracy());
}

/* ---------- ERP explorer ---------- */

function drawErp() {
  if (!state.eeg) return;
  const container = $("#erp");
  const c = contrast(state.test, state.block, state.pool);
  const lines = [
    { conds: c.level1, cls: "ink", label: c.labels[1] },
    { conds: c.level0, cls: "muted dashed", label: c.labels[0] },
  ].map((l) => ({ ...l, ...erpSummary(state.eeg, l.conds, c.electrode) }));

  const width = Math.max(240, container.clientWidth);
  const height = Math.round(Math.min(360, Math.max(240, width * 0.55)));
  const narrow = width < 480;
  const m = { l: 38, r: narrow ? 12 : 84, t: narrow ? 44 : 22, b: 36 };
  const { svg } = svgFor(container, height, `Grand average ERP at ${c.electrode}, ${c.labels[1]} against ${c.labels[0]}`);

  let ymin = Infinity, ymax = -Infinity;
  for (const l of lines) l.mean.forEach((v, i) => { ymin = Math.min(ymin, v - l.se[i]); ymax = Math.max(ymax, v + l.se[i]); });
  ymin = Math.floor(ymin / 2) * 2; ymax = Math.ceil(ymax / 2) * 2;
  const t = lines[0].t;
  const x = scale(t[0], t.at(-1), m.l, width - m.r);
  const y = scale(ymin, ymax, height - m.b, m.t);

  // analysis window
  const [w0, w1] = windowRange(state.window);
  el("rect", { class: "window", x: x(w0), y: m.t, width: Math.max(1, x(w1) - x(w0)), height: height - m.t - m.b }, svg);
  el("line", { class: "window-edge", x1: x(w0), x2: x(w0), y1: m.t, y2: height - m.b }, svg);
  el("line", { class: "window-edge", x1: x(w1), x2: x(w1), y1: m.t, y2: height - m.b }, svg);
  text(svg, (x(w0) + x(w1)) / 2, m.t - 7, windowName(state.window), { class: "you-label", "text-anchor": "middle" });

  const ax = el("g", { class: "axis" }, svg);
  el("line", { class: "zero", x1: m.l, x2: width - m.r, y1: y(0), y2: y(0) }, svg);
  el("line", { x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b }, ax);
  for (const v of ticks(t[0], t.at(-1), width < 480 ? 400 : 200)) {
    el("line", { x1: x(v), x2: x(v), y1: height - m.b, y2: height - m.b + 4 }, ax);
    text(ax, x(v), height - m.b + 17, `${v}`, { "text-anchor": "middle" });
  }
  text(svg, width - m.r, height - 2, "ms after word onset", { class: "label", "text-anchor": "end" });
  for (const v of ticks(ymin, ymax, ymax - ymin > 12 ? 4 : 2)) {
    text(ax, m.l - 6, y(v) + 4, `${v}`, { "text-anchor": "end" });
  }
  text(svg, m.l - 6, m.t - 7, "µV", { class: "label", "text-anchor": "end" });
  el("line", { class: "zero", x1: x(0), x2: x(0), y1: m.t, y2: height - m.b }, svg);

  for (const l of lines) {
    el("path", { class: "band", d: bandPath(t, l.mean.map((v, i) => v - l.se[i]), l.mean.map((v, i) => v + l.se[i]), x, y) }, svg);
  }
  for (const l of lines) el("path", { class: l.cls, d: linePath(t, l.mean, x, y) }, svg);

  // direct labels at the right end, or a key under the title on narrow screens
  if (m.r > 40) {
    const ends = lines.map((l) => ({ l, yy: y(l.mean.at(-1)) }));
    if (Math.abs(ends[0].yy - ends[1].yy) < 15) {
      const mid = (ends[0].yy + ends[1].yy) / 2, up = ends[0].yy <= ends[1].yy ? 0 : 1;
      ends[up].yy = mid - 8; ends[1 - up].yy = mid + 8;
    }
    for (const { l, yy } of ends) {
      text(svg, width - m.r + 6, yy + 4, l.label, { class: l.cls.startsWith("ink") ? "lab-ink" : "lab-muted" });
    }
  } else {
    let kx = m.l + 4;
    for (const l of lines) {
      el("line", { class: l.cls, x1: kx, x2: kx + 18, y1: 8, y2: 8 }, svg);
      const lab = text(svg, kx + 22, 12, l.label, { class: l.cls.startsWith("ink") ? "lab-ink" : "lab-muted" });
      kx += 30 + lab.getComputedTextLength();
    }
  }

  state.erpX = x;
}

function setWindow(w) {
  state.window = w;
  for (const btn of document.querySelectorAll("#presets button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === w.preset));
  }
  drawErp();
  drawFits();
}

function drawFits() {
  if (!state.eeg) return;
  const c = contrast(state.test, state.block, state.pool);
  const { fixed, published } = fitBoth(c, state.window);
  const what = state.test === "pz" ? `${state.block} words minus non-words` : `${state.block} minus ${CONTROL[state.block]}`;
  const row = (name, f) =>
    `<tr><td>${name}</td><td class="num">${fmt(f.estimate)}</td><td class="num">${fmt(f.se)}</td>` +
    `<td class="num">${fmt(f.z)}</td><td class="num">${pCell(f.p)}</td><td class="num">${f.clusters.toLocaleString("en-US")}</td></tr>`;
  $("#fits").innerHTML =
    `<div class="table-wrap"><table>` +
    `<thead><tr><th scope="col">${c.electrode}, ${what}, ${windowName(state.window)}</th><th class="num">&micro;V</th><th class="num">SE</th><th class="num"><i>z</i></th><th class="num"><i>p</i></th><th class="num">clusters</th></tr></thead>` +
    `<tbody>${row("As published", published)}${row("Corrected", fixed)}</tbody></table></div>`;
  drawCi(fixed, published);

  const live = document.querySelector('[data-live="trial-clusters"]');
  if (live) live.textContent = published.clusters.toLocaleString("en-US");

  const ratio = fixed.se / published.se;
  const verdict = (f) => (f.p < 0.05 ? "significant" : "not significant");
  $("#bug-text").textContent =
    `In this window the corrected standard error is ${ratio.toFixed(2)} times the published one, ` +
    `and the difference is ${verdict(fixed)} at .05 after the fix` +
    (verdict(fixed) === verdict(published) ? ", as it was before." : `, where the published fit called it ${verdict(published)}.`) +
    ` The estimated correlation between trials from the same person is ${fixed.alpha.toFixed(3)}. ` +
    (ratio > 1
      ? `That looks small, but it is shared by about ${Math.round(fixed.observations / (2 * fixed.clusters))} trials per participant and condition, which is what inflates the error.`
      : "Here the clustered error comes out smaller. Clustering by participant does not always widen the interval, but it is the right interval for this design.");
}

function drawCi(fixed, published) {
  const container = $("#ci");
  const width = Math.max(240, container.clientWidth);
  const rows = [{ f: published, name: "As published", cls: "published" }, { f: fixed, name: "Corrected", cls: "" }];
  const lo = Math.min(0, ...rows.map((r) => r.f.estimate - 1.96 * r.f.se));
  const hi = Math.max(0, ...rows.map((r) => r.f.estimate + 1.96 * r.f.se));
  const pad = (hi - lo) * 0.08;
  const left = width < 480 ? 92 : 110;
  const { svg } = svgFor(container, 84, "95% confidence intervals, as published and corrected");
  const x = scale(lo - pad, hi + pad, left, width - 12);
  el("line", { class: "zero", x1: x(0), x2: x(0), y1: 4, y2: 62 }, svg);
  rows.forEach((r, i) => {
    const yy = 18 + i * 26;
    text(svg, 0, yy + 4, r.name, { class: i ? "lab-ink" : "lab-muted" });
    el("line", { class: `ci-line ${r.cls}`, x1: x(r.f.estimate - 1.96 * r.f.se), x2: x(r.f.estimate + 1.96 * r.f.se), y1: yy, y2: yy }, svg);
    el("circle", { class: `ci-dot ${r.cls}`, cx: x(r.f.estimate), cy: yy, r: 4 }, svg);
  });
  text(svg, x(0), 78, "0", { class: "label", "text-anchor": "middle" });
  text(svg, width - 12, 78, "95% interval, µV", { class: "label", "text-anchor": "end" });
}

function allTestsTable() {
  const rows = [];
  let sigPub = 0, sigFix = 0;
  const changed = [];
  for (const test of ["pz", "cz"]) {
    for (const block of ["moral", "fashion"]) {
      const c = contrast(test, block, true);
      PRESETS.forEach((w, i) => {
        const { fixed, published } = fitBoth(c, { preset: w });
        if (published.p < 0.05) sigPub++;
        if (fixed.p < 0.05) sigFix++;
        const flip = (published.p < 0.05) !== (fixed.p < 0.05);
        const name = test === "pz" ? `Pz, ${block} words vs non-words` : `Cz, ${block} vs ${CONTROL[block]}`;
        if (flip) changed.push(`${name.replace(/^(Pz|Cz), /, "")} in the ${w} window at ${c.electrode}`);
        if (i === 0) rows.push(`<tr class="group"><th colspan="4" scope="rowgroup">${name}</th></tr>`);
        rows.push(
          `<tr><td>${w}</td>` +
          `<td class="num">${fmt(fixed.estimate)}</td><td class="num">${pCell(published.p)}</td>` +
          `<td class="num${flip ? " changed" : ""}">${pCell(fixed.p)}</td></tr>`);
      });
    }
  }
  $("#all-tests tbody").innerHTML = rows.join("");
  $("#summary-text").textContent =
    `As published, ${sigPub} of the 16 tests were significant at .05. After the fix, ${sigFix} are. ` +
    (changed.length ? `The one${changed.length > 1 ? "s" : ""} that changed: ${changed.join("; ")}. ` : "") +
    "The word and non-word differences at Pz hold up. The pop-out comparison at Cz, done the original way, finds nothing for either category before or after the fix.";
  wordsOnlyText();
}

// Cz with real words only. Not the analysis in the report, so it is
// described as exploratory and computed here rather than claimed in advance.
function wordsOnlyText() {
  const hits = [], nonwordHits = [];
  for (const block of ["moral", "fashion"]) {
    for (const w of PRESETS) {
      const words = gee(eegClusters(state.eeg, contrast("cz", block, false), { preset: w }), "gaussian");
      const non = gee(eegClusters(state.eeg, { electrode: "Cz", level0: [[CONTROL[block], false]], level1: [[block, false]] }, { preset: w }), "gaussian");
      if (words.p < 0.05) hits.push(`${block} words ${words.estimate > 0 ? "above" : "below"} ${CONTROL[block]} words in the ${w} window (${fmt(words.estimate)} \u00b5V, <i>p</i> ${fmtP(words.p)})`);
      if (non.p < 0.05) nonwordHits.push(`${block} in the ${w} window`);
    }
  }
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a.at(-1)}` : a[0]);
  $("#words-only-text").innerHTML =
    "The original code compared every string from the moral list with every string from the non-moral list, scrambled non-words included. " +
    "Untick the box above the plot to compare real words only. " +
    (hits.length
      ? `Then the GEE puts ${list(hits)}. `
      : "Then nothing at Cz is significant either. ") +
    (nonwordHits.length
      ? `The scrambled non-words also differ between lists (${list(nonwordHits)}), which they should not if meaning were all that mattered, so some of this may come from the word lists rather than the categories. `
      : "") +
    "I treat these as exploratory, since they are not the tests in our report.";
}

function setupErp() {
  const presets = $("#presets");
  for (const w of PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = w;
    b.dataset.preset = w;
    b.setAttribute("aria-pressed", String(state.window.preset === w));
    b.addEventListener("click", () => setWindow({ preset: w }));
    presets.appendChild(b);
  }
  $("#erp-controls").addEventListener("change", (e) => {
    const f = e.currentTarget;
    state.test = f.elements.test.value;
    state.block = f.elements.block.value;
    state.pool = f.elements.pool.checked;
    $("#cz-options").disabled = state.test !== "cz";
    drawErp();
    drawFits();
  });
  responsive($("#erp"), drawErp);

  // Drag across the plot to choose a window, snapped to the 25 ms bins.
  // Handlers live on the container because drawErp replaces the SVG.
  const erp = $("#erp");
  const snap = (clientX) => {
    const { start, width: bw, count } = state.eeg.meta.bins;
    const ms = state.erpX.invert(clientX - erp.getBoundingClientRect().left);
    return Math.min(start + count * bw, Math.max(start, Math.round((ms - start) / bw) * bw));
  };
  let anchor = null;
  erp.addEventListener("pointerdown", (e) => {
    if (!state.eeg) return;
    anchor = snap(e.clientX);
    erp.setPointerCapture(e.pointerId);
  });
  erp.addEventListener("pointermove", (e) => {
    if (anchor === null) return;
    const now = snap(e.clientX);
    const w = state.window;
    if (now === anchor || (w.from === Math.min(anchor, now) && w.to === Math.max(anchor, now))) return;
    setWindow({ from: Math.min(anchor, now), to: Math.max(anchor, now) });
  });
  const release = () => { anchor = null; };
  erp.addEventListener("pointerup", release);
  erp.addEventListener("pointercancel", release);
  responsive($("#ci"), drawFits);
}

/* ---------- start ---------- */

async function main() {
  setupTask();
  setupErp();
  responsive($("#scatter-moral"), drawScatters);

  const behavior = await (await fetch(dataUrl("behavior.json"))).json();
  state.behavior = behavior;
  drawScatters();
  behaviorText();
  sampleText();

  const [meta, buf] = await Promise.all([
    fetch(dataUrl("eeg.json")).then((r) => r.json()),
    fetch(dataUrl("eeg.bin")).then((r) => r.arrayBuffer()),
  ]);
  state.eeg = decodeEeg(meta, buf);
  const size = document.querySelector('[data-live="data-size"]');
  if (size) size.textContent = `${((buf.byteLength + JSON.stringify(meta).length + JSON.stringify(behavior).length) / 1e6).toFixed(1)} MB`;
  drawErp();
  drawFits();
  allTestsTable();
}

main().catch((err) => {
  console.error(err);
  const p = $("#behavior-text");
  p.textContent = `The data did not load (${err.message}). If you opened index.html from disk, run a local server instead; see the README.`;
});
