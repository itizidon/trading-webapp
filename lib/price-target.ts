import type { CurrentSignalAction } from "./current-signal";
import { getBuiltInStrategyKind } from "./strategies";
import type { PriceBar, StrategyDefinition } from "./types";

export interface PriceTarget {
  action: "BUY" | "SELL";
  comparison: "ABOVE" | "BELOW";
  price: number;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function currentRsiState(values: number[], period: number) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  const rsi = averageLoss === 0
    ? 100
    : 100 - 100 / (1 + averageGain / averageLoss);
  return { averageGain, averageLoss, rsi };
}

/** Calculates the next closing-price boundary for the unchanged built-in algorithms. */
export function derivePriceTarget(
  strategy: StrategyDefinition,
  bars: PriceBar[],
  action: CurrentSignalAction | null,
): PriceTarget | null {
  if (action !== "WAIT" && action !== "HOLD") return null;

  const closes = bars.map((bar) => bar.close);
  const latestClose = closes[closes.length - 1];
  if (!Number.isFinite(latestClose)) return null;

  const targetAction = action === "WAIT" ? "BUY" : "SELL";
  const comparison = action === "WAIT" ? "ABOVE" : "BELOW";
  const kind = getBuiltInStrategyKind(strategy.code);

  if (kind === "CHANNEL_BREAKOUT") {
    const period = action === "WAIT" ? 20 : 10;
    if (closes.length < period) return null;
    const window = closes.slice(-period);
    const price = action === "WAIT" ? Math.max(...window) : Math.min(...window);
    return { action: targetAction, comparison, price };
  }

  if (kind === "SMA_CROSS") {
    if (closes.length < 50) return null;
    const currentFast = average(closes.slice(-20));
    const currentSlow = average(closes.slice(-50));
    if (
      (action === "WAIT" && currentFast > currentSlow) ||
      (action === "HOLD" && currentFast < currentSlow)
    ) {
      return null;
    }

    const fastPriorSum = closes.slice(-19).reduce((sum, value) => sum + value, 0);
    const slowPriorSum = closes.slice(-49).reduce((sum, value) => sum + value, 0);
    const price = (20 * slowPriorSum - 50 * fastPriorSum) / 30;
    return Number.isFinite(price) && price > 0
      ? { action: targetAction, comparison, price }
      : null;
  }

  if (kind === "RSI_REVERSAL") {
    const period = 14;
    const state = currentRsiState(closes, period);
    if (!state) return null;

    if (action === "WAIT" && state.rsi <= 30) {
      const relativeStrength = 30 / 70;
      const gainNeeded = (period - 1) * (
        relativeStrength * state.averageLoss - state.averageGain
      );
      const price = latestClose + gainNeeded;
      return Number.isFinite(price) && price > 0
        ? { action: "BUY", comparison: "ABOVE", price }
        : null;
    }

    if (action === "HOLD" && state.rsi >= 70) {
      const relativeStrength = 70 / 30;
      const lossNeeded = (period - 1) * (
        state.averageGain / relativeStrength - state.averageLoss
      );
      const price = latestClose - lossNeeded;
      return Number.isFinite(price) && price > 0
        ? { action: "SELL", comparison: "BELOW", price }
        : null;
    }
  }

  return null;
}
