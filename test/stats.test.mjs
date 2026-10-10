// Checks the JavaScript GEE against fits from the R package gee.
// Fixture: tools/reference.R. Data: tools/build_site_data.py.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gee, erfc, twoSidedP } from "../site/js/stats.js";
import { decodeEeg, eegClusters, behaviorClusters, windowStats, erpSummary } from "../site/js/data.js";

const read = (p) => readFileSync(new URL(p, import.meta.url));
const reference = JSON.parse(read("./fixtures/r_reference.json"));
const behavior = JSON.parse(read("../site/data/behavior.json"));
const meta = JSON.parse(read("../site/data/eeg.json"));
const bin = read("../site/data/eeg.bin");
const eeg = decodeEeg(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

// The R coding of each test: level 0 is R's reference level
const R_CODING = {
  "pz-moral": { electrode: "Pz", level0: [["moral", false]], level1: [["moral", true]] },
  "pz-fashion": { electrode: "Pz", level0: [["fashion", false]], level1: [["fashion", true]] },
  "cz-moral": {
    electrode: "Cz",
    level0: [["moral", true], ["moral", false]],
    level1: [["non-moral", true], ["non-moral", false]],
  },
  "cz-fashion": {
    electrode: "Cz",
    level0: [["fashion", true], ["fashion", false]],
    level1: [["non-fashion", true], ["non-fashion", false]],
  },
};

function close(actual, expected, rel, label) {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
  assert.ok(err < rel, `${label}: got ${actual}, R gave ${expected} (relative error ${err.toExponential(2)})`);
}

test("erfc matches known values", () => {
  close(erfc(0), 1, 1e-15, "erfc(0)");
  close(erfc(0.5), 0.4795001221869535, 1e-13, "erfc(0.5)");
  close(erfc(2.9), 4.10978e-05, 1e-5, "erfc(2.9)");
  close(erfc(3.5), 7.430983723414128e-07, 1e-12, "erfc(3.5)");
  close(erfc(-1), 1.8427007929497148, 1e-14, "erfc(-1)");
  close(twoSidedP(1.959963984540054), 0.05, 1e-12, "p at z = 1.96");
  close(twoSidedP(5.7212939), 1.0571585e-8, 1e-6, "p from the original report");
});

test("binned window stats reduce to preset-like sums", () => {
  // A window covering every bin must use every sample in [0, 1000)
  const g = 0;
  const all = windowStats(eeg, g, { from: 0, to: 1000 });
  assert.equal(all.n, meta.groups[g][4]);
  assert.ok(Number.isFinite(all.s) && all.q > 0);
  assert.throws(() => windowStats(eeg, g, { from: 300, to: 300 }));
});

test("behavioral GEE matches R gee (binomial, exchangeable)", () => {
  for (const r of reference.results.filter((x) => x.kind === "behavior")) {
    const cat = r.block, non = `non-${r.block}`;
    // R: word_category with "category" as reference level
    const fit = gee(behaviorClusters(behavior, [`${cat}|word`], [`${non}|word`]), "binomial");
    close(fit.estimate, r.estimate, 1e-6, `${r.block} estimate`);
    close(fit.se, r.se, 1e-6, `${r.block} SE`);
    close(fit.alpha, r.alpha, 1e-6, `${r.block} alpha`);
  }
});

test("EEG GEE matches R gee for the four analysis windows, rows sorted by subject", () => {
  const rows = reference.results.filter((x) => x.kind === "eeg" && x.window && x.order === "subject");
  assert.equal(rows.length, 16);
  for (const r of rows) {
    const fit = gee(eegClusters(eeg, R_CODING[r.test], { preset: r.window }), "gaussian");
    const label = `${r.test} ${r.window}`;
    close(fit.estimate, r.estimate, 1e-6, `${label} estimate`);
    close(fit.se, r.se, 1e-6, `${label} SE`);
    close(fit.alpha, r.alpha, 1e-6, `${label} alpha`);
  }
});

test("trialClusters reproduces the published (unsorted) numbers", () => {
  const rows = reference.results.filter((x) => x.kind === "eeg" && x.window && x.order === "event_id");
  assert.equal(rows.length, 16);
  for (const r of rows) {
    const fit = gee(eegClusters(eeg, R_CODING[r.test], { preset: r.window }), "gaussian", { trialClusters: true });
    const label = `${r.test} ${r.window} (event_id order)`;
    close(fit.estimate, r.estimate, 1e-6, `${label} estimate`);
    close(fit.se, r.se, 1e-6, `${label} SE`);
  }
});

test("EEG GEE matches R gee on arbitrary 25 ms bin windows", () => {
  const rows = reference.results.filter((x) => x.kind === "eeg" && x.from !== undefined);
  assert.equal(rows.length, 32);
  for (const r of rows) {
    const trialClusters = r.order === "event_id";
    const fit = gee(eegClusters(eeg, R_CODING[r.test], { from: r.from, to: r.to }), "gaussian", { trialClusters });
    const label = `${r.test} ${r.from}-${r.to} ${r.order}`;
    // float32 moments: agreement to about six significant digits
    close(fit.estimate, r.estimate, 1e-4, `${label} estimate`);
    close(fit.se, r.se, 1e-4, `${label} SE`);
  }
});

test("published report values are what the trial-cluster fit gives", () => {
  // Numbers printed in the original This.html (Pz, moral, P3 window)
  const fit = gee(eegClusters(eeg, R_CODING["pz-moral"], { preset: "P3" }), "gaussian", { trialClusters: true });
  close(fit.estimate, 2.8105816, 1e-7, "estimate");
  close(fit.se, 0.4912493, 1e-6, "SE");
  close(fit.p, 1.0571585e-8, 1e-5, "p");
  assert.equal(fit.clusters, 4981);
});

test("grand average ERP is finite and uses every included subject", () => {
  const s = erpSummary(eeg, [["moral", true]], "Pz");
  assert.equal(s.subjects, 34);
  assert.equal(s.t[0], -200);
  assert.equal(s.t.at(-1), 1000);
  assert.ok(s.mean.every(Number.isFinite) && s.se.every((v) => v >= 0));
});
