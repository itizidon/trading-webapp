import type { PriceBar, RawSignal } from "./types";

export function executeStrategy(
  code: string,
  bars: PriceBar[],
  timeoutMs = 1800,
  abortSignal?: AbortSignal,
): Promise<RawSignal[]> {
  return new Promise((resolve, reject) => {
    if (code.length > 50_000) {
      reject(new Error("Algorithm code must be 50,000 characters or fewer."));
      return;
    }
    const worker = new Worker("/strategy-worker.js");
    const runId = crypto.randomUUID();
    const abort = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      const error = new Error("Backtest cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Timed out after 1.8 seconds. Check the algorithm for long-running loops."));
    }, timeoutMs);

    if (abortSignal?.aborted) {
      abort();
      return;
    }
    abortSignal?.addEventListener("abort", abort, { once: true });

    const cleanUp = () => {
      window.clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", abort);
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<{ runId?: string; ok: boolean; signals?: unknown; error?: string }>) => {
      if (event.data.runId !== runId) return;
      cleanUp();
      if (!event.data.ok) {
        reject(new Error(event.data.error || "The algorithm failed."));
        return;
      }

      const signals = event.data.signals;
      if (!Array.isArray(signals)) {
        reject(new Error("strategy() must return an array."));
        return;
      }

      const valid = signals.every((signal) => {
        if (!signal || typeof signal !== "object") return false;
        const candidate = signal as Partial<RawSignal>;
        return (
          (candidate.type === "BUY" || candidate.type === "SELL") &&
          typeof candidate.date === "string" &&
          typeof candidate.price === "number" &&
          Number.isFinite(candidate.price)
        );
      });

      if (!valid) {
        reject(new Error("Every signal needs a BUY/SELL type, ISO date, and finite trigger price."));
        return;
      }
      resolve(signals as RawSignal[]);
    };

    worker.onerror = (event) => {
      cleanUp();
      reject(new Error(event.message || "The algorithm worker crashed."));
    };

    worker.postMessage({ runId, code, bars });
  });
}
