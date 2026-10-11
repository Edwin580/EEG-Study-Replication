// Decode the files written by tools/build_site_data.py and turn them into
// per-subject clusters for stats.js.

export function decodeEeg(meta, buffer) {
  const G = meta.groups.length;
  const L = meta.erp.length;
  const B = meta.bins.count;
  const T = (B * (B + 1)) / 2;
  let offset = 0;
  const erp = new Int16Array(buffer, offset, G * L); offset += G * L * 2;
  const binSums = new Float32Array(buffer, offset, G * B); offset += G * B * 4;
  const binMoments = new Float32Array(buffer, offset, G * T); offset += G * T * 4;
  if (offset !== buffer.byteLength) throw new Error("eeg.bin does not match eeg.json");
  const index = new Map();
  meta.groups.forEach(([subject, wordType, isWord, electrode], i) => {
    index.set(key(subject, wordType, isWord, electrode), i);
  });
  return { meta, erp, binSums, binMoments, index, G, L, B, T };
}

function key(subject, wordType, isWord, electrode) {
  return `${subject}|${wordType}|${isWord}|${electrode}`;
}

// Offset of (row, col) in a row-major upper triangle, row <= col
function tri(B, row, col) {
  return row * B - (row * (row - 1)) / 2 + (col - row);
}

/**
 * n, sum and sum of squares of the per-trial mean voltage in a window.
 * window is either { preset: "P2" } (exact sample means, inclusive ends, as
 * in the R code) or { from, to } in ms on the 25 ms bin grid, [from, to).
 */
export function windowStats(eeg, g, window) {
  const n = eeg.meta.groups[g][4];
  if (window.preset) {
    const [s, q] = eeg.meta.presetSums[g][window.preset];
    return { n, s, q };
  }
  const { start, width, samples } = eeg.meta.bins;
  const k0 = Math.round((window.from - start) / width);
  const k1 = Math.round((window.to - start) / width);
  if (k0 < 0 || k1 > eeg.B || k1 <= k0) throw new Error(`bad window ${window.from}-${window.to}`);
  let m = 0;
  for (let k = k0; k < k1; k++) m += samples[k];
  const sums = eeg.binSums.subarray(g * eeg.B, (g + 1) * eeg.B);
  const mom = eeg.binMoments.subarray(g * eeg.T, (g + 1) * eeg.T);
  let s = 0, q = 0;
  for (let k = k0; k < k1; k++) {
    s += sums[k];
    q += mom[tri(eeg.B, k, k)];
    for (let l = k + 1; l < k1; l++) q += 2 * mom[tri(eeg.B, k, l)];
  }
  return { n, s: s / m, q: q / (m * m) };
}

function addStats(a, b) {
  return { n: a.n + b.n, s: a.s + b.s, q: a.q + b.q };
}

const EMPTY = { n: 0, s: 0, q: 0 };

/**
 * One cluster per subject. level0 and level1 are lists of [wordType, isWord]
 * conditions that are pooled into each level.
 */
export function eegClusters(eeg, { electrode, level0, level1 }, window) {
  return eeg.meta.subjects.map((subject) => {
    const pool = (conds) => conds.reduce((acc, [wt, isWord]) => {
      const g = eeg.index.get(key(subject, wt, isWord, electrode));
      return g === undefined ? acc : addStats(acc, windowStats(eeg, g, window));
    }, EMPTY);
    return { subject, g0: pool(level0), g1: pool(level1) };
  });
}

/** Behavioral clusters: cells are "wordType|word" keys, counts are [n, correct]. */
export function behaviorClusters(behavior, level0, level1) {
  return behavior.subjects.map((subject) => {
    const pool = (cells) => cells.reduce((acc, c) => {
      const [n, k] = behavior.cells[subject][c];
      return { n: acc.n + n, s: acc.s + k, q: acc.q + k };
    }, EMPTY);
    return { subject, g0: pool(level0), g1: pool(level1) };
  });
}

/** Grand average ERP (trial weighted, as in the R plot) and between-subject SE. */
export function erpSummary(eeg, conds, electrode) {
  const { L } = eeg;
  const total = new Float64Array(L);
  const perSubject = [];
  let trials = 0;
  for (const subject of eeg.meta.subjects) {
    const subj = new Float64Array(L);
    let n = 0;
    for (const [wt, isWord] of conds) {
      const g = eeg.index.get(key(subject, wt, isWord, electrode));
      if (g === undefined) continue;
      const ng = eeg.meta.groups[g][4];
      const row = eeg.erp.subarray(g * L, (g + 1) * L);
      for (let i = 0; i < L; i++) subj[i] += row[i] * eeg.meta.erp.scale * ng;
      n += ng;
    }
    if (!n) continue;
    for (let i = 0; i < L; i++) { total[i] += subj[i]; subj[i] /= n; }
    trials += n;
    perSubject.push(subj);
  }
  const mean = Array.from(total, (v) => v / trials);
  const S = perSubject.length;
  const se = mean.map((_, i) => {
    let m = 0;
    for (const s of perSubject) m += s[i];
    m /= S;
    let v = 0;
    for (const s of perSubject) v += (s[i] - m) ** 2;
    return Math.sqrt(v / (S - 1) / S);
  });
  const t = Array.from({ length: L }, (_, i) => eeg.meta.erp.t0 + i * eeg.meta.erp.step);
  return { t, mean, se, trials, subjects: S };
}

export function proportion(behavior, subject, cells) {
  let n = 0, k = 0;
  for (const c of cells) { n += behavior.cells[subject][c][0]; k += behavior.cells[subject][c][1]; }
  return k / n;
}
