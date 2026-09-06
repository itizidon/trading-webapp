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
import type { RangeKey, StrategyDefinition } from "@/lib/types";

interface TradeIndicatorProps {
  currency: string;
  indicator: CurrentSignalState;
  range: RangeKey;
  strategy: StrategyDefinition;
  symbol: string;
}

function formatDate(value: string | undefined | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function TradeIndicator({
  currency,
  indicator,
  range,
  strategy,
  symbol,
}: TradeIndicatorProps) {
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let badge = "NOT RUN";
  let headline = "Run the backtest to calculate a signal";
  let detail = "The indicator uses the latest completed daily bar for the selected algorithm.";
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
    detail = "The ticker, range, or algorithm changed—or the latest refresh failed. Run again to update it.";
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
      headline = "Buy signal for the next session open";
      detail = indicator.signal?.reason || "The strategy's entry condition was met at the latest close.";
      Icon = ArrowUpRight;
    } else if (indicator.action === "SELL") {
      headline = "Sell signal for the next session open";
      detail = indicator.signal?.reason || "The strategy's exit condition was met at the latest close.";
      Icon = ArrowDownRight;
    } else if (indicator.action === "HOLD") {
      const entry = indicator.lastFilledSignal;
      headline = "Hold the simulated position";
      detail = entry?.fillDate && entry.fillPrice
        ? `No sell trigger on the latest close. The last buy filled ${formatDate(entry.fillDate)} at ${money.format(entry.fillPrice)}.`
        : "No sell trigger was produced on the latest close; the simulated position remains open.";
      Icon = Pause;
    } else {
      const exit = indicator.lastFilledSignal;
      headline = "Wait for the next entry";
      detail = exit?.type === "SELL" && exit.fillDate && exit.fillPrice
        ? `No buy trigger on the latest close. The last sell filled ${formatDate(exit.fillDate)} at ${money.format(exit.fillPrice)}.`
        : "No buy trigger was produced on the latest close; the strategy remains in cash.";
      Icon = Clock3;
    }
  }

  const asOf = formatDate(indicator.asOf);
  const triggerPrice = indicator.signal?.price;

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
        <span>{symbol} · {range} daily bars</span>
        {asOf && <span>As of {asOf} close</span>}
        {triggerPrice != null && <span>Trigger {money.format(triggerPrice)}</span>}
        <small>Historical research signal · not a live trade alert</small>
      </div>
    </section>
  );
}
