import { NextRequest, NextResponse } from "next/server";
import type { MarketDataResponse, PriceBar, RangeKey } from "@/lib/types";

export const runtime = "nodejs";

const RANGE_DAYS: Record<RangeKey, number> = {
  "1M": 31,
  "3M": 93,
  "6M": 186,
  "1Y": 366,
  "3Y": 1096,
  "5Y": 1827,
};

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        exchangeName?: string;
        timezone?: string;
        exchangeTimezoneName?: string;
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

async function fetchChart(url: string) {
  let lastStatus = 503;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 SignalForge/1.0",
        },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(9000),
      });
      lastStatus = response.status;
      if (response.ok || response.status === 404) return response;
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw lastError;
  throw new Error(`Market data provider returned ${lastStatus}.`);
}

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  const range = (request.nextUrl.searchParams.get("range") || "1Y") as RangeKey;

  if (!/^[A-Z0-9.^=-]{1,15}$/.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid ticker such as AAPL or BRK-B." }, { status: 400 });
  }
  if (!Object.hasOwn(RANGE_DAYS, range)) {
    return NextResponse.json({ error: "Unsupported duration." }, { status: 400 });
  }

  // Fixed UTC boundaries keep the upstream cache key stable and omit today's partial candle.
  const periodEnd = new Date();
  periodEnd.setUTCHours(0, 0, 0, 0);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - RANGE_DAYS[range]);
  const fetchStart = new Date(periodStart);
  // Roughly 280 sessions of warmup supports common long-lookback indicators.
  fetchStart.setUTCDate(fetchStart.getUTCDate() - 400);

  const params = new URLSearchParams({
    period1: String(Math.floor(fetchStart.getTime() / 1000)),
    period2: String(Math.floor(periodEnd.getTime() / 1000)),
    interval: "1d",
    events: "div,splits",
    includeAdjustedClose: "true",
  });
  const endpoint = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

  try {
    const response = await fetchChart(endpoint);
    const payload = (await response.json()) as YahooChart;
    const result = payload.chart?.result?.[0];
    if (!result || payload.chart?.error) {
      return NextResponse.json(
        { error: payload.chart?.error?.description || `No market data found for ${symbol}.` },
        { status: 404 },
      );
    }

    const quote = result.indicators?.quote?.[0];
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
    const timestamps = result.timestamp ?? [];
    if (!quote || timestamps.length < 2) {
      return NextResponse.json({ error: `Not enough daily history for ${symbol}.` }, { status: 422 });
    }

    const hasCompleteAdjustedSeries = timestamps.every((_, index) => {
      const rawClose = quote.close?.[index];
      if (rawClose == null) return true;
      const adjustedClose = adjusted?.[index];
      return adjustedClose != null && Number.isFinite(adjustedClose) && adjustedClose > 0;
    });

    const bars: PriceBar[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
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
        date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
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
    const selectedBars = uniqueBars.filter((bar) => bar.date >= isoDate(periodStart));
    if (selectedBars.length < 2) {
      return NextResponse.json({ error: `Not enough data in the selected ${range} period.` }, { status: 422 });
    }

    const body: MarketDataResponse = {
      symbol: result.meta?.symbol || symbol,
      bars: uniqueBars,
      periodStart: isoDate(periodStart),
      meta: {
        currency: result.meta?.currency || "USD",
        exchange: result.meta?.exchangeName || "Market",
        timezone: result.meta?.exchangeTimezoneName || result.meta?.timezone || "America/New_York",
        provider: "Yahoo Finance",
        fetchedAt: new Date().toISOString(),
        adjusted: hasCompleteAdjustedSeries,
        warning: hasCompleteAdjustedSeries
          ? "Prices include split and dividend adjustments; volume is unadjusted."
          : "Adjusted history was incomplete, so raw prices are used consistently.",
      },
    };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data is temporarily unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
