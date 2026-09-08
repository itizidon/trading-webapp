import { describe, expect, it } from "vitest";

import { calculateBuyAndHold, runBacktest } from "./backtest";
import type { PriceBar, RawSignal, RunSettings } from "./types";

const bars: PriceBar[] = [
  { date: "2025-01-02", open: 100, high: 106, low: 99, close: 105, volume: 1_000 },
  { date: "2025-01-03", open: 110, high: 113, low: 108, close: 112, volume: 1_100 },
  { date: "2025-01-06", open: 115, high: 121, low: 114, close: 120, volume: 1_200 },
  { date: "2025-01-07", open: 118, high: 119, low: 115, close: 116, volume: 1_300 },
];

const noCosts: RunSettings = {
  startingCapital: 1_000,
  feePct: 0,
  slippagePct: 0,
};

describe("runBacktest", () => {
  it("fills signals at the next candle open rather than their trigger price", () => {
    const signals: RawSignal[] = [
      { type: "BUY", date: "2025-01-02", price: 105 },
      { type: "SELL", date: "2025-01-06", price: 120 },
    ];

    const result = runBacktest("next-open", bars, signals, noCosts);

    expect(result.strategyId).toBe("next-open");
    expect(result.signals).toMatchObject([
      {
        type: "BUY",
        price: 105,
        fillDate: "2025-01-03",
        fillPrice: 110,
        status: "FILLED",
      },
      {
        type: "SELL",
        price: 120,
        fillDate: "2025-01-07",
        fillPrice: 118,
        status: "FILLED",
      },
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entryDate: "2025-01-03",
      entryPrice: 110,
      exitDate: "2025-01-07",
      exitPrice: 118,
      status: "CLOSED",
    });
    expect(result.metrics.endingValue).toBe(1_072.73);
    expect(result.metrics.totalReturnPct).toBe(7.2727);
    expect(result.metrics.completedTrades).toBe(1);
    expect(result.metrics.winRatePct).toBe(100);
  });

  it("fills same-day 15-minute signals at the next candle", () => {
    const intradayBars: PriceBar[] = [
      { date: "2025-01-02T14:30:00.000Z", open: 100, high: 102, low: 99, close: 101, volume: 1_000 },
      { date: "2025-01-02T14:45:00.000Z", open: 103, high: 105, low: 102, close: 104, volume: 1_100 },
      { date: "2025-01-02T15:00:00.000Z", open: 106, high: 108, low: 105, close: 107, volume: 1_200 },
      { date: "2025-01-02T15:15:00.000Z", open: 105, high: 106, low: 103, close: 104, volume: 1_300 },
    ];
    const signals: RawSignal[] = [
      { type: "BUY", date: intradayBars[0].date, price: intradayBars[0].close },
      { type: "SELL", date: intradayBars[2].date, price: intradayBars[2].close },
    ];

    const result = runBacktest("intraday-next-candle", intradayBars, signals, noCosts);

    expect(result.signals).toMatchObject([
      {
        date: "2025-01-02T14:30:00.000Z",
        fillDate: "2025-01-02T14:45:00.000Z",
        fillPrice: 103,
        status: "FILLED",
      },
      {
        date: "2025-01-02T15:00:00.000Z",
        fillDate: "2025-01-02T15:15:00.000Z",
        fillPrice: 105,
        status: "FILLED",
      },
    ]);
    expect(result.trades[0]).toMatchObject({
      entryDate: "2025-01-02T14:45:00.000Z",
      entryPrice: 103,
      exitDate: "2025-01-02T15:15:00.000Z",
      exitPrice: 105,
      status: "CLOSED",
    });
  });

  it("calculates an independent return for each strategy", () => {
    const roundTrip = runBacktest(
      "round-trip",
      bars,
      [
        { type: "BUY", date: "2025-01-02", price: 105 },
        { type: "SELL", date: "2025-01-06", price: 120 },
      ],
      noCosts,
    );
    const lateEntry = runBacktest(
      "late-entry",
      bars,
      [{ type: "BUY", date: "2025-01-03", price: 112 }],
      noCosts,
    );

    expect(roundTrip.strategyId).toBe("round-trip");
    expect(roundTrip.metrics.totalReturnPct).toBe(7.2727);
    expect(lateEntry.strategyId).toBe("late-entry");
    expect(lateEntry.metrics.totalReturnPct).toBeCloseTo(0.8696, 4);
    expect(lateEntry.metrics.totalReturnPct).not.toBe(roundTrip.metrics.totalReturnPct);
  });

  it("marks an unclosed position to the final close", () => {
    const result = runBacktest(
      "open-position",
      bars,
      [{ type: "BUY", date: "2025-01-02", price: 105 }],
      noCosts,
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entryDate: "2025-01-03",
      entryPrice: 110,
      status: "OPEN",
    });
    expect(result.trades[0].exitDate).toBeUndefined();
    expect(result.trades[0].exitPrice).toBeUndefined();
    expect(result.trades[0].pnl).toBeCloseTo(54.545_454, 5);
    expect(result.metrics.endingValue).toBe(1_054.55);
    expect(result.metrics.totalReturnPct).toBe(5.4545);
    expect(result.metrics.completedTrades).toBe(0);
    expect(result.metrics.winRatePct).toBeNull();
    expect(result.metrics.exposurePct).toBe(75);
  });

  it("rejects malformed signals rather than silently reporting no signals", () => {
    const signals = [
      { type: "BUY", date: "2099-01-01", price: 105 },
      { type: "BUY", date: "2025-01-02", price: 500 },
      { type: "BUY", date: "2025-01-02", price: Number.NaN },
      { type: "HOLD", date: "2025-01-02", price: 105 },
      { type: "SELL", date: "2025-01-02", price: 105 },
    ] as RawSignal[];

    expect(() => runBacktest("validation", bars, signals, noCosts)).toThrow(
      "4 signal(s) had an unknown timestamp",
    );
  });

  it("reports malformed optional metadata without crashing normalization", () => {
    const signals = [
      { type: "BUY", date: "2025-01-02", price: 105, reason: { text: "not a string" } },
    ] as unknown as RawSignal[];

    expect(() => runBacktest("metadata", bars, signals, noCosts)).toThrow(
      "1 signal(s) had an unknown timestamp, invalid action, invalid metadata",
    );
  });

  it("rejects sparse signal arrays as malformed input", () => {
    const signals = new Array(1) as RawSignal[];

    expect(() => runBacktest("sparse", bars, signals, noCosts)).toThrow(
      "1 signal(s) had an unknown timestamp",
    );
  });

  it("retains valid but unactionable signals in the strategy trace", () => {
    const result = runBacktest(
      "ignored-sell",
      bars,
      [{ type: "SELL", date: "2025-01-02", price: 105 }],
      noCosts,
    );

    expect(result.signals[0].status).toBe("IGNORED");
    expect(result.metrics.totalSignals).toBe(1);
    expect(result.metrics.totalReturnPct).toBe(0);
  });

  it("applies adverse slippage and fees to both sides of a round trip", () => {
    const costBars: PriceBar[] = [
      { date: "2025-02-03", open: 100, high: 101, low: 99, close: 100, volume: 1_000 },
      { date: "2025-02-04", open: 100, high: 111, low: 99, close: 110, volume: 1_100 },
      { date: "2025-02-05", open: 110, high: 111, low: 109, close: 110, volume: 1_200 },
    ];

    const result = runBacktest(
      "costs",
      costBars,
      [
        { type: "BUY", date: "2025-02-03", price: 100 },
        { type: "SELL", date: "2025-02-04", price: 110 },
      ],
      { startingCapital: 1_000, feePct: 1, slippagePct: 1 },
    );

    expect(result.trades[0].entryPrice).toBe(101);
    expect(result.trades[0].exitPrice).toBeCloseTo(108.9, 10);
    expect(result.trades[0].pnl).toBeCloseTo(56.866_974, 5);
    expect(result.metrics.endingValue).toBe(1_056.87);
    expect(result.metrics.totalReturnPct).toBe(5.6867);
  });

  it("rejects a run without enough candles or positive starting capital", () => {
    expect(() => runBacktest("short", bars.slice(0, 1), [], noCosts)).toThrow(
      "At least two market candles are required.",
    );
    expect(() =>
      runBacktest("capital", bars, [], { ...noCosts, startingCapital: 0 }),
    ).toThrow("Starting capital must be greater than zero.");
  });

  it("rejects bars that are out of order or have inconsistent market fields", () => {
    const reversed = [bars[1], bars[0], ...bars.slice(2)];
    expect(() => runBacktest("order", reversed, [], noCosts)).toThrow(
      "Market bars must have unique timestamps in chronological order.",
    );

    const duplicateInstant = [
      { ...bars[0], date: "2025-01-02" },
      { ...bars[1], date: "2025-01-02T00:00:00.000Z" },
    ];
    expect(() => runBacktest("duplicate-time", duplicateInstant, [], noCosts)).toThrow(
      "Market bars must have unique timestamps in chronological order.",
    );

    const invalidOhlc = bars.map((bar, index) => index === 1 ? { ...bar, high: bar.close - 1 } : bar);
    expect(() => runBacktest("ohlc", invalidOhlc, [], noCosts)).toThrow(
      "Market bar 2025-01-03 has inconsistent OHLC prices.",
    );

    const invalidVolume = bars.map((bar, index) => index === 1 ? { ...bar, volume: -1 } : bar);
    expect(() => runBacktest("volume", invalidVolume, [], noCosts)).toThrow(
      "Market bar 2025-01-03 must have finite, non-negative volume.",
    );
  });
});

describe("calculateBuyAndHold", () => {
  it("buys at the first open and marks the position at every close", () => {
    const curve = calculateBuyAndHold(bars, 1_000);

    expect(curve.map(({ date, value }) => ({ date, value }))).toEqual([
      { date: "2025-01-02", value: 1_050 },
      { date: "2025-01-03", value: 1_120 },
      { date: "2025-01-06", value: 1_200 },
      { date: "2025-01-07", value: 1_160 },
    ]);
    expect(curve.map(({ returnPct }) => returnPct)).toEqual([
      expect.closeTo(5, 10),
      expect.closeTo(12, 10),
      expect.closeTo(20, 10),
      expect.closeTo(16, 10),
    ]);
  });

  it("returns no curve for empty data or non-positive capital", () => {
    expect(calculateBuyAndHold([], 1_000)).toEqual([]);
    expect(calculateBuyAndHold(bars, 0)).toEqual([]);
    expect(calculateBuyAndHold(bars, -1)).toEqual([]);
  });
});
