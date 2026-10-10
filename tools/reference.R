# Reference GEE results from the R package gee, used by test/stats.test.mjs
# to check the JavaScript port in site/js/stats.js.
#
# Usage: Rscript tools/reference.R data test/fixtures/r_reference.json

suppressMessages({
  library(dplyr)
  library(readr)
  library(gee)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data"
out_file <- if (length(args) >= 2) args[2] else "test/fixtures/r_reference.json"

behavioral <- read_csv(file.path(data_dir, "behavioral.csv"),
                       col_types = cols(subject_id = col_character()))
eeg <- read_csv(file.path(data_dir, "eeg.csv"), col_types = cols(subject = col_character()))

# Same exclusions as This.qmd
resp <- filter(behavioral, task == "response")
excluded <- unique(c(
  "34",
  resp %>% filter(phase == "fashion") %>% count(subject_id) %>% filter(n == 600) %>% pull(subject_id),
  resp %>% filter(is.na(rt)) %>% count(subject_id) %>% filter(n > 300) %>% pull(subject_id),
  resp %>% filter(is_word != correct) %>% count(subject_id) %>% filter(n >= 540) %>% pull(subject_id)))

fit <- function(formula, data, family) {
  m <- suppressMessages(gee(formula, id = subject, data = data, family = family,
                            corstr = "exchangeable", silent = TRUE))
  cf <- summary(m)$coefficients
  list(estimate = cf[2, "Estimate"], se = cf[2, "Robust S.E."], z = cf[2, "Robust z"],
       alpha = m$working.correlation[1, 2])
}

results <- list()

# Behavioral: correct ~ word_category, words only, one block at a time
beh <- resp %>%
  filter(word_type != "practice", !(subject_id %in% excluded), is_word) %>%
  mutate(correct = if_else(subject_id == "01", !correct, correct),
         correct = if_else(subject_id == "36" & phase == "moral", !correct, correct),
         word_category = if_else(word_type %in% c("fashion", "moral"), "category", "non-category")) %>%
  rename(subject = subject_id) %>%
  arrange(subject)
for (which_phase in c("moral", "fashion")) {
  results[[length(results) + 1]] <- c(
    list(kind = "behavior", block = which_phase),
    fit(correct ~ word_category, filter(beh, phase == which_phase), binomial))
}

# EEG: per-trial window means
eeg <- eeg %>% filter(word_type != "practice", !(subject %in% excluded))

tests <- list(
  list(name = "pz-moral", electrode = "Pz", types = "moral", predictor = "is_word"),
  list(name = "pz-fashion", electrode = "Pz", types = "fashion", predictor = "is_word"),
  list(name = "cz-moral", electrode = "Cz", types = c("moral", "non-moral"), predictor = "word_type"),
  list(name = "cz-fashion", electrode = "Cz", types = c("fashion", "non-fashion"), predictor = "word_type"))

presets <- list(P2 = c(200, 250), N2 = c(250, 350), P3 = c(350, 600), LPP = c(600, 800))
binned <- list(c(300, 400), c(125, 275), c(0, 1000), c(575, 600))

window_means <- function(test, keep) {
  eeg %>%
    filter(electrode == test$electrode, word_type %in% test$types, keep(t)) %>%
    group_by(subject, event_id, is_word, word_type) %>%
    summarize(y = mean(v), .groups = "drop")
}

for (test in tests) {
  f <- reformulate(test$predictor, "y")
  for (w in names(presets)) {
    win <- presets[[w]]
    d <- window_means(test, function(t) t >= win[1] & t <= win[2])
    # Fixed analysis: rows sorted by subject
    results[[length(results) + 1]] <- c(
      list(kind = "eeg", test = test$name, window = w, order = "subject"),
      fit(f, arrange(d, subject), gaussian))
    # Original analysis: rows in event_id order, as summarize() left them
    results[[length(results) + 1]] <- c(
      list(kind = "eeg", test = test$name, window = w, order = "event_id"),
      fit(f, arrange(d, event_id, subject), gaussian))
  }
  for (win in binned) {
    d <- window_means(test, function(t) t >= win[1] & t < win[2])
    results[[length(results) + 1]] <- c(
      list(kind = "eeg", test = test$name, from = win[1], to = win[2], order = "subject"),
      fit(f, arrange(d, subject), gaussian))
    results[[length(results) + 1]] <- c(
      list(kind = "eeg", test = test$name, from = win[1], to = win[2], order = "event_id"),
      fit(f, arrange(d, event_id, subject), gaussian))
  }
}

dir.create(dirname(out_file), showWarnings = FALSE, recursive = TRUE)
write_json(list(gee_version = as.character(packageVersion("gee")), results = results),
           out_file, auto_unbox = TRUE, digits = NA, pretty = TRUE)
cat("wrote", length(results), "reference fits to", out_file, "\n")
