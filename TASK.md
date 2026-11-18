You are improving an existing make.fun bounty entry. Work in the current directory
(`~/makefun/entry-gta6`). There is already a working `main.ts` here. Read it first, then make the
change described below, narrating briefly before each step.

## The bounty

`gta6-twitch-ccu-forecast-01`: forecast, hour by hour, how many people watch Grand Theft Auto VI
live on Twitch over the 24 UTC hours of its release day, 2026-11-19, from the first hour's count.
The score is the mean pinball loss on the log scale over every hour and every quantile level
(0.05, 0.25, 0.5, 0.75, 0.95) — lower is better.

## The problem to fix

The entry was graded on the practice and scored:
- pinball loss 0.391078 (the house baseline scores 0.387 — we do not beat it yet)
- 90% coverage 0.652 (an honest forecast covers about 0.9)

So the forecast's **median shape is good but the quantile band is too narrow**: only 65% of hours
land inside the 5%–95% band, when about 90% should. A too-narrow band pays at every hour that falls
outside it, which is why the loss sits at the baseline.

## The fix

In `main.ts`, the spread of each hour's band is computed as half the p16-to-p84 gap of the
comparables' log-ratios. That gap understates the true launch-day spread. Multiply it by about
**1.76** so the 90% band covers about 0.9 of the hours. Concretely:

- Add a named constant near the other constants, e.g.
  `const SPREAD_MULT = 1.76;` with a one-line comment saying it widens the p16-p84 gap to an honest
  90% band (the raw gap covered only ~0.65 on the practice).
- In the branch that computes `spread` from the p16-p84 gap, multiply the result by `SPREAD_MULT`
  (keep the existing 0.2 floor). Leave the fallback branch (fewer than 5 ratios) as it is.

Do not change anything else: the size filter (hour-1 at least 50,000), the median center, the
output format, and the quantile levels all stay exactly as they are.

## Verify before you finish

Run it on the practice cases:

```
mkdir -p out
MAKEFUN_INPUT_DIR=~/makefun/kits/gta6-twitch-ccu-forecast-01/gta6-twitch-ccu-forecast-01-kit/input \
MAKEFUN_OUTPUT_DIR=out node main.ts
```

Then confirm: 23 rows per file, hours 2..24, five non-decreasing positive quantiles each, and that
the hour-24 band is visibly wider than before (its 95% quantile should be roughly 4x the hour-1
count, not ~2.5x). Run it twice into two directories and confirm byte-identical output.

Update `README.md`'s model section to mention the spread widening (the p16-p84 gap is scaled by
1.76 to give an honest 90% band).

Do not commit, do not push, do not create a repository — just write the files.
