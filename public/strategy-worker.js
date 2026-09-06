/* Signal Forge strategy runtime. User code is executed only in this disposable worker. */

const MAX_CODE_LENGTH = 50_000;
const MAX_REASON_LENGTH = 180;

function assertIndicatorInput(values, period, helperName) {
  if (!Array.isArray(values)) {
    throw new Error(`${helperName}() expects an array of finite numbers.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new Error(`${helperName}() expects an array of finite numbers.`);
    }
  }
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`${helperName}() period must be a positive integer.`);
  }
}

const helpers = {
  sma(values, period) {
    assertIndicatorInput(values, period, "sma");
    const output = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) output[i] = sum / period;
    }
    return output;
  },

  ema(values, period) {
    assertIndicatorInput(values, period, "ema");
    const output = new Array(values.length).fill(null);
    if (values.length < period) return output;
    let seed = 0;
    for (let i = 0; i < period; i += 1) seed += values[i];
    output[period - 1] = seed / period;
    const multiplier = 2 / (period + 1);
    for (let i = period; i < values.length; i += 1) {
      output[i] = (values[i] - output[i - 1]) * multiplier + output[i - 1];
    }
    return output;
  },

  rsi(values, period = 14) {
    assertIndicatorInput(values, period, "rsi");
    const output = new Array(values.length).fill(null);
    if (values.length <= period) return output;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const change = values[i] - values[i - 1];
      gains += Math.max(change, 0);
      losses += Math.max(-change, 0);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i += 1) {
      const change = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
      output[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return output;
  },

  highest(values, period) {
    assertIndicatorInput(values, period, "highest");
    return values.map((_, index) => {
      if (index < period - 1) return null;
      return Math.max(...values.slice(index - period + 1, index + 1));
    });
  },

  lowest(values, period) {
    assertIndicatorInput(values, period, "lowest");
    return values.map((_, index) => {
      if (index < period - 1) return null;
      return Math.min(...values.slice(index - period + 1, index + 1));
    });
  },

  stdev(values, period) {
    assertIndicatorInput(values, period, "stdev");
    return values.map((_, index) => {
      if (index < period - 1) return null;
      const window = values.slice(index - period + 1, index + 1);
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
    });
  },
};

const postResult = self.postMessage.bind(self);
const isArray = Array.isArray.bind(Array);

self.onmessage = (event) => {
  const { runId, code, bars } = event.data;
  try {
    if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) {
      throw new Error(`Algorithm code must be ${MAX_CODE_LENGTH.toLocaleString()} characters or fewer.`);
    }
    if (!isArray(bars)) throw new Error("Market bars must be an array.");

    // Shadow network APIs for accidental use. This worker is a runtime guard, not a hard sandbox.
    const execute = new Function(
      "bars",
      "helpers",
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "importScripts",
      `"use strict";\n${code}\nif (typeof strategy !== "function") throw new Error("Define a function named strategy.");\nreturn strategy(bars, helpers);`,
    );
    const result = execute(bars, Object.freeze(helpers), undefined, undefined, undefined, undefined);
    if (!isArray(result)) throw new Error("strategy() must return an array of signals.");
    if (result.length > bars.length * 2) throw new Error("The strategy returned too many signals.");

    const signals = new Array(result.length);
    for (let index = 0; index < result.length; index += 1) {
      const signal = result[index];
      if (!signal || typeof signal !== "object") {
        throw new Error(`Signal ${index + 1} must be an object.`);
      }
      if (signal.type !== "BUY" && signal.type !== "SELL") {
        throw new Error(`Signal ${index + 1} must have a BUY or SELL type.`);
      }
      if (typeof signal.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(signal.date)) {
        throw new Error(`Signal ${index + 1} must have an ISO date.`);
      }
      if (!Number.isFinite(signal.price) || signal.price <= 0) {
        throw new Error(`Signal ${index + 1} must have a finite, positive trigger price.`);
      }
      if (signal.reason !== undefined && typeof signal.reason !== "string") {
        throw new Error(`Signal ${index + 1} reason must be a string when provided.`);
      }

      signals[index] = {
        type: signal.type,
        date: signal.date,
        price: signal.price,
        ...(signal.reason ? { reason: signal.reason.slice(0, MAX_REASON_LENGTH) } : {}),
      };
    }

    postResult({ runId, ok: true, signals });
  } catch (error) {
    postResult({ runId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
