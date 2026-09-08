import { NextRequest, NextResponse } from "next/server";
import {
  INTERVAL_OPTIONS,
  intervalLabel,
  isIntervalKey,
  isRangeKey,
  isRangeSupported,
  marketHistoryConfig,
  nearestSupportedRange,
} from "../../../lib/market-options";
import type { IntervalKey, MarketDataResponse, PriceBar } from "../../../lib/types";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;
const INTRADAY_REQUEST_ALIGNMENT_MS = 15 * 60_000;

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        exchangeName?: string;
        timezone?: string;
        exchangeTimezoneName?: string;
        dataGranularity?: string;
        currentTradingPeriod?: {
          regular?: {
            start?: number;
            end?: number;
          };
        };
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function marketTime(date: Date, interval: IntervalKey) {
  return interval === "1d" ? isoDate(date) : date.toISOString();
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * DAY_MS);
}

function requestBoundary(now: Date, interval: IntervalKey) {
  if (interval === "1d") {
    const boundary = new Date(now);
    boundary.setUTCHours(0, 0, 0, 0);
    return boundary;
  }

  return new Date(
    Math.floor(now.getTime() / INTRADAY_REQUEST_ALIGNMENT_MS) *
      INTRADAY_REQUEST_ALIGNMENT_MS,
  );
}

function isCompletedIntradayBar(
  timestamp: number,
  intervalMs: number,
  periodEndMs: number,
  regularPeriod?: { start?: number; end?: number },
) {
  const startedAt = timestamp * 1000;
  let completedAt = startedAt + intervalMs;

  if (
    regularPeriod?.start != null &&
    regularPeriod.end != null &&
    timestamp >= regularPeriod.start
  ) {
    // Yahoo can append a zero-duration quote stamped exactly at the regular
    // close. It is not an interval candle and must never become a signal bar.
    if (timestamp >= regularPeriod.end) return false;
    completedAt = Math.min(completedAt, regularPeriod.end * 1000);
  }

  return completedAt <= periodEndMs;
}

function warningFor(
  interval: IntervalKey,
  adjusted: boolean,
  warmupDays: number,
) {
  const priceWarning = adjusted
    ? "Prices include split and dividend adjustments; volume is unadjusted."
    : interval === "1d"
      ? "Adjusted history was incomplete, so raw prices are used consistently."
      : "Yahoo Finance intraday candles do not include adjusted-close history, so raw OHLC prices and volume are used.";
  const warmupWarning = warmupDays < 400
    ? ` Indicator warmup is limited to ${warmupDays} calendar days by the provider's history window.`
    : "";
  return `${priceWarning}${warmupWarning}`;
}

async function fetchChart(urls: readonly string[], revalidate: number) {
  let lastStatus = 503;
  let lastError: unknown;
  for (let attempt = 0; attempt < urls.length; attempt += 1) {
    try {
      const response = await fetch(urls[attempt], {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 SignalForge/1.0",
        },
        next: { revalidate },
        signal: AbortSignal.timeout(9000),
      });
      lastStatus = response.status;
      if (
        response.ok ||
        (response.status >= 400 && response.status < 500 && response.status !== 429)
      ) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
    if (attempt < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Market data provider returned ${lastStatus}.`);
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  const requestedRange = request.nextUrl.searchParams.get("range") || "1Y";
  const requestedInterval = request.nextUrl.searchParams.get("interval") || "1d";

  if (!/^[A-Z0-9.^=-]{1,15}$/.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid ticker such as AAPL or BRK-B." }, { status: 400 });
  }
  if (!isRangeKey(requestedRange)) {
    return NextResponse.json({ error: "Unsupported duration." }, { status: 400 });
  }
  if (!isIntervalKey(requestedInterval)) {
    const choices = INTERVAL_OPTIONS.map((option) => option.label).join(", ");
    return NextResponse.json(
      { error: `Unsupported interval. Choose ${choices}.` },
      { status: 400 },
    );
  }

  const range = requestedRange;
  const interval = requestedInterval;
  if (!isRangeSupported(interval, range)) {
    const nearestRange = nearestSupportedRange(interval, range);
    return NextResponse.json(
      {
        error: `${range} is unavailable for ${intervalLabel(interval)} candles. Choose ${nearestRange} or a longer interval.`,
      },
      { status: 400 },
    );
  }

  const history = marketHistoryConfig(interval, range);
  const now = new Date();
  // Daily requests stay fixed at UTC midnight. Intraday requests advance on
  // quarter-hour boundaries, keeping cache keys stable without dropping today.
  const periodEnd = requestBoundary(now, interval);
  const periodStart = subtractDays(periodEnd, history.rangeDays);
  const fetchStart = subtractDays(periodEnd, history.historyDays);

  const params = new URLSearchParams({
    period1: String(Math.floor(fetchStart.getTime() / 1000)),
    period2: String(Math.floor(periodEnd.getTime() / 1000)),
    interval,
    events: "div,splits",
    includeAdjustedClose: "true",
  });
  const endpoints = ["query2", "query1"].map(
    (host) => `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`,
  );

  try {
    const response = await fetchChart(endpoints, history.cacheSeconds);
    const payload = (await response.json()) as YahooChart;
    const result = payload.chart?.result?.[0];
    if (!response.ok || !result || payload.chart?.error) {
      const providerStatus = response.status >= 400 && response.status < 500
        ? response.status
        : 502;
      return NextResponse.json(
        { error: payload.chart?.error?.description || `No market data found for ${symbol}.` },
        { status: providerStatus },
      );
    }

    const quote = result.indicators?.quote?.[0];
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
    const timestamps = result.timestamp ?? [];
    if (!quote) {
      return NextResponse.json(
        { error: `Not enough ${intervalLabel(interval).toLowerCase()} history for ${symbol}.` },
        { status: 422 },
      );
    }

    const regularPeriod = result.meta?.currentTradingPeriod?.regular;
    const includedIndices = timestamps.flatMap((timestamp, index) => {
      if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
      if (interval === "1d") {
        return timestamp * 1000 < periodEnd.getTime() ? [index] : [];
      }
      return isCompletedIntradayBar(
        timestamp,
        history.intervalMs,
        periodEnd.getTime(),
        regularPeriod,
      )
        ? [index]
        : [];
    });

    if (includedIndices.length < 2) {
      return NextResponse.json(
        { error: `Not enough completed ${intervalLabel(interval).toLowerCase()} history for ${symbol}.` },
        { status: 422 },
      );
    }

    const hasCompleteAdjustedSeries = includedIndices.every((index) => {
      const rawClose = quote.close?.[index];
      if (rawClose == null) return true;
      const adjustedClose = adjusted?.[index];
      return adjustedClose != null && Number.isFinite(adjustedClose) && adjustedClose > 0;
    });

    const bars: PriceBar[] = [];
    for (const index of includedIndices) {
      const rawOpen = quote.open?.[index];
      const rawHigh = quote.high?.[index];
      const rawLow = quote.low?.[index];
      const rawClose = quote.close?.[index];
      const adjustedClose = hasCompleteAdjustedSeries ? adjusted?.[index] : rawClose;
      const volume = quote.volume?.[index];
      if (
        rawOpen == null || rawHigh == null || rawLow == null || rawClose == null ||
        adjustedClose == null || volume == null ||
        ![rawOpen, rawHigh, rawLow, rawClose, adjustedClose, volume].every(Number.isFinite) || volume < 0
      ) continue;

      const factor = rawClose === 0 ? 1 : adjustedClose / rawClose;
      const bar = {
        date: marketTime(new Date(timestamps[index] * 1000), interval),
        open: rawOpen * factor,
        high: rawHigh * factor,
        low: rawLow * factor,
        close: adjustedClose,
        volume,
      };
      if (
        bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0 &&
        bar.high >= Math.max(bar.open, bar.close) &&
        bar.low <= Math.min(bar.open, bar.close)
      ) bars.push(bar);
    }

    const uniqueBars = Array.from(new Map(bars.map((bar) => [bar.date, bar])).values())
      .sort((a, b) => a.date.localeCompare(b.date));
    const formattedPeriodStart = marketTime(periodStart, interval);
    const selectedBars = uniqueBars.filter((bar) => bar.date >= formattedPeriodStart);
    if (selectedBars.length < 2) {
      return NextResponse.json(
        { error: `Not enough completed ${intervalLabel(interval).toLowerCase()} data in the selected ${range} period.` },
        { status: 422 },
      );
    }

    const body: MarketDataResponse = {
      symbol: result.meta?.symbol || symbol,
      interval,
      bars: uniqueBars,
      periodStart: formattedPeriodStart,
      meta: {
        currency: result.meta?.currency || "USD",
        exchange: result.meta?.exchangeName || "Market",
        timezone: result.meta?.exchangeTimezoneName || result.meta?.timezone || "America/New_York",
        provider: "Yahoo Finance",
        fetchedAt: now.toISOString(),
        adjusted: hasCompleteAdjustedSeries,
        warning: warningFor(interval, hasCompleteAdjustedSeries, history.warmupDays),
      },
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": `public, s-maxage=${history.cacheSeconds}, stale-while-revalidate=${history.staleWhileRevalidateSeconds}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data is temporarily unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
