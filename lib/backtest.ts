import type {
  BacktestMetrics,
  BacktestResult,
  CompletedTrade,
  EquityPoint,
  PriceBar,
  RawSignal,
  RunSettings,
  TradeSignal,
} from "./types";

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateBars(bars: PriceBar[]) {
  let previousDate = "";

  bars.forEach((bar, index) => {
    if (!bar || typeof bar !== "object") {
      throw new Error(`Market bar ${index + 1} is invalid.`);
    }
    if (!isIsoDate(bar.date)) {
      throw new Error(`Market bar ${index + 1} must have a valid ISO date.`);
    }
    if (previousDate && bar.date <= previousDate) {
      throw new Error("Market bars must have unique dates in chronological order.");
    }
    previousDate = bar.date;

    if (![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Market bars must contain finite, positive prices.");
    }
    if (
      bar.low > bar.high ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close)
    ) {
      throw new Error(`Market bar ${bar.date} has inconsistent OHLC prices.`);
    }
    if (!Number.isFinite(bar.volume) || bar.volume < 0) {
      throw new Error(`Market bar ${bar.date} must have finite, non-negative volume.`);
    }
  });
}

function normalizeSignals(raw: RawSignal[], bars: PriceBar[]) {
  const barByDate = new Map(bars.map((bar, index) => [bar.date, { bar, index }]));
  const normalized: TradeSignal[] = [];
  let invalidCount = 0;

  // An indexed loop deliberately counts holes in sparse arrays as malformed signals.
  for (let sourceIndex = 0; sourceIndex < raw.length; sourceIndex += 1) {
    const signal = raw[sourceIndex] as RawSignal | undefined;
    if (!signal || typeof signal !== "object") {
      invalidCount += 1;
      continue;
    }
    const match = barByDate.get(signal.date);
    if (
      !match ||
      (signal.type !== "BUY" && signal.type !== "SELL") ||
      !Number.isFinite(signal.price) ||
      signal.price <= 0 ||
      (signal.reason !== undefined && typeof signal.reason !== "string")
    ) {
      invalidCount += 1;
      continue;
    }

    // Trigger prices may represent an intraday threshold, but must belong to the bar.
    const tolerance = Math.max(match.bar.close * 0.002, 0.02);
    if (signal.price < match.bar.low - tolerance || signal.price > match.bar.high + tolerance) {
      invalidCount += 1;
      continue;
    }

    normalized.push({
      type: signal.type,
      date: signal.date,
      price: signal.price,
      ...(signal.reason ? { reason: signal.reason.slice(0, 180) } : {}),
      id: `signal-${match.index}-${sourceIndex}`,
      barIndex: match.index,
      status: match.index === bars.length - 1 ? "PENDING" : "IGNORED",
    });
  }

  return {
    signals: normalized.sort((a, b) => a.barIndex - b.barIndex),
    invalidCount,
  };
}

export function calculateBuyAndHold(
  bars: PriceBar[],
  startingCapital: number,
): EquityPoint[] {
  if (!bars.length || startingCapital <= 0 || !Number.isFinite(bars[0].open) || bars[0].open <= 0) return [];
  const shares = startingCapital / bars[0].open;
  return bars.map((bar) => {
    const value = shares * bar.close;
    return {
      date: bar.date,
      value,
      returnPct: ((value / startingCapital) - 1) * 100,
    };
  });
}

export function runBacktest(
  strategyId: string,
  bars: PriceBar[],
  rawSignals: RawSignal[],
  settings: RunSettings,
): BacktestResult {
  if (bars.length < 2) throw new Error("At least two market sessions are required.");
  if (!Number.isFinite(settings.startingCapital) || settings.startingCapital <= 0) {
    throw new Error("Starting capital must be greater than zero.");
  }
  if (!Number.isFinite(settings.feePct) || settings.feePct < 0 || settings.feePct >= 100) {
    throw new Error("Fee percentage must be between 0 and 100.");
  }
  if (!Number.isFinite(settings.slippagePct) || settings.slippagePct < 0 || settings.slippagePct >= 100) {
    throw new Error("Slippage percentage must be between 0 and 100.");
  }
  if (!Array.isArray(rawSignals)) throw new Error("Strategy signals must be an array.");
  validateBars(bars);

  const { signals, invalidCount } = normalizeSignals(rawSignals, bars);
  if (invalidCount > 0) {
    throw new Error(
      `${invalidCount} signal(s) had an unknown date, invalid action, invalid metadata, or a trigger price outside that session's range.`,
    );
  }
  const signalsByBar = new Map<number, TradeSignal[]>();
  for (const signal of signals) {
    const list = signalsByBar.get(signal.barIndex) ?? [];
    list.push(signal);
    signalsByBar.set(signal.barIndex, list);
  }

  let cash = settings.startingCapital;
  let shares = 0;
  let openEntry: { date: string; price: number; quantity: number; fee: number } | null = null;
  let pending: TradeSignal | null = null;
  let daysInMarket = 0;
  let peak = settings.startingCapital;
  let maxDrawdownPct = 0;
  const trades: CompletedTrade[] = [];
  const equity: EquityPoint[] = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];

    if (pending) {
      const isBuy = pending.type === "BUY";
      const fillPrice = bar.open * (1 + (isBuy ? 1 : -1) * settings.slippagePct / 100);

      if (isBuy && shares === 0) {
        const feeRate = settings.feePct / 100;
        const notional = cash / (1 + feeRate);
        const fee = notional * feeRate;
        shares = notional / fillPrice;
        cash = 0;
        openEntry = { date: bar.date, price: fillPrice, quantity: shares, fee };
        pending.status = "FILLED";
        pending.fillDate = bar.date;
        pending.fillPrice = fillPrice;
      } else if (!isBuy && shares > 0 && openEntry) {
        const gross = shares * fillPrice;
        const fee = gross * settings.feePct / 100;
        cash = gross - fee;
        const cost = openEntry.quantity * openEntry.price + openEntry.fee;
        const pnl = cash - cost;
        trades.push({
          id: `trade-${trades.length + 1}`,
          entryDate: openEntry.date,
          entryPrice: openEntry.price,
          exitDate: bar.date,
          exitPrice: fillPrice,
          quantity: openEntry.quantity,
          pnl,
          returnPct: (pnl / cost) * 100,
          status: "CLOSED",
        });
        shares = 0;
        openEntry = null;
        pending.status = "FILLED";
        pending.fillDate = bar.date;
        pending.fillPrice = fillPrice;
      } else {
        pending.status = "IGNORED";
      }
      pending = null;
    }

    if (shares > 0) daysInMarket += 1;
    const value = cash + shares * bar.close;
    peak = Math.max(peak, value);
    const drawdown = peak > 0 ? ((value / peak) - 1) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdown);
    equity.push({
      date: bar.date,
      value,
      returnPct: ((value / settings.startingCapital) - 1) * 100,
    });

    const candidates = signalsByBar.get(index) ?? [];
    for (const candidate of candidates) {
      if (pending) {
        candidate.status = "IGNORED";
        continue;
      }
      if ((candidate.type === "BUY" && shares === 0) || (candidate.type === "SELL" && shares > 0)) {
        if (index < bars.length - 1) pending = candidate;
      } else {
        candidate.status = "IGNORED";
      }
    }
  }

  if (openEntry && shares > 0) {
    const finalBar = bars[bars.length - 1];
    const markValue = shares * finalBar.close;
    const cost = openEntry.quantity * openEntry.price + openEntry.fee;
    trades.push({
      id: `trade-${trades.length + 1}`,
      entryDate: openEntry.date,
      entryPrice: openEntry.price,
      quantity: openEntry.quantity,
      pnl: markValue - cost,
      returnPct: ((markValue / cost) - 1) * 100,
      status: "OPEN",
    });
  }

  const finalValue = equity[equity.length - 1].value;
  const closedTrades = trades.filter((trade) => trade.status === "CLOSED");
  const winners = closedTrades.filter((trade) => trade.pnl > 0).length;
  const metrics: BacktestMetrics = {
    totalReturnPct: round(((finalValue / settings.startingCapital) - 1) * 100, 4),
    endingValue: round(finalValue, 2),
    maxDrawdownPct: round(maxDrawdownPct, 4),
    winRatePct: closedTrades.length ? round((winners / closedTrades.length) * 100, 2) : null,
    completedTrades: closedTrades.length,
    totalSignals: signals.length,
    exposurePct: round((daysInMarket / bars.length) * 100, 2),
  };

  return { strategyId, signals, trades, equity, metrics };
}
