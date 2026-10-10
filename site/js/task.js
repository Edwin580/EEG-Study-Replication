// A short browser version of the masked lexical decision task.
//
// Trial structure follows the study protocol: fixation 400 to 700 ms, the
// letter string, a 33 ms fixation, an ampersand mask for 25 ms, then up to
// 1500 ms to answer. Display changes are made inside requestAnimationFrame so
// the word stays up for a whole number of screen refreshes, and the time
// between the frame that showed it and the frame that hid it is recorded.

export const WORD_TYPES = ["moral", "non-moral", "fashion", "non-fashion"];

/** Median frame interval in ms, from a short run of animation frames. */
export function measureFrameInterval(frames = 40) {
  return new Promise((resolve) => {
    const stamps = [];
    const tick = (t) => {
      stamps.push(t);
      if (stamps.length <= frames) requestAnimationFrame(tick);
      else {
        const d = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
        resolve(d[Math.floor(d.length / 2)]);
      }
    };
    requestAnimationFrame(tick);
  });
}

/** Frames needed to cover ms, at least one. */
export function framesFor(ms, frameMs) {
  return Math.max(1, Math.round(ms / frameMs));
}

function shuffle(a, rand) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Pick perType words and perType non-words from each word type, shuffled. */
export function makeTrials(stimuli, perType = 5, rand = Math.random) {
  const trials = [];
  for (const wt of WORD_TYPES) {
    for (const w of shuffle(stimuli[wt].words, rand).slice(0, perType)) trials.push({ wordType: wt, isWord: true, text: w });
    for (const w of shuffle(stimuli[wt].nonwords, rand).slice(0, perType)) trials.push({ wordType: wt, isWord: false, text: w });
  }
  return shuffle(trials, rand);
}

/** Accuracy per word type and lexicality from a list of finished trials. */
export function summarize(results) {
  const out = {};
  for (const wt of WORD_TYPES) {
    for (const isWord of [true, false]) {
      const r = results.filter((x) => x.wordType === wt && x.isWord === isWord);
      out[`${wt}|${isWord ? "word" : "nonword"}`] = { n: r.length, correct: r.filter((x) => x.correct).length };
    }
  }
  const shown = results.map((r) => r.shownMs).filter((v) => v > 0).sort((a, b) => a - b);
  out.shownMs = shown.length ? { median: shown[Math.floor(shown.length / 2)], min: shown[0], max: shown.at(-1) } : null;
  return out;
}

/**
 * Run the task in `stage` (an element with a child .stimulus).
 * Returns a controller with respond(isWord) and stop().
 */
export function runTask({ stage, trials, frameMs, exposureMs, onProgress, onDone }) {
  const text = stage.querySelector(".stimulus");
  const stimFrames = framesFor(exposureMs, frameMs);
  const postFrames = framesFor(33.3, frameMs);
  const maskFrames = framesFor(25, frameMs);
  const results = [];
  let i = 0, phase = "idle", phaseEnd = 0, framesLeft = 0, shownAt = 0, shownMs = 0, answerFrom = 0;
  let stopped = false, rafId = 0;

  const show = (s) => { text.textContent = s; };

  function startTrial(now) {
    phase = "fixation";
    show("+");
    phaseEnd = now + 400 + Math.random() * 300;
  }

  function finishTrial(answer, rt) {
    const t = trials[i];
    results.push({ ...t, answer, correct: answer === t.isWord, rt, shownMs });
    i++;
    onProgress?.(i, trials.length, results);
    if (i >= trials.length) return end();
    phase = "gap";
    show("");
    phaseEnd = performance.now() + 300;
  }

  function end() {
    stopped = true;
    cancelAnimationFrame(rafId);
    show("");
    phase = "done";
    onDone?.(results);
  }

  function frame(now) {
    if (stopped) return;
    switch (phase) {
      case "idle":
        startTrial(now);
        break;
      case "gap":
        if (now >= phaseEnd) startTrial(now);
        break;
      case "fixation":
        if (now >= phaseEnd) {
          phase = "stimulus";
          show(trials[i].text);
          shownAt = now;
          framesLeft = stimFrames;
        }
        break;
      case "stimulus":
        if (--framesLeft <= 0) {
          shownMs = now - shownAt;
          phase = "post";
          show("+");
          framesLeft = postFrames;
        }
        break;
      case "post":
        if (--framesLeft <= 0) {
          phase = "mask";
          show("&".repeat(trials[i].text.length));
          framesLeft = maskFrames;
          answerFrom = now;
        }
        break;
      case "mask":
        if (--framesLeft <= 0) {
          phase = "respond";
          show("");
          phaseEnd = now + 1500;
        }
        break;
      case "respond":
        if (now >= phaseEnd) finishTrial(null, null);
        break;
    }
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return {
    respond(isWord) {
      if (phase === "mask" || phase === "respond") finishTrial(isWord, performance.now() - answerFrom);
    },
    stop() { if (!stopped) end(); },
    get frames() { return { stimulus: stimFrames, post: postFrames, mask: maskFrames }; },
  };
}
