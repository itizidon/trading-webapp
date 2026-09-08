import type { IntervalKey, RangeKey } from "./types";

const DAY_MS = 86_400_000;
const INTRADAY_SAFETY_BUFFER_DAYS = 1;
const TARGET_WARMUP_DAYS = 400;

export const INTERVAL_OPTIONS = [
  { key: "1d", label: "Daily", shortLabel: "1D" },
  { key: "15m", label: "15 min", shortLabel: "15m" },
  { key: "30m", label: "30 min", shortLabel: "30m" },
  { key: "1h", label: "Hourly", shortLabel: "1h" },
] as const satisfies ReadonlyArray<{
  key: IntervalKey;
  label: string;
  shortLabel: string;
}>;

export const RANGE_OPTIONS = [
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "1Y", label: "1Y" },
  { key: "3Y", label: "3Y" },
  { key: "5Y", label: "5Y" },
] as const satisfies ReadonlyArray<{ key: RangeKey; label: string }>;

export const RANGE_DAYS: Readonly<Record<RangeKey, number>> = {
  "1M": 31,
  "3M": 93,
  "6M": 186,
  "1Y": 366,
  "3Y": 1096,
  "5Y": 1827,
};

const PROVIDER_LOOKBACK_DAYS: Readonly<
  Record<IntervalKey, number | null>
> = {
  "1d": null,
  "15m": 60,
  "30m": 60,
  "1h": 730,
};

const CACHE_SECONDS: Readonly<Record<IntervalKey, number>> = {
  "1d": 900,
  "15m": 60,
  "30m": 120,
  "1h": 300,
};

const STALE_WHILE_REVALIDATE_SECONDS: Readonly<Record<IntervalKey, number>> = {
  "1d": 86_400,
  "15m": 900,
  "30m": 1_800,
  "1h": 3_600,
};

const INTERVAL_MS: Readonly<Record<IntervalKey, number>> = {
  "1d": DAY_MS,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
};

export function isIntervalKey(value: string | null): value is IntervalKey {
  return INTERVAL_OPTIONS.some((option) => option.key === value);
}

export function isRangeKey(value: string | null): value is RangeKey {
  return RANGE_OPTIONS.some((option) => option.key === value);
}

export function intervalLabel(interval: IntervalKey) {
  return INTERVAL_OPTIONS.find((option) => option.key === interval)?.label ?? interval;
}

export function isRangeSupported(interval: IntervalKey, range: RangeKey) {
  const providerLimit = PROVIDER_LOOKBACK_DAYS[interval];
  if (providerLimit === null) return true;
  return RANGE_DAYS[range] <= providerLimit - INTRADAY_SAFETY_BUFFER_DAYS;
}

export function nearestSupportedRange(
  interval: IntervalKey,
  preferredRange: RangeKey,
): RangeKey {
  const supported = RANGE_OPTIONS.filter((option) =>
    isRangeSupported(interval, option.key),
  );
  const preferredDays = RANGE_DAYS[preferredRange];

  return supported.reduce((nearest, option) => {
    const nearestDistance = Math.abs(RANGE_DAYS[nearest] - preferredDays);
    const optionDistance = Math.abs(RANGE_DAYS[option.key] - preferredDays);
    return optionDistance < nearestDistance ? option.key : nearest;
  }, supported[0].key);
}

export interface MarketHistoryConfig {
  rangeDays: number;
  historyDays: number;
  warmupDays: number;
  intervalMs: number;
  cacheSeconds: number;
  staleWhileRevalidateSeconds: number;
}

export function marketHistoryConfig(
  interval: IntervalKey,
  range: RangeKey,
): MarketHistoryConfig {
  const rangeDays = RANGE_DAYS[range];
  const providerLimit = PROVIDER_LOOKBACK_DAYS[interval];
  const safeLimit = providerLimit === null
    ? Number.POSITIVE_INFINITY
    : providerLimit - INTRADAY_SAFETY_BUFFER_DAYS;
  const historyDays = Math.min(rangeDays + TARGET_WARMUP_DAYS, safeLimit);

  return {
    rangeDays,
    historyDays,
    warmupDays: Math.max(0, historyDays - rangeDays),
    intervalMs: INTERVAL_MS[interval],
    cacheSeconds: CACHE_SECONDS[interval],
    staleWhileRevalidateSeconds: STALE_WHILE_REVALIDATE_SECONDS[interval],
  };
}
