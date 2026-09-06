import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGIES } from "./strategies";
import type { PriceBar } from "./types";

const workerSource = readFileSync(resolve(process.cwd(), "public/strategy-worker.js"), "utf8");

function sampleBars(): PriceBar[] {
  return Array.from({ length: 320 }, (_, index) => {
    const close = 100 + Math.sin(index / 8) * 14 + index * 0.025;
    const date = new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
    return {
      date,
      open: close - 0.25,
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 1_000_000 + index * 1_000,
    };
  });
}

function executeInWorker(code: string) {
  const messages: unknown[] = [];
  const sandbox = {
    self: {
      postMessage: (message: unknown) => messages.push(message),
    },
  };
  runInNewContext(workerSource, sandbox);
  const worker = sandbox.self as typeof sandbox.self & {
    onmessage: (event: { data: { runId: string; code: string; bars: PriceBar[] } }) => void;
  };
  worker.onmessage({ data: { runId: "test-run", code, bars: sampleBars() } });
  return messages[0] as { runId: string; ok: boolean; signals?: unknown[]; error?: string };
}

describe("strategy worker", () => {
  it.each(DEFAULT_STRATEGIES)("compiles and runs the $name template", (strategy) => {
    const response = executeInWorker(strategy.code);

    expect(response.runId).toBe("test-run");
    expect(response.ok, response.error).toBe(true);
    expect(Array.isArray(response.signals)).toBe(true);
    expect(response.signals?.length).toBeGreaterThan(0);
  });

  it("isolates a syntax error as an algorithm-level failure", () => {
    const response = executeInWorker("function strategy( {");

    expect(response.ok).toBe(false);
    expect(response.error).toBeTruthy();
  });

  it.each([
    ["an invalid action", `function strategy(bars) { return [{ type: "HOLD", date: bars[0].date, price: bars[0].close }]; }`, "BUY or SELL"],
    ["a non-positive price", `function strategy(bars) { return [{ type: "BUY", date: bars[0].date, price: 0 }]; }`, "finite, positive trigger price"],
    ["a non-string reason", `function strategy(bars) { return [{ type: "BUY", date: bars[0].date, price: bars[0].close, reason: 42 }]; }`, "reason must be a string"],
  ])("rejects %s in returned signals", (_name, code, message) => {
    const response = executeInWorker(code);

    expect(response.ok).toBe(false);
    expect(response.error).toContain(message);
  });

  it("rejects sparse signal arrays instead of silently accepting their holes", () => {
    const response = executeInWorker("function strategy() { return new Array(1); }");

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Signal 1 must be an object");
  });

  it("returns only normalized contract fields and bounds long reasons", () => {
    const response = executeInWorker(`function strategy(bars) {
      return [{
        type: "BUY",
        date: bars[0].date,
        price: bars[0].close,
        reason: "x".repeat(500),
        internalState: { shouldNotEscape: true },
      }];
    }`);

    expect(response.ok).toBe(true);
    expect(response.signals).toEqual([{
      type: "BUY",
      date: sampleBars()[0].date,
      price: sampleBars()[0].close,
      reason: "x".repeat(180),
    }]);
  });

  it("gives a useful error for an invalid indicator period", () => {
    const response = executeInWorker(`function strategy(bars, helpers) {
      helpers.sma(bars.map((bar) => bar.close), 0);
      return [];
    }`);

    expect(response.ok).toBe(false);
    expect(response.error).toContain("sma() period must be a positive integer");
  });

  it("rejects sparse indicator inputs", () => {
    const response = executeInWorker(`function strategy(_bars, helpers) {
      helpers.ema(new Array(20), 5);
      return [];
    }`);

    expect(response.ok).toBe(false);
    expect(response.error).toContain("ema() expects an array of finite numbers");
  });
});
