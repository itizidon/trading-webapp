"use client";

import { useId, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  BacktestResult,
  EquityPoint,
  PriceBar,
  StrategyDefinition,
} from "@/lib/types";

type ChartMode = "return" | "value";

export interface PerformanceChartProps {
  bars: PriceBar[];
  results: BacktestResult[];
  strategies: StrategyDefinition[];
  /** Preferred short-form selection prop used by the studio. */
  selectedId?: string | null;
  /** Backwards-compatible descriptive alias for selectedId. */
  selectedStrategyId?: string | null;
  benchmark: EquityPoint[];
  initialMode?: ChartMode;
  currency?: string;
  className?: string;
}

interface PlottablePoint extends EquityPoint {
  timestamp: number;
}

interface ChartSeries {
  id: string;
  name: string;
  color: string;
  points: PlottablePoint[];
  benchmark: boolean;
}

const WIDTH = 960;
const HEIGHT = 360;
const MARGIN = { top: 22, right: 22, bottom: 42, left: 68 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const BENCHMARK_ID = "__buy-and-hold__";
const FALLBACK_COLORS = [
  "#8b7cff",
  "#2dd4bf",
  "#f7b955",
  "#fb7185",
  "#60a5fa",
  "#c084fc",
  "#a3e635",
  "#fb923c",
];

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function timestampFor(date: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date}T00:00:00Z`
    : date;
  return Date.parse(normalized);
}

function toPoints(points: EquityPoint[]): PlottablePoint[] {
  return points
    .map((point) => ({ ...point, timestamp: timestampFor(point.date) }))
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) &&
        Number.isFinite(point.value) &&
        Number.isFinite(point.returnPct),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function niceStep(range: number, targetTicks = 5) {
  const rough = Math.max(range, Number.EPSILON) / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return factor * magnitude;
}

function makeYScale(values: number[], includeZero: boolean) {
  let low = Math.min(...values);
  let high = Math.max(...values);

  if (includeZero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }

  if (low === high) {
    const pad = Math.max(Math.abs(low) * 0.05, 1);
    low -= pad;
    high += pad;
  }

  const step = niceStep(high - low);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];

  for (let value = min; value <= max + step * 0.25; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }

  const scale = (value: number) =>
    MARGIN.top + ((max - value) / Math.max(max - min, Number.EPSILON)) * PLOT_HEIGHT;

  return { min, max, ticks, scale };
}

function nearestNumber(sortedValues: number[], target: number) {
  if (!sortedValues.length) return null;
  let low = 0;
  let high = sortedValues.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] < target) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return sortedValues[0];
  const before = sortedValues[low - 1];
  const after = sortedValues[low];
  return Math.abs(target - before) <= Math.abs(after - target) ? before : after;
}

function nearestPoint(points: PlottablePoint[], target: number) {
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].timestamp < target) low = middle + 1;
    else high = middle;
  }

  if (low === 0) return points[0];
  const before = points[low - 1];
  const after = points[low];
  return Math.abs(target - before.timestamp) <= Math.abs(after.timestamp - target)
    ? before
    : after;
}

function pathFor(
  points: PlottablePoint[],
  xScale: (timestamp: number) => number,
  yScale: (value: number) => number,
  mode: ChartMode,
) {
  return points
    .map((point, index) => {
      const x = xScale(point.timestamp).toFixed(2);
      const y = yScale(mode === "return" ? point.returnPct : point.value).toFixed(2);
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

function truncate(value: string, length = 21) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export default function PerformanceChart({
  bars,
  results,
  strategies,
  selectedId: selectedIdProp,
  selectedStrategyId,
  benchmark,
  initialMode = "return",
  currency = "USD",
  className,
}: PerformanceChartProps) {
  const externalSelection =
    selectedStrategyId !== undefined ? selectedStrategyId : selectedIdProp ?? null;
  const [mode, setMode] = useState<ChartMode>(initialMode);
  const [hiddenSeriesIds, setHiddenSeriesIds] = useState<string[]>([]);
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const selectedId = externalSelection;

  const series = useMemo<ChartSeries[]>(() => {
    const resultById = new Map(results.map((result) => [result.strategyId, result]));
    const knownIds = new Set(strategies.map((strategy) => strategy.id));
    const plotted: ChartSeries[] = [];

    for (const strategy of strategies) {
      if (!strategy.enabled) continue;
      const result = resultById.get(strategy.id);
      if (!result || result.error || !result.equity.length) continue;
      plotted.push({
        id: strategy.id,
        name: strategy.name,
        color: strategy.color,
        points: toPoints(result.equity),
        benchmark: false,
      });
    }

    for (const result of results) {
      if (knownIds.has(result.strategyId) || result.error || !result.equity.length) continue;
      plotted.push({
        id: result.strategyId,
        name: result.strategyId,
        color: FALLBACK_COLORS[plotted.length % FALLBACK_COLORS.length],
        points: toPoints(result.equity),
        benchmark: false,
      });
    }

    const benchmarkPoints = toPoints(benchmark);
    if (benchmarkPoints.length) {
      plotted.push({
        id: BENCHMARK_ID,
        name: "Buy & hold",
        color: "#94a3b8",
        points: benchmarkPoints,
        benchmark: true,
      });
    }

    return plotted.filter((item) => item.points.length > 0);
  }, [benchmark, results, strategies]);

  const visibleSeries = useMemo(
    () => series.filter((item) => !hiddenSeriesIds.includes(item.id)),
    [hiddenSeriesIds, series],
  );

  const timeline = useMemo(() => {
    const times = bars
      .map((bar) => timestampFor(bar.date))
      .filter(Number.isFinite);
    if (!times.length) {
      for (const item of series) {
        for (const point of item.points) times.push(point.timestamp);
      }
    }
    return [...new Set(times)].sort((a, b) => a - b);
  }, [bars, series]);

  const closeByTime = useMemo(
    () =>
      new Map(
        bars
          .map((bar) => [timestampFor(bar.date), bar.close] as const)
          .filter(([timestamp, close]) => Number.isFinite(timestamp) && Number.isFinite(close)),
      ),
    [bars],
  );

  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }),
    [currency],
  );
  const compactMoneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [currency],
  );

  const allValues = visibleSeries.flatMap((item) =>
    item.points.map((point) => (mode === "return" ? point.returnPct : point.value)),
  );
  const hasChart = timeline.length > 0 && allValues.length > 0;
  const xMin = timeline[0] ?? 0;
  const xMax = timeline[timeline.length - 1] ?? xMin + 1;
  const xScale = (timestamp: number) => {
    if (xMax === xMin) return MARGIN.left + PLOT_WIDTH / 2;
    return MARGIN.left + ((timestamp - xMin) / (xMax - xMin)) * PLOT_WIDTH;
  };
  const y = hasChart ? makeYScale(allValues, mode === "return") : null;

  const xTicks = useMemo(() => {
    if (!timeline.length) return [];
    const count = Math.min(6, timeline.length);
    return Array.from({ length: count }, (_, index) => {
      const timelineIndex = Math.round((index * (timeline.length - 1)) / Math.max(count - 1, 1));
      return timeline[timelineIndex];
    }).filter((value, index, values) => index === 0 || value !== values[index - 1]);
  }, [timeline]);

  const rangeInDays = (xMax - xMin) / 86_400_000;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        ...(rangeInDays < 180 ? { day: "numeric" as const } : { year: "2-digit" as const }),
        timeZone: "UTC",
      }),
    [rangeInDays],
  );
  const tooltipDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    [],
  );

  const visibleHoverSeries = useMemo(() => {
    if (!visibleSeries.length) return [];
    const ordered = [...visibleSeries].sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      if (a.benchmark) return -1;
      if (b.benchmark) return 1;
      return 0;
    });
    return ordered.slice(0, 6);
  }, [selectedId, visibleSeries]);

  const hoveredClose = hoverTimestamp === null ? null : closeByTime.get(hoverTimestamp) ?? null;
  const tooltipRows =
    hoverTimestamp === null
      ? []
      : visibleHoverSeries.flatMap((item) => {
          const point = nearestPoint(item.points, hoverTimestamp);
          return point ? [{ item, point }] : [];
        });

  const hoverX = hoverTimestamp === null ? null : xScale(hoverTimestamp);
  const tooltipWidth = 238;
  const overflowCount = Math.max(0, visibleSeries.length - tooltipRows.length);
  const tooltipHeight = 48 + tooltipRows.length * 21 + (overflowCount ? 19 : 0);
  const tooltipX =
    hoverX === null
      ? 0
      : hoverX > WIDTH - MARGIN.right - tooltipWidth - 20
        ? hoverX - tooltipWidth - 14
        : hoverX + 14;
  const tooltipY = MARGIN.top + 8;

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!timeline.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * WIDTH;
    const ratio = Math.max(0, Math.min(1, (svgX - MARGIN.left) / PLOT_WIDTH));
    const target = xMin + ratio * (xMax - xMin);
    setHoverTimestamp(nearestNumber(timeline, target));
  }

  function handleLegendClick(item: ChartSeries) {
    setHiddenSeriesIds((current) =>
      current.includes(item.id)
        ? current.filter((seriesId) => seriesId !== item.id)
        : [...current, item.id],
    );
  }

  function formatAxisValue(value: number) {
    if (mode === "value") return compactMoneyFormatter.format(value);
    const precision = Math.abs(value) < 10 && value !== 0 ? 1 : 0;
    return `${value.toFixed(precision)}%`;
  }

  function formatTooltipValue(point: EquityPoint) {
    if (mode === "value") return moneyFormatter.format(point.value);
    const prefix = point.returnPct > 0 ? "+" : "";
    return `${prefix}${point.returnPct.toFixed(2)}%`;
  }

  return (
    <section className={classes("performance-chart", className)}>
      <div className="performance-chart__toolbar">
        <div className="performance-chart__heading">
          <h3 className="performance-chart__title">Performance</h3>
          <p className="performance-chart__subtitle">Compare every strategy across the selected period.</p>
        </div>
        <div className="performance-chart__metric-toggle" aria-label="Chart metric">
          <button
            type="button"
            className={classes("performance-chart__metric-button", mode === "return" && "is-active")}
            aria-pressed={mode === "return"}
            onClick={() => setMode("return")}
          >
            Return %
          </button>
          <button
            type="button"
            className={classes("performance-chart__metric-button", mode === "value" && "is-active")}
            aria-pressed={mode === "value"}
            onClick={() => setMode("value")}
          >
            Portfolio value
          </button>
        </div>
      </div>

      {series.length > 0 && (
        <div className="performance-chart__legend" aria-label="Chart series">
          {series.map((item) => {
            const isHidden = hiddenSeriesIds.includes(item.id);
            const isSelected = !isHidden && item.id === selectedId;
            const isMuted = isHidden || Boolean(selectedId && !isSelected && !item.benchmark);
            return (
              <button
                key={item.id}
                type="button"
                className={classes(
                  "performance-chart__legend-button",
                  isSelected && "is-selected",
                  isMuted && "is-muted",
                  isHidden && "is-hidden",
                  item.benchmark && "is-benchmark",
                )}
                aria-pressed={!isHidden}
                onClick={() => handleLegendClick(item)}
                title={`${isHidden ? "Show" : "Hide"} ${item.name}`}
              >
                <span
                  className="performance-chart__legend-swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                {item.name}
              </button>
            );
          })}
        </div>
      )}

      {!hasChart || !y ? (
        <div className="performance-chart__empty">
          <span className="performance-chart__empty-kicker">
            {series.length ? "All series hidden" : "No performance data"}
          </span>
          <p>
            {series.length
              ? "Choose a strategy in the legend to show it again."
              : "Run your strategies to compare their equity curves."}
          </p>
        </div>
      ) : (
        <div className="performance-chart__plot-shell">
          <svg
            className="performance-chart__svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-labelledby={`${id}-title ${id}-description`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverTimestamp(null)}
            style={{ display: "block", width: "100%", height: "auto", touchAction: "pan-y" }}
          >
            <title id={`${id}-title`}>
              {mode === "return" ? "Strategy return comparison" : "Strategy portfolio value comparison"}
            </title>
            <desc id={`${id}-description`}>
              A multi-line chart comparing {visibleSeries.length} performance series over time.
            </desc>
            <defs>
              <clipPath id={`${id}-plot-clip`}>
                <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_WIDTH} height={PLOT_HEIGHT} />
              </clipPath>
              <linearGradient id={`${id}-selected-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={visibleSeries.find((item) => item.id === selectedId)?.color ?? "#8b7cff"}
                  stopOpacity="0.18"
                />
                <stop
                  offset="100%"
                  stopColor={visibleSeries.find((item) => item.id === selectedId)?.color ?? "#8b7cff"}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>

            <text
              x={MARGIN.left}
              y={12}
              className="performance-chart__axis-caption"
              fill="var(--text-faint, #64748b)"
              fontSize="10"
              fontWeight="700"
              letterSpacing="0.12em"
            >
              {mode === "return" ? "RETURN" : "VALUE"}
            </text>

            {y.ticks.map((tick) => {
              const tickY = y.scale(tick);
              const isZero = mode === "return" && Math.abs(tick) < 1e-9;
              return (
                <g key={tick} className={classes("performance-chart__grid-row", isZero && "is-zero")}>
                  <line
                    x1={MARGIN.left}
                    x2={WIDTH - MARGIN.right}
                    y1={tickY}
                    y2={tickY}
                    stroke={isZero ? "var(--chart-zero, #526179)" : "var(--chart-grid, #243047)"}
                    strokeOpacity={isZero ? 0.75 : 0.48}
                    strokeDasharray={isZero ? undefined : "3 6"}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={MARGIN.left - 12}
                    y={tickY + 4}
                    textAnchor="end"
                    className="performance-chart__axis-label"
                    fill="var(--text-muted, #8290a7)"
                    fontSize="11"
                  >
                    {formatAxisValue(tick)}
                  </text>
                </g>
              );
            })}

            {xTicks.map((tick, index) => (
              <g key={tick} className="performance-chart__x-tick">
                <line
                  x1={xScale(tick)}
                  x2={xScale(tick)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + PLOT_HEIGHT}
                  stroke="var(--chart-grid, #243047)"
                  strokeOpacity="0.18"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={xScale(tick)}
                  y={HEIGHT - 14}
                  textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
                  className="performance-chart__axis-label"
                  fill="var(--text-muted, #8290a7)"
                  fontSize="11"
                >
                  {dateFormatter.format(new Date(tick))}
                </text>
              </g>
            ))}

            <g clipPath={`url(#${id}-plot-clip)`}>
              {visibleSeries.map((item) => {
                if (item.id !== selectedId) return null;
                const line = pathFor(item.points, xScale, y.scale, mode);
                if (!line) return null;
                const baseline = mode === "return" ? y.scale(0) : MARGIN.top + PLOT_HEIGHT;
                const first = item.points[0];
                const last = item.points[item.points.length - 1];
                return (
                  <path
                    key={`${item.id}-area`}
                    className="performance-chart__selected-area"
                    d={`${line} L${xScale(last.timestamp).toFixed(2)},${baseline.toFixed(2)} L${xScale(first.timestamp).toFixed(2)},${baseline.toFixed(2)} Z`}
                    fill={`url(#${id}-selected-fill)`}
                    style={{ color: item.color }}
                  />
                );
              })}

              {visibleSeries.map((item) => {
                const isSelected = item.id === selectedId;
                const isMuted = Boolean(selectedId && !isSelected && !item.benchmark);
                return (
                  <path
                    key={item.id}
                    className={classes(
                      "performance-chart__line",
                      isSelected && "is-selected",
                      isMuted && "is-muted",
                      item.benchmark && "is-benchmark",
                    )}
                    d={pathFor(item.points, xScale, y.scale, mode)}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={isSelected ? 2.8 : item.benchmark ? 1.6 : 2}
                    strokeOpacity={isMuted ? 0.22 : item.benchmark && selectedId ? 0.55 : 1}
                    strokeDasharray={item.benchmark ? "7 6" : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

              {hoverX !== null && (
                <line
                  className="performance-chart__crosshair"
                  x1={hoverX}
                  x2={hoverX}
                  y1={MARGIN.top}
                  y2={MARGIN.top + PLOT_HEIGHT}
                  stroke="var(--chart-crosshair, #91a0b8)"
                  strokeOpacity="0.65"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}

              {hoverTimestamp !== null &&
                visibleSeries.map((item) => {
                  const point = nearestPoint(item.points, hoverTimestamp);
                  if (!point) return null;
                  const pointValue = mode === "return" ? point.returnPct : point.value;
                  const isSelected = item.id === selectedId;
                  return (
                    <circle
                      key={`${item.id}-hover`}
                      className="performance-chart__hover-dot"
                      cx={xScale(point.timestamp)}
                      cy={y.scale(pointValue)}
                      r={isSelected ? 4.5 : 3.25}
                      fill="var(--chart-surface, #0d1421)"
                      stroke={item.color}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  );
                })}
            </g>

            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              fill="transparent"
              className="performance-chart__interaction-layer"
            />

            {hoverTimestamp !== null && hoverX !== null && (
              <g
                className="performance-chart__tooltip"
                transform={`translate(${tooltipX}, ${tooltipY})`}
                pointerEvents="none"
              >
                <rect
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx="10"
                  fill="var(--tooltip-bg, #111a2a)"
                  stroke="var(--tooltip-border, #314059)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x="13"
                  y="19"
                  fill="var(--text-primary, #f4f7fb)"
                  fontSize="11"
                  fontWeight="700"
                >
                  {tooltipDateFormatter.format(new Date(hoverTimestamp))}
                </text>
                {hoveredClose !== null && (
                  <text
                    x={tooltipWidth - 13}
                    y="19"
                    textAnchor="end"
                    fill="var(--text-muted, #9aa7bb)"
                    fontSize="10"
                  >
                    Close {moneyFormatter.format(hoveredClose)}
                  </text>
                )}
                <line
                  x1="13"
                  x2={tooltipWidth - 13}
                  y1="30"
                  y2="30"
                  stroke="var(--tooltip-border, #314059)"
                  strokeOpacity="0.72"
                  vectorEffect="non-scaling-stroke"
                />
                {tooltipRows.map(({ item, point }, index) => (
                  <g key={item.id} transform={`translate(0, ${45 + index * 21})`}>
                    <circle cx="15" cy="0" r="3" fill={item.color} />
                    <text x="25" y="4" fill="var(--text-muted, #a8b3c5)" fontSize="10.5">
                      {truncate(item.name)}
                    </text>
                    <text
                      x={tooltipWidth - 13}
                      y="4"
                      textAnchor="end"
                      fill="var(--text-primary, #f4f7fb)"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      {formatTooltipValue(point)}
                    </text>
                  </g>
                ))}
                {overflowCount > 0 && (
                  <text
                    x="13"
                    y={45 + tooltipRows.length * 21}
                    fill="var(--text-faint, #718096)"
                    fontSize="10"
                  >
                    +{overflowCount} more series in this chart
                  </text>
                )}
              </g>
            )}
          </svg>
        </div>
      )}
    </section>
  );
}
