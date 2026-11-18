const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Environment variables with default fallbacks as specified by the bounty harness
const INPUT_DIR: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Quantile levels evaluated by the competition
const LEVELS: number[] = [0.05, 0.25, 0.5, 0.75, 0.95];

// Standard normal quantiles corresponding to each level:
// tau = 0.05 -> z = -1.645
// tau = 0.25 -> z = -0.674
// tau = 0.50 -> z = 0
// tau = 0.75 -> z = 0.674
// tau = 0.95 -> z = 1.645
const Z: number[] = [-1.645, -0.674, 0, 0.674, 1.645];

// Widens the p16-p84 gap to an honest 90% band (the raw gap covered only ~0.65 on the practice)
const SPREAD_MULT = 1.76;

interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number;
  reads?: number;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyPoint[];
}

interface KnownHour {
  hour: number;
  viewers: number;
  channels?: number;
  reads?: number;
}

interface ForecastHour {
  hour: number;
  from?: string;
  until?: string;
}

interface CaseFile {
  id: string;
  levels: number[];
  known: KnownHour[];
  forecast: ForecastHour[];
  comparables: Comparable[];
}

interface ForecastRow {
  hour: number;
  q: number[];
}

interface CaseOutput {
  hours: ForecastRow[];
}

/**
 * Round a positive number to 2 decimal places.
 */
function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Compute the p-th quantile of a sorted numeric array using continuous linear interpolation.
 * Uses the standard formula: index = (N - 1) * p.
 */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(index);
  const frac = index - lowerIndex;

  if (lowerIndex >= sorted.length - 1) {
    return sorted[sorted.length - 1];
  }
  if (lowerIndex < 0) {
    return sorted[0];
  }

  return sorted[lowerIndex] + frac * (sorted[lowerIndex + 1] - sorted[lowerIndex]);
}

interface ProcessedComparable {
  name: string;
  hourViewers: Map<number, number>;
  hour1Viewers: number;
}

/**
 * Extract release-day hourly viewer counts for each comparable.
 * Release-day hours are 1..24, where:
 *   hour = round((point_time - day_start) / 1 hour) + 1.
 *
 * A usable comparable must have:
 * - Positive viewer count at hour 1
 * - At least 20 of the 24 hours recorded with positive counts
 */
function extractUsableComparables(comparables: Comparable[]): ProcessedComparable[] {
  const usable: ProcessedComparable[] = [];

  for (const comp of comparables) {
    const dayStartMs = Date.parse(comp.day_start);
    if (Number.isNaN(dayStartMs)) continue;

    const hourViewers = new Map<number, number>();

    for (const point of comp.hourly) {
      if (!point.from || typeof point.viewers !== 'number' || point.viewers <= 0) {
        continue;
      }

      const pointMs = Date.parse(point.from);
      if (Number.isNaN(pointMs)) continue;

      const hourOffset = Math.round((pointMs - dayStartMs) / (3600 * 1000));
      const releaseHour = hourOffset + 1;

      if (releaseHour >= 1 && releaseHour <= 24) {
        hourViewers.set(releaseHour, point.viewers);
      }
    }

    const hour1 = hourViewers.get(1);
    if (hour1 !== undefined && hour1 > 0 && hourViewers.size >= 20) {
      usable.push({
        name: comp.name,
        hourViewers,
        hour1Viewers: hour1,
      });
    }
  }

  return usable;
}

/**
 * Filter comparables to big launches (hour 1 count >= 50,000).
 * If fewer than 8 comparables qualify, fall back to using every usable comparable.
 */
function selectKeptComparables(usable: ProcessedComparable[]): ProcessedComparable[] {
  const bigLaunches = usable.filter((c) => c.hour1Viewers >= 50000);
  if (bigLaunches.length >= 8) {
    return bigLaunches;
  }
  return usable;
}

/**
 * Forecast quantiles for a single case.
 */
function forecastCase(caseData: CaseFile): CaseOutput {
  // Extract hour-1 count for the target case
  const firstKnown = Array.isArray(caseData.known)
    ? caseData.known.find((k) => k.hour === 1)
    : undefined;
  const p1 = Math.max(1, firstKnown?.viewers ?? 1);

  // Extract and filter comparables
  const usable = extractUsableComparables(caseData.comparables ?? []);
  const kept = selectKeptComparables(usable);

  const hoursOutput: ForecastRow[] = [];

  // Sort forecast hours or default to 2..24
  const targetHours = (caseData.forecast ?? [])
    .map((f) => f.hour)
    .filter((h) => h >= 2 && h <= 24);

  // Fallback if forecast array is missing or empty
  const hoursToForecast = targetHours.length > 0
    ? targetHours
    : Array.from({ length: 23 }, (_, i) => i + 2);

  for (const h of hoursToForecast) {
    // Collect log-ratios ln(viewers_h / viewers_1) across kept comparables
    const logRatios: number[] = [];
    for (const comp of kept) {
      const vh = comp.hourViewers.get(h);
      if (vh !== undefined && vh > 0) {
        logRatios.push(Math.log(vh / comp.hour1Viewers));
      }
    }

    logRatios.sort((a, b) => a - b);

    let center: number;
    let spread: number;

    if (logRatios.length < 5) {
      // Fallback flat belief if fewer than 5 ratios are available
      center = 0;
      spread = Math.max(0.2, 0.15 * Math.sqrt(h - 1));
    } else {
      // Median (0.5 quantile by linear interpolation)
      center = quantile(logRatios, 0.5);
      // Half of the p16-to-p84 inter-quantile range scaled by SPREAD_MULT, floored at 0.2
      const p16 = quantile(logRatios, 0.16);
      const p84 = quantile(logRatios, 0.84);
      spread = Math.max(0.2, ((p84 - p16) / 2) * SPREAD_MULT);
    }

    // Compute quantile values for each level
    const q = Z.map((z) => {
      const unrounded = p1 * Math.exp(center + z * spread);
      return round2(unrounded);
    });

    // Enforce non-decreasing quantiles and bounded limits (0 < q <= 1e9)
    for (let j = 0; j < q.length; j++) {
      if (q[j] <= 0) {
        q[j] = 0.01;
      }
      if (j > 0 && q[j] < q[j - 1]) {
        q[j] = q[j - 1];
      }
      if (q[j] > 1e9) {
        q[j] = 1e9;
      }
    }

    hoursOutput.push({ hour: h, q });
  }

  return { hours: hoursOutput };
}

/**
 * Main entry point: process all *.in files in INPUT_DIR and write to OUTPUT_DIR.
 */
function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const inputFiles = readdirSync(INPUT_DIR)
    .filter((file: string) => file.endsWith('.in'))
    .sort();

  for (const file of inputFiles) {
    const caseId = file.slice(0, -'.in'.length);
    const rawContent = readFileSync(join(INPUT_DIR, file), 'utf8');
    const caseData = JSON.parse(rawContent) as CaseFile;

    const output = forecastCase(caseData);
    const outputPath = join(OUTPUT_DIR, `${caseId}.out`);

    // Write UTF-8 JSON deterministically
    writeFileSync(outputPath, `${JSON.stringify(output)}\n`, 'utf8');
  }
}

main();
