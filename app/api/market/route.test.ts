import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

function request(query: string) {
  return new NextRequest(`http://localhost/api/market?${query}`);
}

function yahooChart(
  timestamps: number[],
  options: {
    adjusted?: number[];
    regularStart?: number;
    regularEnd?: number;
  } = {},
) {
  const close = timestamps.map((_, index) => 101 + index);
  return {
    chart: {
      result: [{
        meta: {
          symbol: "AAPL",
          currency: "USD",
          exchangeName: "NMS",
          exchangeTimezoneName: "America/New_York",
          ...(options.regularStart != null && options.regularEnd != null
            ? {
                currentTradingPeriod: {
                  regular: {
                    start: options.regularStart,
                    end: options.regularEnd,
                  },
                },
              }
            : {}),
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: timestamps.map((_, index) => 100 + index),
            high: timestamps.map((_, index) => 103 + index),
            low: timestamps.map((_, index) => 99 + index),
            close,
            volume: timestamps.map((_, index) => 1_000 + index),
          }],
          ...(options.adjusted
            ? { adjclose: [{ adjclose: options.adjusted }] }
            : {}),
        },
      }],
      error: null,
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GET /api/market", () => {
  it("rejects unknown intervals and unsupported interval-duration pairs", async () => {
    const invalidInterval = await GET(request("symbol=AAPL&range=1M&interval=5m"));
    expect(invalidInterval.status).toBe(400);
    await expect(invalidInterval.json()).resolves.toMatchObject({
      error: expect.stringContaining("Unsupported interval"),
    });

    const invalidRange = await GET(request("symbol=AAPL&range=3M&interval=15m"));
    expect(invalidRange.status).toBe(400);
    await expect(invalidRange.json()).resolves.toEqual({
      error: "3M is unavailable for 15 min candles. Choose 1M or a longer interval.",
    });
  });

  it("preserves same-day intraday bars and omits the in-progress candle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T15:37:00.000Z"));
    const timestamps = [
      "2026-09-08T15:00:00.000Z",
      "2026-09-08T15:15:00.000Z",
      "2026-09-08T15:30:00.000Z",
    ].map((value) => Date.parse(value) / 1000);
    const fetchMock = vi.fn(async () => jsonResponse(yahooChart(timestamps)));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("symbol=aapl&range=1M&interval=15m"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      symbol: "AAPL",
      interval: "15m",
      periodStart: "2026-08-08T15:30:00.000Z",
      meta: {
        adjusted: false,
        warning: expect.stringContaining("intraday candles"),
      },
    });
    expect(body.bars.map((bar: { date: string }) => bar.date)).toEqual([
      "2026-09-08T15:00:00.000Z",
      "2026-09-08T15:15:00.000Z",
    ]);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=900",
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { next: { revalidate: number } },
    ];
    const upstream = new URL(url);
    const expectedEnd = Date.parse("2026-09-08T15:30:00.000Z") / 1000;
    expect(upstream.searchParams.get("interval")).toBe("15m");
    expect(upstream.searchParams.get("period2")).toBe(String(expectedEnd));
    expect(upstream.searchParams.get("period1")).toBe(
      String(expectedEnd - 59 * 86_400),
    );
    expect(init.next.revalidate).toBe(60);
  });

  it("keeps a completed shortened final hourly candle from the current session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T21:10:00.000Z"));
    const timestamps = [
      "2026-09-08T18:30:00.000Z",
      "2026-09-08T19:30:00.000Z",
      "2026-09-08T20:00:00.000Z",
    ].map((value) => Date.parse(value) / 1000);
    const fetchMock = vi.fn(async () => jsonResponse(yahooChart(timestamps, {
      regularStart: Date.parse("2026-09-08T13:30:00.000Z") / 1000,
      regularEnd: Date.parse("2026-09-08T20:00:00.000Z") / 1000,
    })));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("symbol=AAPL&range=1M&interval=1h"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.interval).toBe("1h");
    expect(body.bars.map((bar: { date: string }) => bar.date)).toEqual([
      "2026-09-08T18:30:00.000Z",
      "2026-09-08T19:30:00.000Z",
    ]);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
  });

  it("defaults to adjusted daily data and retains date-only values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T15:37:00.000Z"));
    const timestamps = [
      "2026-09-04T13:30:00.000Z",
      "2026-09-07T13:30:00.000Z",
      "2026-09-08T13:30:00.000Z",
    ].map((value) => Date.parse(value) / 1000);
    const fetchMock = vi.fn(async () => jsonResponse(yahooChart(timestamps, {
      adjusted: [100, 101, 102],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("symbol=AAPL&range=1Y"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      interval: "1d",
      periodStart: "2025-09-07",
      meta: { adjusted: true },
    });
    expect(body.bars.map((bar: { date: string }) => bar.date)).toEqual([
      "2026-09-04",
      "2026-09-07",
    ]);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const upstream = new URL(url);
    expect(upstream.searchParams.get("interval")).toBe("1d");
    expect(upstream.searchParams.get("period2")).toBe(
      String(Date.parse("2026-09-08T00:00:00.000Z") / 1000),
    );
  });

  it("falls back to Yahoo's alternate chart host after a rate limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T15:37:00.000Z"));
    const timestamps = [
      "2026-09-04T13:30:00.000Z",
      "2026-09-07T13:30:00.000Z",
    ].map((value) => Date.parse(value) / 1000);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse(yahooChart(timestamps, {
        adjusted: [100, 101],
      })));
    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = GET(request("symbol=AAPL&range=1Y&interval=1d"));
    await vi.advanceTimersByTimeAsync(250);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0] as string).hostname).toBe("query2.finance.yahoo.com");
    expect(new URL(fetchMock.mock.calls[1][0] as string).hostname).toBe("query1.finance.yahoo.com");
  });
});
