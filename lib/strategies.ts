import type { StrategyDefinition } from "./types";

const SMA_CROSS = `function strategy(bars, helpers) {
  const closes = bars.map((bar) => bar.close);
  const fast = helpers.sma(closes, 20);
  const slow = helpers.sma(closes, 50);
  const signals = [];

  for (let i = 1; i < bars.length; i += 1) {
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      signals.push({ type: "BUY", date: bars[i].date, price: bars[i].close, reason: "SMA 20 crossed above SMA 50" });
    }
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      signals.push({ type: "SELL", date: bars[i].date, price: bars[i].close, reason: "SMA 20 crossed below SMA 50" });
    }
  }
  return signals;
}`;

const RSI_REVERSAL = `function strategy(bars, helpers) {
  const closes = bars.map((bar) => bar.close);
  const rsi = helpers.rsi(closes, 14);
  const signals = [];

  for (let i = 1; i < bars.length; i += 1) {
    if (Number.isFinite(rsi[i - 1]) && Number.isFinite(rsi[i]) && rsi[i - 1] <= 30 && rsi[i] > 30) {
      signals.push({ type: "BUY", date: bars[i].date, price: bars[i].close, reason: "RSI recovered above 30" });
    }
    if (Number.isFinite(rsi[i - 1]) && Number.isFinite(rsi[i]) && rsi[i - 1] >= 70 && rsi[i] < 70) {
      signals.push({ type: "SELL", date: bars[i].date, price: bars[i].close, reason: "RSI fell below 70" });
    }
  }
  return signals;
}`;

const BREAKOUT = `function strategy(bars, helpers) {
  const closes = bars.map((bar) => bar.close);
  const priorHigh = helpers.highest(closes, 20);
  const trailingStop = helpers.lowest(closes, 10);
  const signals = [];

  for (let i = 21; i < bars.length; i += 1) {
    if (closes[i] > priorHigh[i - 1]) {
      signals.push({ type: "BUY", date: bars[i].date, price: bars[i].close, reason: "20-session breakout" });
    }
    if (closes[i] < trailingStop[i - 1]) {
      signals.push({ type: "SELL", date: bars[i].date, price: bars[i].close, reason: "10-session trailing low" });
    }
  }
  return signals;
}`;

export const STRATEGY_COLORS = [
  "#8b7cff",
  "#2dd4bf",
  "#f7b955",
  "#fb7185",
  "#60a5fa",
  "#c084fc",
  "#a3e635",
  "#fb923c",
];

export const DEFAULT_STRATEGIES: StrategyDefinition[] = [
  {
    id: "sma-cross",
    name: "SMA Crossover",
    description: "Follows medium-term trend shifts using 20 and 50-session averages.",
    color: STRATEGY_COLORS[0],
    code: SMA_CROSS,
    enabled: true,
  },
  {
    id: "rsi-reversal",
    name: "RSI Reversal",
    description: "Looks for momentum recovering from oversold and fading from overbought.",
    color: STRATEGY_COLORS[1],
    code: RSI_REVERSAL,
    enabled: true,
  },
  {
    id: "channel-breakout",
    name: "Channel Breakout",
    description: "Buys 20-session highs and exits below the trailing 10-session low.",
    color: STRATEGY_COLORS[2],
    code: BREAKOUT,
    enabled: true,
  },
];

export const BLANK_STRATEGY = `function strategy(bars, helpers) {
  const closes = bars.map((bar) => bar.close);
  const fast = helpers.sma(closes, 10);
  const slow = helpers.sma(closes, 30);
  const signals = [];

  for (let i = 1; i < bars.length; i += 1) {
    // Add your BUY and SELL conditions here.
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      signals.push({ type: "BUY", date: bars[i].date, price: bars[i].close });
    }
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
      signals.push({ type: "SELL", date: bars[i].date, price: bars[i].close });
    }
  }
  return signals;
}`;
