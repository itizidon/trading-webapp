import { describe, expect, it } from "vitest";

import { runBacktest } from "./backtest";
import { deriveCurrentSignal } from "./current-signal";
import type { BacktestResult, PriceBar, RunSettings, TradeSignal } from "./types";

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

function current(result: BacktestResult, options?: { stale?: boolean; updating?: boolean }) {
  return deriveCurrentSignal({ result, bars, ...options });
}

describe("deriveCurrentSignal", () => {
  it("returns BUY only for an actionable entry on the latest completed bar", () => {
    const result = runBacktest(
      "latest-buy",
      bars,
      [{ type: "BUY", date: "2025-01-07", price: 116, reason: "Entry condition" }],
      noCosts,
    );

    expect(current(result)).toMatchObject({
      status: "READY",
      action: "BUY",
      position: "FLAT",
      asOf: "2025-01-07",
      signal: { type: "BUY", status: "PENDING" },
    });
  });

  it("returns SELL for a latest-bar exit while a position is open", () => {
    const result = runBacktest(
      "latest-sell",
      bars,
      [
        { type: "BUY", date: "2025-01-02", price: 105 },
        { type: "SELL", date: "2025-01-07", price: 116, reason: "Exit condition" },
      ],
      noCosts,
    );

    expect(current(result)).toMatchObject({
      status: "READY",
      action: "SELL",
      position: "LONG",
      signal: { type: "SELL", status: "PENDING" },
    });
  });

  it("returns HOLD when the simulated position is open without a new exit", () => {
    const result = runBacktest(
      "hold",
      bars,
      [{ type: "BUY", date: "2025-01-02", price: 105 }],
      noCosts,
    );

    expect(current(result)).toMatchObject({
      status: "READY",
      action: "HOLD",
      position: "LONG",
      signal: null,
      lastFilledSignal: { type: "BUY", status: "FILLED" },
    });
  });

  it("returns WAIT when the strategy is in cash without a new entry", () => {
    const result = runBacktest(
      "wait",
      bars,
      [
        { type: "BUY", date: "2025-01-02", price: 105 },
        { type: "SELL", date: "2025-01-06", price: 120 },
      ],
      noCosts,
    );

    expect(current(result)).toMatchObject({
      status: "READY",
      action: "WAIT",
      position: "FLAT",
      signal: null,
      lastFilledSignal: { type: "SELL", status: "FILLED" },
    });
  });

  it("does not present older or ignored signals as a new action", () => {
    const result = runBacktest(
      "old-signal",
      bars,
      [{ type: "SELL", date: "2025-01-06", price: 120 }],
      noCosts,
    );

    expect(current(result)).toMatchObject({
      status: "READY",
      action: "WAIT",
      position: "FLAT",
      signal: null,
    });
  });

  it("suppresses the action while updating or when results are stale", () => {
    const result = runBacktest(
      "guarded-buy",
      bars,
      [{ type: "BUY", date: "2025-01-07", price: 116 }],
      noCosts,
    );

    expect(current(result, { updating: true })).toMatchObject({ status: "UPDATING", action: null });
    expect(current(result, { stale: true })).toMatchObject({ status: "STALE", action: null });
  });

  it("detects result coverage that does not reach the latest bar", () => {
    const result = runBacktest("coverage", bars.slice(0, -1), [], noCosts);

    expect(current(result)).toMatchObject({ status: "STALE", action: null });
  });

  it("keeps missing and failed results distinct from WAIT", () => {
    expect(deriveCurrentSignal({ bars })).toMatchObject({ status: "NOT_RUN", action: null });

    const result = runBacktest("failed", bars, [], noCosts);
    const failed = { ...result, error: "Algorithm failed." };
    expect(current(failed)).toMatchObject({
      status: "ERROR",
      action: null,
      error: "Algorithm failed.",
    });
  });

  it("rejects conflicting latest-bar directions instead of guessing", () => {
    const result = runBacktest("conflict", bars, [], noCosts);
    const pending = (type: "BUY" | "SELL", sourceIndex: number): TradeSignal => ({
      id: `signal-${sourceIndex}`,
      type,
      date: "2025-01-07",
      price: 116,
      barIndex: 3,
      status: "PENDING",
    });
    const conflicted = { ...result, signals: [pending("BUY", 1), pending("SELL", 2)] };

    expect(current(conflicted)).toMatchObject({
      status: "ERROR",
      action: null,
      error: expect.stringContaining("conflicting BUY and SELL"),
    });
  });

  it("uses the first duplicate pending signal deterministically", () => {
    const result = runBacktest("duplicates", bars, [], noCosts);
    const pending = (reason: string, sourceIndex: number): TradeSignal => ({
      id: `signal-${sourceIndex}`,
      type: "BUY",
      date: "2025-01-07",
      price: 116,
      reason,
      barIndex: 3,
      status: "PENDING",
    });
    const duplicated = {
      ...result,
      signals: [pending("First entry", 1), pending("Duplicate entry", 2)],
    };

    expect(current(duplicated)).toMatchObject({
      status: "READY",
      action: "BUY",
      signal: { reason: "First entry" },
    });
  });
});
