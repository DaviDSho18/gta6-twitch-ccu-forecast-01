# GTA VI launch-day Twitch viewer forecaster

An entry for make.fun's **gta6-twitch-ccu-forecast-01**: forecast, hour by hour, how many people
watch Grand Theft Auto VI live on Twitch over the 24 UTC hours of its release day, 2026-11-19, from
the first hour's count.

## What it does

`main.ts` (Node 22, standard library only, no network) reads every `*.in` case file in
`$MAKEFUN_INPUT_DIR` (default `/input`) and writes one forecast to `$MAKEFUN_OUTPUT_DIR/<id>.out`
(default `/output`): for each hour 2 to 24, five quantiles (0.05, 0.25, 0.5, 0.75, 0.95) of that
hour's Twitch viewer count.

## The model

The score is the mean pinball loss on the log scale, so what matters is the launch-day **shape** in
log space, not its absolute size.

1. Each case ships `comparables`: the hourly Twitch counts of ~38 past big launches, from 14 days
   before each release to 3 days after. For each comparable, its release day's curve is recovered
   from `day_start` (hour = round((point − day_start) / 1h) + 1). A usable comparable has at least
   20 of the 24 hours and a positive hour-1 count.

2. Only comparables that are **real big launches** — hour 1 at least 50,000 — join the shape pool.
   A tiny launch's hour 1 is not a meaningful baseline and its early-hour ratios are wild. If fewer
   than 8 clear the floor, every usable comparable is used instead.

3. For each hour 2..24, the log-ratios `ln(viewers_h / viewers_1)` across the pool give the center
   (their median) and the spread (half the p16-to-p84 gap, floored at 0.2 so the band is never razor
   thin).

4. The forecast is `q_tau = p1 · exp(center + z_tau · spread)` at the five levels, with `z_tau` the
   standard normal quantile and `p1` the case's own hour-1 count (a count below 1 counts as 1).

Nothing is tuned on the practice answers — the case files do not carry them; the center and spread
come only from the comparables the case itself ships.

## Run it

```
mkdir -p out
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Two runs on the same case write byte-identical output.

## License

MIT — see `LICENSE`.
