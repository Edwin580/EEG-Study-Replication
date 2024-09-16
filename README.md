# EEG-Study-Replication
This is a replication of Gantman et al (2020).

# Moral Pop-Out Effect Replication Study

This repository contains the data analysis and results for a replication study of the moral pop-out effect, based on the work by Gantman et al. (2020).

## Project Overview

This study aims to replicate and extend the findings of Gantman et al. (2020) on the moral pop-out effect. We included an additional category of fashion words to control for potential confounds and assess the specificity of the effect to moral content.

## Contents

1. `This.qmd`: The main Quarto document containing the full report, including introduction, methods, results, and discussion.
2. `This.html`: The rendered HTML output of the Quarto document.
3. `data/`: Directory containing the raw data files:
   - `behavioral.csv`: Behavioral data from the experiment
   - `eeg.csv`: EEG data from the experiment

## Key Findings

- Partial replication of the moral pop-out effect
- Evidence of a pop-out effect for fashion words in behavioral data
- ERP results show differences between moral and non-moral words in P2, N2, and P3 components

## Data Analysis

The analysis was performed using R. Key packages used include:

- dplyr
- ggplot2
- gee
- patchwork

## Reproduction

To reproduce the analysis:

1. Ensure you have R and the required packages installed.
2. Run the `This.qmd` file in RStudio or using Quarto CLI.

## References

1. Firestone, C. & Scholl, B. (2015). Enhanced visual awareness for morality and pajamas? Perception vs. memory in 'top-down' effects. Cognition, 136, 409-416.
2. Gantman, A., Devraj-Kizuk, S., Mende-Siedlecki, P., Van Bavel, J., & Mathewson, K. (2020). The time course of moral perception: an ERP investigation of the moral pop-out effect. Social Cognitive and Affective Neuroscience, 15(2), 235-246.

## Contact

For questions or further information, please contact Edwin Cortazo / edwincortazo@gmail.com
