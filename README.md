# SignalForge

SignalForge is a local-first stock strategy workbench. Add any number of JavaScript algorithms, run them against the same adjusted daily price history, and compare each algorithm's return, equity curve, drawdown, win rate, signals, and trades.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Algorithm contract

Every algorithm defines a `strategy` function and returns ordered signals:

```js
function strategy(bars, helpers) {
  const closes = bars.map((bar) => bar.close);
  const fast = helpers.sma(closes, 20);
  const slow = helpers.sma(closes, 50);
  const signals = [];

  for (let i = 1; i < bars.length; i += 1) {
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
      signals.push({
        type: "BUY",
        date: bars[i].date,
        price: bars[i].close,
        reason: "Fast average crossed above slow average",
      });
    }
  }
  return signals;
}
```

Supported helpers are `sma`, `ema`, `rsi`, `highest`, `lowest`, and `stdev`. Strategies run in disposable browser workers with a 1.8-second timeout and are processed four at a time, so the workspace does not impose a strategy-count limit.

The function receives the complete historical array to support vectorized indicators. When creating a signal at index `i`, custom code must not inspect bars after `i`; doing so introduces look-ahead bias. The included strategies follow this rule. Browser workers provide timeout and crash isolation, but they are not a security boundary—run only code you trust.

## Backtest assumptions

- Long-only, all-in positions with fractional shares
- Every strategy starts independently with $10,000
- Signals are generated from data available at a session's close
- Orders fill at the next session's split/dividend-adjusted open to avoid look-ahead bias
- Open positions are marked to the final split/dividend-adjusted close
- Fees and slippage are currently set to zero
- Buy-and-hold starts at the first session's open
- Up to 400 calendar days are loaded before the selected window for indicator warmup
- The selected algorithm shows BUY or SELL only when the latest completed bar creates a new next-open order; otherwise it shows HOLD for an open simulated position or WAIT while in cash

## Data

The server route fetches daily OHLC history from Yahoo Finance's public chart endpoint, applies the adjusted-close ratio consistently to OHLC, and caches stable requests for 15 minutes. The resulting historical prices include split and dividend adjustments; volume remains unadjusted. That no-key source is suitable for personal research and demos, not redistribution or execution-grade production. The provider adapter is isolated in `app/api/market/route.ts` so it can be replaced with a licensed feed.

Backtests are hypothetical and are not investment advice.
# trading-webapp
