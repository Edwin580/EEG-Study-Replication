# Does morality pop out?

An EEG replication of Gantman et al. (2020) on the moral pop-out effect, run at Vassar College. We added fashion words as a control, following Firestone and Scholl (2015), to test whether any repeated category pops out the same way.

**Try it: https://edwin580.github.io/EEG-Study-Replication/**

On the page you can:

- do a one minute version of the masked word task in your browser, with a control for how long the word is shown
- see your result next to the 34 participants
- drag a time window across the grand average ERPs and watch the statistics refit
- compare the published statistics with corrected ones (see "The bug" below)

Everything runs in the browser from the study's preprocessed data. There is no server and no sign up, and task answers are not stored or sent anywhere.

The full write-up is in [This.qmd](This.qmd), rendered as [docs/This.html](docs/This.html) ([online](https://edwin580.github.io/EEG-Study-Replication/This.html)).

## Results in short

- Behavior: accuracy was higher for fashion words than for non-fashion words (p < .001). It was not higher for moral words than for non-moral words (p = .099).
- EEG at Pz: words and non-words differ in the P2, N2 and P3 windows for moral words and in the P3 window for fashion words.
- EEG at Cz, the pop-out test as originally coded: no difference for either category in any window.
- Our participants were about 90% accurate, against about 70% in the original study. We later found the words were on screen longer than in the original procedure.

## Running it locally

The page is static files in `docs/` with no build step. The browser will not load the data from `file://`, so serve the folder:

```
python3 -m http.server 8000 --directory docs
# open http://localhost:8000/
```

Tests for the JavaScript statistics use Node's built-in test runner (Node 18 or later, no packages to install):

```
npm test
```

### Rebuilding the data and the report

The raw data is on OSF at https://osf.io/ngtha/ (`behavioral.csv`, 15 MB, and `eeg.csv`, 1.5 GB). Put both in `data/`.

```
pip install -r tools/requirements.txt
python3 tools/build_site_data.py data docs/site/data            # page data, 2.3 MB
Rscript tools/reference.R data test/fixtures/r_reference.json   # reference fits for the tests
quarto render This.qmd                                          # the report
rm -rf docs/This_files && mv This.html This_files docs/
```

Don't use `quarto render --output-dir docs`; it clears the rest of `docs/`.

The R code needs `dplyr`, `readr`, `tidyr`, `ggplot2`, `patchwork`, `gee` and `jsonlite`. `This.qmd` downloads the data with `osfr` if `data/` is empty. Versions used here: R 4.3.3, gee 4.13-26, dplyr 1.1.4, Quarto 1.5.57, Python 3.13, pandas 3.0.5, numpy 2.5.3.

## Technical notes

### The bug

R's `gee()` treats rows as one cluster only if they are next to each other in the data frame. Its manual says it "will interpret physically contiguous records possessing the same value of id as members of the same cluster." The original EEG code built each model's data with `group_by(event_id, subject, ...) %>% summarize(...)`, which sorts by trial number. So every row came from a different participant than the row before it, and `gee()` fit about 5,000 one-trial clusters instead of 34 participants. The "robust" standard errors were then plain HC0 errors from trial-level OLS, which ignore that trials from one person are correlated. The published numbers match that fit to every printed digit.

The fix is to sort by subject before fitting ([This.qmd](This.qmd), `fit_gee`). One conclusion changes: the fashion word versus non-word N2 effect at Pz goes from p = .027 to p = .057. The rest of the report's text now matches its numbers too. In a few places the old text did not, for example calling the fashion behavioral effect "not statistically significant" at p < .001.

Other fixes in `This.qmd`:

- the participant count used `max(subject_id)` (46) instead of the number of sessions (42)
- accuracies were printed as proportions with a % sign
- Figure 1 paired points by row order instead of by subject
- figure captions described error bars and shading that were not drawn

### Refitting in the browser

With one 0/1 predictor, everything the GEE needs from a participant is the count, sum and sum of squares of the outcome in each condition. For an arbitrary EEG window, the sum of squares of the window means also needs the cross products between time bins. [tools/build_site_data.py](tools/build_site_data.py) stores those moments for 25 ms bins, plus exact sums for the four analysis windows, which brings 1.5 GB down to 2.3 MB.

[docs/site/js/stats.js](docs/site/js/stats.js) follows `ugee.c` from the `gee` package with its defaults: start from the `glm` fit, moment estimates of scale and exchangeable correlation with the `v4.4compat = FALSE` denominators, tolerance 0.001, at most 25 iterations, and the sandwich variance at the final estimate. [tools/reference.R](tools/reference.R) fits 66 models with the real package, and [test/stats.test.mjs](test/stats.test.mjs) checks the port against them. The agreement is about 1e-12 relative on the analysis windows and 2e-7 on binned windows (float32 moments). One fit takes about 0.35 ms.

### Timing in the task

[docs/site/js/task.js](docs/site/js/task.js) makes every display change inside `requestAnimationFrame`. It counts frames for the brief events and records how long each word was actually up. A browser is not a lab display, so the page reports the measured durations and the frame rate rather than claiming exact timing.

### Layout

The page is styled like a plain department research page: a masthead, a link bar, Verdana text with Georgia headings and notes in boxes beside the text, all in system fonts. Charts are hand-written SVG. There are no runtime dependencies.

## Repository

```
docs/                  everything GitHub Pages serves
  index.html           the web page
  site/                page styles, scripts and data
  This.html            the rendered report
This.qmd               the report source
tools/                 data build script and R reference fits
test/                  Node tests for the statistics port
```

## References

- de Leeuw, J. R. (2015). jsPsych: A JavaScript library for creating behavioral experiments in a Web browser. *Behavior Research Methods*, 47, 1-12. https://doi.org/10.3758/s13428-014-0458-y
- Firestone, C., & Scholl, B. J. (2015). Enhanced visual awareness for morality and pajamas? Perception vs. memory in 'top-down' effects. *Cognition*, 136, 409-416. https://doi.org/10.1016/j.cognition.2014.10.014
- Gantman, A. P., & Van Bavel, J. J. (2014). The moral pop-out effect: Enhanced perceptual awareness of morally relevant stimuli. *Cognition*, 132, 22-29. https://doi.org/10.1016/j.cognition.2014.02.007
- Gantman, A., Devraj-Kizuk, S., Mende-Siedlecki, P., Van Bavel, J. J., & Mathewson, K. E. (2020). The time course of moral perception: An ERP investigation of the moral pop-out effect. *Social Cognitive and Affective Neuroscience*, 15(2), 235-246. https://doi.org/10.1093/scan/nsaa030
- Liang, K.-Y., & Zeger, S. L. (1986). Longitudinal data analysis using generalized linear models. *Biometrika*, 73(1), 13-22. https://doi.org/10.1093/biomet/73.1.13

## Contact

Edwin Cortazo, edwincortazo@gmail.com
