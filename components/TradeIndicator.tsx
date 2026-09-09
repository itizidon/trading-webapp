import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  LoaderCircle,
  Pause,
  RefreshCw,
} from "lucide-react";

import type { CurrentSignalState } from "@/lib/current-signal";
import type { IntervalKey, RangeKey, StrategyDefinition } from "@/lib/types";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const INTERVAL_LABELS: Record<IntervalKey, string> = {
  "1d": "Daily",
  "15m": "15 min",
  "30m": "30 min",
  "1h": "Hourly",
};

interface TradeIndicatorProps {
  currency: string;
  indicator: CurrentSignalState;
  interval: IntervalKey;
  range: RangeKey;
  strategy: StrategyDefinition;
  symbol: string;
  timeZone?: string;
}

function makeDateFormatter(
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: timeZone || "UTC",
    });
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }
}

function formatDate(
  value: string | undefined | null,
  interval: IntervalKey,
  timeZone?: string,
) {
  if (!value) return null;
  const dateOnly = DATE_ONLY_PATTERN.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;

  const formatter = makeDateFormatter({
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(interval !== "1d" && !dateOnly
      ? {
          hour: "numeric" as const,
          minute: "2-digit" as const,
          timeZoneName: "short" as const,
        }
      : {}),
  }, interval === "1d" || dateOnly ? "UTC" : timeZone);

  return formatter.format(date);
}

export default function TradeIndicator({
  currency,
  indicator,
  interval,
  range,
  strategy,
  symbol,
  timeZone,
}: TradeIndicatorProps) {
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let badge = "NOT RUN";
  let headline = "Run the backtest to calculate a signal";
  const intervalLabel = INTERVAL_LABELS[interval];
  let detail = `The indicator uses the latest completed ${intervalLabel.toLowerCase()} bar for the selected algorithm.`;
  let tone = "idle";
  let Icon = Activity;

  if (indicator.status === "UPDATING") {
    badge = "UPDATING";
    headline = `Recalculating ${strategy.name}`;
    detail = "The previous signal is hidden until fresh market data and strategy results are ready.";
    tone = "updating";
    Icon = LoaderCircle;
  } else if (indicator.status === "STALE") {
    badge = "RUN AGAIN";
    headline = "This signal is out of date";
    detail = "The ticker, range, interval, or algorithm changed—or the latest refresh failed. Run again to update it.";
    tone = "stale";
    Icon = RefreshCw;
  } else if (indicator.status === "ERROR") {
    badge = "UNAVAILABLE";
    headline = "No reliable signal is available";
    detail = indicator.error || "The selected algorithm could not produce a current signal.";
    tone = "error";
    Icon = AlertTriangle;
  } else if (indicator.status === "READY") {
    badge = indicator.action ?? "WAIT";
    tone = badge.toLowerCase();

    if (indicator.action === "BUY") {
      headline = "Buy signal for the next bar open";
      detail = indicator.signal?.reason || "The strategy's entry condition was met at the latest bar close.";
      Icon = ArrowUpRight;
    } else if (indicator.action === "SELL") {
      headline = "Sell signal for the next bar open";
      detail = indicator.signal?.reason || "The strategy's exit condition was met at the latest bar close.";
      Icon = ArrowDownRight;
    } else if (indicator.action === "HOLD") {
      const entry = indicator.lastFilledSignal;
      const entryTime = formatDate(entry?.fillDate, interval, timeZone);
      headline = "Hold the simulated position";
      detail = entryTime && entry?.fillPrice != null
        ? `No sell trigger on the latest bar close. The last buy filled ${entryTime} at ${money.format(entry.fillPrice)}.`
        : "No sell trigger was produced on the latest bar close; the simulated position remains open.";
      Icon = Pause;
    } else {
      const exit = indicator.lastFilledSignal;
      const exitTime = formatDate(exit?.fillDate, interval, timeZone);
      headline = "Wait for the next entry";
      detail = exit?.type === "SELL" && exitTime && exit.fillPrice != null
        ? `No buy trigger on the latest bar close. The last sell filled ${exitTime} at ${money.format(exit.fillPrice)}.`
        : "No buy trigger was produced on the latest bar close; the strategy remains in cash.";
      Icon = Clock3;
    }
  }

  const asOf = formatDate(indicator.asOf, interval, timeZone);
  const triggerPrice = indicator.signal?.price;
  const waitingTarget = indicator.status === "READY"
    ? indicator.action === "WAIT"
      ? "BUY"
      : indicator.action === "HOLD"
        ? "SELL"
        : null
    : null;

  return (
    <section
      className={`trade-indicator trade-indicator--${tone}`}
      aria-label={`Selected algorithm signal: ${badge}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="trade-indicator__action">
        <span className="trade-indicator__icon" aria-hidden="true">
          <Icon className={indicator.status === "UPDATING" ? "spin" : undefined} size={20} />
        </span>
        <div>
          <span>Selected algorithm signal</span>
          <strong>{badge}</strong>
          {waitingTarget && (
            <span className="trade-indicator__target">
              Target: <b>{waitingTarget}</b>
            </span>
          )}
        </div>
      </div>

      <div className="trade-indicator__copy">
        <strong>{headline}</strong>
        <span>{detail}</span>
      </div>

      <div className="trade-indicator__meta">
        <span className="trade-indicator__strategy">
          <i style={{ backgroundColor: strategy.color }} aria-hidden="true" />
          {strategy.name}
        </span>
        <span>{symbol} · {range} · {intervalLabel} bars</span>
        {asOf && <span>As of {asOf} bar close</span>}
        {triggerPrice != null && <span>Trigger {money.format(triggerPrice)}</span>}
        <small>Historical research signal · not a live trade alert</small>
      </div>
    </section>
  );
}
