You are building an entry for a make.fun forecasting bounty. Work in the current directory
(`~/makefun/entry-gta6`). Write the program yourself, step by step, narrating briefly before each
step. Do not copy any file wholesale; author the code.

## The bounty

`gta6-twitch-ccu-forecast-01`: forecast, hour by hour, how many people watch Grand Theft Auto VI
live on Twitch over the 24 UTC hours of its release day, 2026-11-19, from the first hour's count.
Your program reads one case file and writes a forecast.

## What to build

A single file `main.ts` at the repository root (Node 22, standard library only, no network, no
installed packages). The grader runs it once per case as `node /bot/main.ts`:

- It reads every `*.in` file in `$MAKEFUN_INPUT_DIR` (default `/input`), in name order.
- For each, it writes `$MAKEFUN_OUTPUT_DIR/<id>.out` (default `/output`).
- Two runs on the same case must produce byte-identical output (no randomness, no time).

## The case file (schema `makefun/twitch-ccu-case/v1`)

JSON with these fields you need:

- `id` — the case id.
- `levels` — always `[0.05, 0.25, 0.5, 0.75, 0.95]`.
- `known` — one row `{hour: 1, viewers, ...}`: hour 1's count.
- `forecast` — 23 rows `{hour, from, until}` for hours 2..24.
- `comparables` — ~38 past big launches, each `{name, day_start, hourly: [{from, viewers, ...}]}`.
  Each comparable's `hourly` covers 14 days before its release day to 3 days after, one point an
  hour. `day_start` is the UTC midnight of its release day.

## The output format

`<id>.out` is UTF-8 JSON, exactly one key `hours`, a list of exactly 23 rows, hours 2..24 each once,
in any order, each exactly `{"hour": h, "q": [q05, q25, q50, q75, q95]}`: five quantiles of hour h's
count at the levels in that order, each a finite number > 0 and <= 1e9, non-decreasing.

## The model to implement

The score is the mean pinball loss on the log scale, so what matters is the launch-day **shape** in
log space, not its absolute size.

1. For each comparable, take its release-day curve: for each hourly point, hour = round((point_time -
   day_start) / 1h) + 1, keeping hours 1..24 with a positive viewer count. A usable comparable has at
   least 20 of the 24 hours and a positive hour-1 count.

2. Keep only the comparables that are real big launches: their hour-1 count must be at least 50000.
   A tiny launch's hour 1 is not a meaningful baseline and its early-hour ratios are wild. If fewer
   than 8 comparables clear that floor, fall back to using every usable comparable.

3. For each hour h = 2..24, collect the log-ratio `ln(viewers_h / viewers_1)` across the kept
   comparables. Sort them. The center is the median (the 0.5 quantile, by linear interpolation). The
   spread is half the p16-to-p84 gap: `(quantile(0.84) - quantile(0.16)) / 2`, floored at 0.2 so the
   band is never razor thin.

4. Write `q_tau = p1 * exp(center + z_tau * spread)` for the five levels, where `z_tau` is the
   standard normal quantile at each level: `[-1.645, -0.674, 0, 0.674, 1.645]`, and `p1` is the
   case's own hour-1 count (a count below 1 counts as 1). Round each to 2 decimals.

5. Enforce non-decreasing quantiles (raise any value below the one before it). If an hour has fewer
   than 5 ratios, fall back to a flat belief: center 0 and spread `max(0.2, 0.15 * sqrt(h - 1))`.

## Verify before you finish

Run it on the practice cases and check the output. The kit's practice inputs are at
`~/makefun/kits/gta6-twitch-ccu-forecast-01/gta6-twitch-ccu-forecast-01-kit/input`:

```
mkdir -p out
MAKEFUN_INPUT_DIR=~/makefun/kits/gta6-twitch-ccu-forecast-01/gta6-twitch-ccu-forecast-01-kit/input \
MAKEFUN_OUTPUT_DIR=out node main.ts
```

Then confirm: 23 rows per file, hours 2..24, five non-decreasing positive quantiles each. Run it
twice into two different directories and confirm the files are byte-identical.

Also write a short `README.md` explaining the model.

Do not commit, do not push, do not create a repository — just write the files.
