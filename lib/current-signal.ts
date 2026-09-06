import type { BacktestResult, PriceBar, TradeSignal } from "./types";

export type CurrentSignalAction = "BUY" | "SELL" | "HOLD" | "WAIT";
export type CurrentSignalStatus = "READY" | "NOT_RUN" | "UPDATING" | "STALE" | "ERROR";
export type CurrentPosition = "LONG" | "FLAT";

export interface CurrentSignalState {
  status: CurrentSignalStatus;
  action: CurrentSignalAction | null;
  position: CurrentPosition | null;
  asOf: string | null;
  signal: TradeSignal | null;
  lastFilledSignal: TradeSignal | null;
  error?: string;
}

interface DeriveCurrentSignalOptions {
  result?: BacktestResult;
  bars: PriceBar[];
  updating?: boolean;
  stale?: boolean;
}

function unavailable(
  status: Exclude<CurrentSignalStatus, "READY">,
  asOf: string | null,
  error?: string,
): CurrentSignalState {
  return {
    status,
    action: null,
    position: null,
    asOf,
    signal: null,
    lastFilledSignal: null,
    ...(error ? { error } : {}),
  };
}

/**
 * Turns the selected backtest's final state into a present-tense research signal.
 * BUY/SELL is reserved for an actionable trigger on the latest completed bar;
 * historical signals resolve to HOLD (long) or WAIT (flat).
 */
export function deriveCurrentSignal({
  result,
  bars,
  updating = false,
  stale = false,
}: DeriveCurrentSignalOptions): CurrentSignalState {
  const latestBar = bars[bars.length - 1];
  const asOf = latestBar?.date ?? null;

  if (updating) return unavailable("UPDATING", asOf);
  if (!result || !latestBar) return unavailable("NOT_RUN", asOf);
  if (result.error) return unavailable("ERROR", asOf, result.error);

  const latestEquityDate = result.equity[result.equity.length - 1]?.date;
  if (stale || latestEquityDate !== latestBar.date) {
    return unavailable("STALE", asOf);
  }

  const position: CurrentPosition = result.trades.some((trade) => trade.status === "OPEN")
    ? "LONG"
    : "FLAT";
  const pending = result.signals.filter(
    (signal) => signal.status === "PENDING" && signal.date === latestBar.date,
  );
  const directions = new Set(pending.map((signal) => signal.type));

  if (directions.size > 1) {
    return unavailable(
      "ERROR",
      asOf,
      "The algorithm produced conflicting BUY and SELL signals on the latest bar.",
    );
  }

  const signal = pending[0] ?? null;
  if (
    signal &&
    ((signal.type === "BUY" && position !== "FLAT") ||
      (signal.type === "SELL" && position !== "LONG"))
  ) {
    return unavailable(
      "ERROR",
      asOf,
      `The latest ${signal.type} signal conflicts with the simulated position state.`,
    );
  }

  let lastFilledSignal: TradeSignal | null = null;
  for (let index = result.signals.length - 1; index >= 0; index -= 1) {
    if (result.signals[index].status === "FILLED") {
      lastFilledSignal = result.signals[index];
      break;
    }
  }

  return {
    status: "READY",
    action: signal?.type ?? (position === "LONG" ? "HOLD" : "WAIT"),
    position,
    asOf,
    signal,
    lastFilledSignal,
  };
}
