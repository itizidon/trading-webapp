import { describe, expect, it } from "vitest";

import {
  INTERVAL_OPTIONS,
  RANGE_OPTIONS,
  isIntervalKey,
  isRangeKey,
  isRangeSupported,
  marketHistoryConfig,
  nearestSupportedRange,
} from "./market-options";

describe("market options", () => {
  it("exposes the intervals and durations in display order", () => {
    expect(INTERVAL_OPTIONS).toEqual([
      { key: "1d", label: "Daily", shortLabel: "1D" },
      { key: "15m", label: "15 min", shortLabel: "15m" },
      { key: "30m", label: "30 min", shortLabel: "30m" },
      { key: "1h", label: "Hourly", shortLabel: "1h" },
    ]);
    expect(RANGE_OPTIONS.map((option) => option.key)).toEqual([
      "1M",
      "3M",
      "6M",
      "1Y",
      "3Y",
      "5Y",
    ]);
  });

  it("validates public query values without unsafe casts", () => {
    expect(isIntervalKey("15m")).toBe(true);
    expect(isIntervalKey("15 minutes")).toBe(false);
    expect(isIntervalKey(null)).toBe(false);
    expect(isRangeKey("3Y")).toBe(true);
    expect(isRangeKey("2Y")).toBe(false);
  });

  it("limits intraday durations to the provider's history windows", () => {
    expect(RANGE_OPTIONS.filter(({ key }) => isRangeSupported("15m", key)).map(({ key }) => key))
      .toEqual(["1M"]);
    expect(RANGE_OPTIONS.filter(({ key }) => isRangeSupported("30m", key)).map(({ key }) => key))
      .toEqual(["1M"]);
    expect(RANGE_OPTIONS.filter(({ key }) => isRangeSupported("1h", key)).map(({ key }) => key))
      .toEqual(["1M", "3M", "6M", "1Y"]);
    expect(RANGE_OPTIONS.every(({ key }) => isRangeSupported("1d", key))).toBe(true);
  });

  it("keeps a preferred duration when possible and otherwise chooses the nearest one", () => {
    expect(nearestSupportedRange("1d", "5Y")).toBe("5Y");
    expect(nearestSupportedRange("1h", "6M")).toBe("6M");
    expect(nearestSupportedRange("1h", "3Y")).toBe("1Y");
    expect(nearestSupportedRange("15m", "1Y")).toBe("1M");
  });

  it("caps warmup safely below intraday provider limits", () => {
    expect(marketHistoryConfig("15m", "1M")).toMatchObject({
      rangeDays: 31,
      historyDays: 59,
      warmupDays: 28,
      intervalMs: 15 * 60_000,
      cacheSeconds: 60,
    });
    expect(marketHistoryConfig("1h", "1Y")).toMatchObject({
      rangeDays: 366,
      historyDays: 729,
      warmupDays: 363,
      intervalMs: 60 * 60_000,
      cacheSeconds: 300,
    });
    expect(marketHistoryConfig("1d", "5Y")).toMatchObject({
      rangeDays: 1827,
      historyDays: 2227,
      warmupDays: 400,
      cacheSeconds: 900,
    });
  });
});
