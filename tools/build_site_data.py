"""Build the small data files the web page loads.

Reads the preprocessed OSF data (https://osf.io/ngtha/) and writes:

  site/data/behavior.json  per-subject accuracy counts, exclusions, stimuli
  site/data/eeg.json       metadata plus exact window sums for the four
                           analysis windows used in This.qmd
  site/data/eeg.bin        per-condition ERPs and 25 ms bin moments

The exclusion rules and key-flip corrections follow This.qmd.

Usage: python3 tools/build_site_data.py data/ site/data/
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

WORD_TYPES = ["moral", "non-moral", "fashion", "non-fashion"]
ELECTRODES = ["Pz", "Cz"]
# Analysis windows from This.qmd. Both ends inclusive, as in the R code.
PRESETS = {"P2": (200, 250), "N2": (250, 350), "P3": (350, 600), "LPP": (600, 800)}
BIN_MS = 25
BIN_START, BIN_END = 0, 1000          # bins cover [0, 1000) ms
ERP_STEP = 4                          # ms between plotted ERP samples
ERP_SCALE = 0.01                      # int16 units in microvolts


def as_bool(s):
    return s.map({"TRUE": True, "FALSE": False, True: True, False: False})


def load_behavior(path):
    b = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=["NA"])
    b["is_word"] = as_bool(b["is_word"])
    b["correct"] = as_bool(b["correct"])
    b["rt"] = pd.to_numeric(b["rt"])
    return b


def exclusions(b):
    resp = b[b.task == "response"]
    double_fashion = resp[resp.phase == "fashion"].groupby("subject_id").size()
    no_response = resp[resp.rt.isna()].groupby("subject_id").size()
    said_nonword = resp[resp.is_word.notna() & resp.correct.notna()
                        & (resp.is_word != resp.correct)].groupby("subject_id").size()
    reasons = {}
    for s in double_fashion[double_fashion == 600].index:
        reasons[s] = "saw the fashion block twice"
    for s in no_response[no_response > 300].index:
        reasons.setdefault(s, "no response on over half the trials")
    for s in said_nonword[said_nonword >= 540].index:
        reasons.setdefault(s, "answered non-word on 90% of trials or more")
    reasons.setdefault("34", "poor EEG recording")
    return reasons


def fix_keys(df, subject_col, block_col):
    # Subject 01 had the response keys swapped all session, 36 in the moral block
    flip = (df[subject_col] == "01") | ((df[subject_col] == "36") & (df[block_col] == "moral"))
    df.loc[flip, "correct"] = ~df.loc[flip, "correct"].astype(bool)
    return df


def build_behavior(b, excluded):
    subjects = sorted(b.subject_id.unique())
    resp = b[(b.task == "response") & (b.word_type != "practice")].copy()
    resp = fix_keys(resp, "subject_id", "phase")
    kept = [s for s in subjects if s not in excluded]

    cells = {}
    for s in kept:
        d = resp[resp.subject_id == s]
        cells[s] = {}
        for wt in WORD_TYPES:
            for isw in (True, False):
                x = d[(d.word_type == wt) & (d.is_word == isw)].correct
                cells[s][f"{wt}|{'word' if isw else 'nonword'}"] = [int(len(x)), int(x.sum())]

    stimuli = {}
    for wt in WORD_TYPES:
        d = resp[resp.word_type == wt]
        stimuli[wt] = {
            "words": sorted(d[d.is_word == True].word.unique().tolist()),
            "nonwords": sorted(d[d.is_word == False].word.unique().tolist()),
        }

    return {
        "source": "https://osf.io/ngtha/ behavioral.csv",
        "sessions": subjects,
        "excluded": {s: excluded[s] for s in sorted(excluded) if s in subjects},
        "subjects": kept,
        "cells": cells,
        "stimuli": stimuli,
    }


def build_eeg(path, kept):
    e = pd.read_csv(path, dtype={"event_id": "int32", "t": "int16", "word_type": str,
                                 "is_word": str, "correct": str, "electrode": str,
                                 "v": "float64", "subject": str})
    e = e[(e.word_type != "practice") & e.subject.isin(kept)]
    e = e.sort_values(["subject", "event_id", "electrode", "t"], kind="stable")
    times = np.sort(e.t.unique())
    nt = len(times)
    v = e.v.to_numpy().reshape(-1, nt)                     # one row per trial and electrode
    meta = e.iloc[::nt][["subject", "event_id", "electrode", "word_type", "is_word"]].reset_index(drop=True)
    assert (e.t.to_numpy().reshape(-1, nt) == times).all()

    preset_idx = {k: (times >= a) & (times <= b) for k, (a, b) in PRESETS.items()}
    preset_mean = {k: v[:, m].mean(axis=1) for k, m in preset_idx.items()}

    edges = np.arange(BIN_START, BIN_END + BIN_MS, BIN_MS)
    bin_of = np.searchsorted(edges, times, side="right") - 1
    in_bins = (times >= BIN_START) & (times < BIN_END)
    nbins = len(edges) - 1
    bin_counts = np.array([int(((bin_of == k) & in_bins).sum()) for k in range(nbins)])
    bin_sums = np.stack([v[:, (bin_of == k) & in_bins].sum(axis=1) for k in range(nbins)], axis=1)

    erp_t = np.arange(times[0], times[-1] + 1, ERP_STEP)
    erp_cols = np.searchsorted(times, erp_t)
    iu = np.triu_indices(nbins)

    groups, presets, erp, bin_s, bin_m = [], [], [], [], []
    for s in kept:
        for wt in WORD_TYPES:
            for isw in ("TRUE", "FALSE"):
                for el in ELECTRODES:
                    m = ((meta.subject == s) & (meta.word_type == wt)
                         & (meta.is_word == isw) & (meta.electrode == el)).to_numpy()
                    n = int(m.sum())
                    groups.append([s, wt, isw == "TRUE", el, n])
                    presets.append({k: [float(preset_mean[k][m].sum()), float((preset_mean[k][m] ** 2).sum())]
                                    for k in PRESETS})
                    erp.append(v[m][:, erp_cols].mean(axis=0) if n else np.zeros(len(erp_t)))
                    x = bin_sums[m]
                    bin_s.append(x.sum(axis=0))
                    bin_m.append((x.T @ x)[iu])

    erp = np.array(erp)
    assert np.abs(erp).max() / ERP_SCALE < 32767
    erp_i16 = np.round(erp / ERP_SCALE).astype("<i2")
    bin_s = np.array(bin_s, dtype="<f4")
    bin_m = np.array(bin_m, dtype="<f4")

    meta_out = {
        "source": "https://osf.io/ngtha/ eeg.csv",
        "subjects": kept,
        "groups": groups,                    # [subject, word_type, is_word, electrode, trials]
        "presets": {k: list(w) for k, w in PRESETS.items()},
        "presetSums": presets,               # per group: window -> [sum of trial means, sum of squares]
        "erp": {"t0": int(erp_t[0]), "step": ERP_STEP, "length": len(erp_t), "scale": ERP_SCALE},
        "bins": {"start": BIN_START, "width": BIN_MS, "count": nbins, "samples": bin_counts.tolist()},
        "layout": ["erp int16 [groups x erp.length]",
                   "binSums float32 [groups x bins.count]",
                   "binMoments float32 [groups x bins.count*(bins.count+1)/2], upper triangle row-major"],
    }
    return meta_out, erp_i16.tobytes() + bin_s.tobytes() + bin_m.tobytes()


def main(data_dir, out_dir):
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    b = load_behavior(data_dir / "behavioral.csv")
    excluded = exclusions(b)
    behavior = build_behavior(b, excluded)
    (out_dir / "behavior.json").write_text(json.dumps(behavior, separators=(",", ":")))
    meta, blob = build_eeg(data_dir / "eeg.csv", behavior["subjects"])
    (out_dir / "eeg.json").write_text(json.dumps(meta, separators=(",", ":")))
    (out_dir / "eeg.bin").write_bytes(blob)
    print(f"{len(behavior['subjects'])} subjects kept, {len(excluded)} excluded")
    print(f"eeg.bin {len(blob) / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data", sys.argv[2] if len(sys.argv) > 2 else "site/data")
