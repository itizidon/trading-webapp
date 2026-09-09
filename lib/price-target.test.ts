import { describe, expect, it } from "vitest";

import { derivePriceTarget } from "./price-target";
import { DEFAULT_STRATEGIES } from "./strategies";
import type { PriceBar } from "./types";

function barsFromCloses(closes: number[]): PriceBar[] {
  return closes.map((close, index) => ({
    date: `2025-01-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

describe("derivePriceTarget", () => {
  it("calculates the next SMA crossover boundary", () => {
    const strategy = DEFAULT_STRATEGIES[0];
    const bars = barsFromCloses(new Array(50).fill(100));

    expect(derivePriceTarget(strategy, bars, "WAIT")).toEqual({
      action: "BUY",
      comparison: "ABOVE",
      price: 100,
    });
    expect(derivePriceTarget(strategy, bars, "HOLD")).toEqual({
      action: "SELL",
      comparison: "BELOW",
      price: 100,
    });
  });

  it("uses the live channel boundaries for breakout targets", () => {
    const strategy = DEFAULT_STRATEGIES[2];
    const bars = barsFromCloses(Array.from({ length: 25 }, (_, index) => 80 + index));

    expect(derivePriceTarget(strategy, bars, "WAIT")).toMatchObject({
      action: "BUY",
      comparison: "ABOVE",
      price: 104,
    });
    expect(derivePriceTarget(strategy, bars, "HOLD")).toMatchObject({
      action: "SELL",
      comparison: "BELOW",
      price: 95,
    });
  });

  it("solves the next RSI threshold when the reversal is armed", () => {
    const strategy = DEFAULT_STRATEGIES[1];
    const falling = barsFromCloses(Array.from({ length: 16 }, (_, index) => 115 - index));
    const rising = barsFromCloses(Array.from({ length: 16 }, (_, index) => 100 + index));

    expect(derivePriceTarget(strategy, falling, "WAIT")?.price).toBeCloseTo(105.5714286);
    expect(derivePriceTarget(strategy, rising, "HOLD")?.price).toBeCloseTo(109.4285714);
  });

  it("does not invent a target for edited or custom logic", () => {
    const strategy = { ...DEFAULT_STRATEGIES[0], code: `${DEFAULT_STRATEGIES[0].code}\n// edited` };
    const bars = barsFromCloses(new Array(50).fill(100));

    expect(derivePriceTarget(strategy, bars, "WAIT")).toBeNull();
    expect(derivePriceTarget(DEFAULT_STRATEGIES[0], bars, "BUY")).toBeNull();
  });
});
