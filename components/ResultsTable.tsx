"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import type { BacktestResult, StrategyDefinition } from "@/lib/types";

export interface ResultsTableProps {
  strategies: StrategyDefinition[];
  results: BacktestResult[];
  benchmarkReturn: number;
  selectedId: string | null;
  onSelect: (strategyId: string) => void;
}

type ResultStatus = {
  className: string;
  label: string;
  detail?: string;
  icon: typeof CheckCircle2;
};

const EMPTY_VALUE = "—";

function formatPercent(value: number | null | undefined, signed = false) {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;

  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  const sign = signed && normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(2)}%`;
}

function metricTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.005) {
    return "is-neutral";
  }
  return value > 0 ? "is-positive" : "is-negative";
}

function resultStatus(
  strategy: StrategyDefinition,
  result: BacktestResult | undefined,
): ResultStatus {
  if (!strategy.enabled) {
    return {
      className: "is-muted",
      label: "Disabled",
      icon: Minus,
    };
  }

  if (!result) {
    return {
      className: "is-muted",
      label: "Not run",
      icon: Minus,
    };
  }

  if (result.error) {
    return {
      className: "is-error",
      label: "Run failed",
      detail: result.error,
      icon: AlertTriangle,
    };
  }

  if (result.trades.length === 0) {
    return {
      className: "is-muted",
      label: "No trades",
      icon: Minus,
    };
  }

  if (result.trades.some((trade) => trade.status === "OPEN")) {
    return {
      className: "is-open",
      label: "Position open",
      icon: TrendingUp,
    };
  }

  return {
    className: "is-complete",
    label: "Complete",
    icon: CheckCircle2,
  };
}

function SortableLabel({ children }: { children: string }) {
  return <span className="results-table__heading-label">{children}</span>;
}

export function ResultsTable({
  strategies,
  results,
  benchmarkReturn,
  selectedId,
  onSelect,
}: ResultsTableProps) {
  const resultsByStrategy = new Map(
    results.map((result) => [result.strategyId, result]),
  );

  return (
    <section className="results-table" aria-labelledby="results-table-title">
      <div className="results-table__header">
        <div>
          <p className="results-table__eyebrow">Strategy comparison</p>
          <h2 className="results-table__title" id="results-table-title">
            Performance overview
          </h2>
        </div>
        <div className="results-table__benchmark" aria-label={`Buy and hold return ${formatPercent(benchmarkReturn, true)}`}>
          <span>Buy &amp; hold</span>
          <strong className={metricTone(benchmarkReturn)}>
            {formatPercent(benchmarkReturn, true)}
          </strong>
        </div>
      </div>

      <div
        className="results-table__scroller"
        role="region"
        aria-label="Return comparison results"
        tabIndex={0}
      >
        <table className="results-table__table">
          <caption className="results-table__caption">
            Algorithm results compared with the buy and hold benchmark. Select a
            strategy to inspect its trades and signals.
          </caption>
          <thead>
            <tr>
              <th scope="col">Algorithm</th>
              <th scope="col"><SortableLabel>Return</SortableLabel></th>
              <th scope="col"><SortableLabel>vs. benchmark</SortableLabel></th>
              <th scope="col"><SortableLabel>Trades</SortableLabel></th>
              <th scope="col"><SortableLabel>Win rate</SortableLabel></th>
              <th scope="col"><SortableLabel>Max drawdown</SortableLabel></th>
            </tr>
          </thead>
          <tbody>
            {strategies.map((strategy) => {
              const result = resultsByStrategy.get(strategy.id);
              const hasMetrics = Boolean(result && !result.error);
              const metrics = hasMetrics ? result?.metrics : undefined;
              const returnPct = metrics?.totalReturnPct;
              const benchmarkDelta =
                returnPct != null && Number.isFinite(benchmarkReturn)
                  ? returnPct - benchmarkReturn
                  : undefined;
              const status = resultStatus(strategy, result);
              const StatusIcon = status.icon;
              const selected = strategy.id === selectedId;

              return (
                <tr
                  className={`results-table__row${selected ? " is-selected" : ""}${result?.error ? " has-error" : ""}`}
                  data-selected={selected || undefined}
                  key={strategy.id}
                >
                  <th scope="row" className="results-table__strategy-cell">
                    <button
                      type="button"
                      className="results-table__select"
                      aria-pressed={selected}
                      aria-label={`View results for ${strategy.name}`}
                      onClick={() => onSelect(strategy.id)}
                    >
                      <span
                        aria-hidden="true"
                        className="results-table__strategy-dot"
                        style={{ backgroundColor: strategy.color }}
                      />
                      <span className="results-table__strategy-copy">
                        <span className="results-table__strategy-name">
                          {strategy.name}
                        </span>
                        <span
                          className={`results-table__status ${status.className}`}
                          title={status.detail}
                        >
                          <StatusIcon aria-hidden="true" size={12} strokeWidth={2} />
                          {status.label}
                          {status.detail && (
                            <span className="results-table__error-detail">
                              {`: ${status.detail}`}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </th>

                  <td>
                    <span className={`results-table__metric ${metricTone(returnPct)}`}>
                      {returnPct != null && returnPct > 0 ? (
                        <TrendingUp aria-hidden="true" size={15} />
                      ) : returnPct != null && returnPct < 0 ? (
                        <TrendingDown aria-hidden="true" size={15} />
                      ) : null}
                      {formatPercent(returnPct, true)}
                    </span>
                  </td>
                  <td>
                    <span className={`results-table__metric ${metricTone(benchmarkDelta)}`}>
                      {formatPercent(benchmarkDelta, true)}
                    </span>
                  </td>
                  <td className="results-table__number">
                    {metrics ? metrics.completedTrades.toLocaleString() : EMPTY_VALUE}
                  </td>
                  <td className="results-table__number">
                    {formatPercent(metrics?.winRatePct)}
                  </td>
                  <td>
                    <span className="results-table__metric is-drawdown">
                      {formatPercent(metrics?.maxDrawdownPct)}
                    </span>
                  </td>
                </tr>
              );
            })}

            {strategies.length === 0 && (
              <tr>
                <td className="results-table__empty" colSpan={6}>
                  Add and run an algorithm to see its performance here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default ResultsTable;
