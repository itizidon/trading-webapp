"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Braces,
  CalendarDays,
  Check,
  Code2,
  Copy,
  Database,
  FlaskConical,
  Gauge,
  Info,
  Layers3,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateBuyAndHold, runBacktest } from "@/lib/backtest";
import { deriveCurrentSignal } from "@/lib/current-signal";
import { BLANK_STRATEGY, DEFAULT_STRATEGIES, STRATEGY_COLORS } from "@/lib/strategies";
import { executeStrategy } from "@/lib/strategy-runner";
import type {
  BacktestResult,
  MarketDataResponse,
  RangeKey,
  RunSettings,
  StrategyDefinition,
} from "@/lib/types";
import PerformanceChart from "./PerformanceChart";
import ResultsTable from "./ResultsTable";
import TradeIndicator from "./TradeIndicator";

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y"];

const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function isStrategyList(value: unknown): value is StrategyDefinition[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const strategy = item as Partial<StrategyDefinition>;
    return (
      typeof strategy.id === "string" && strategy.id.length > 0 &&
      typeof strategy.name === "string" && strategy.name.length > 0 &&
      typeof strategy.description === "string" &&
      typeof strategy.color === "string" &&
      typeof strategy.code === "string" &&
      typeof strategy.enabled === "boolean"
    );
  });
}

async function mapInBatches<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

function errorResult(strategyId: string, message: string): BacktestResult {
  return {
    strategyId,
    signals: [],
    trades: [],
    equity: [],
    metrics: {
      totalReturnPct: 0,
      endingValue: 0,
      maxDrawdownPct: 0,
      winRatePct: null,
      completedTrades: 0,
      totalSignals: 0,
      exposurePct: 0,
    },
    error: message,
  };
}

function StrategyCard({
  strategy,
  result,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  locked,
}: {
  strategy: StrategyDefinition;
  result?: BacktestResult;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  locked: boolean;
}) {
  const returnValue = result?.metrics.totalReturnPct ?? 0;
  return (
    <article
      className={`strategy-card ${selected ? "is-selected" : ""} ${!strategy.enabled ? "is-disabled" : ""}`}
      data-strategy-id={strategy.id}
      onClick={onSelect}
      style={{ "--strategy-color": strategy.color } as React.CSSProperties}
    >
      <div className="strategy-card-head">
        <button
          type="button"
          className="strategy-identity"
          aria-label={`View ${strategy.name} results`}
          onClick={(event) => { event.stopPropagation(); onSelect(); }}
        >
          <span className="strategy-color" />
          <div>
            <h3>{strategy.name}</h3>
            <span>{strategy.enabled ? "Included in run" : "Paused"}</span>
          </div>
        </button>
        <button
          type="button"
          className={`switch ${strategy.enabled ? "on" : ""}`}
          aria-label={`${strategy.enabled ? "Disable" : "Enable"} ${strategy.name}`}
          disabled={locked}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
        >
          <span />
        </button>
      </div>

      <p>{strategy.description}</p>

      <div className="strategy-stats">
        <div>
          <span>Return</span>
          {result?.error ? (
            <strong className="value-error">Error</strong>
          ) : result ? (
            <strong className={returnValue >= 0 ? "positive" : "negative"}>{percent(returnValue)}</strong>
          ) : (
            <strong>—</strong>
          )}
        </div>
        <div>
          <span>Signals</span>
          <strong>{result ? result.metrics.totalSignals : "—"}</strong>
        </div>
        <div>
          <span>Trades</span>
          <strong>{result ? result.metrics.completedTrades : "—"}</strong>
        </div>
      </div>

      <div className="strategy-actions">
        <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); onEdit(); }}>
          <Code2 size={14} /> Edit code
        </button>
        <div>
          <button type="button" title="Duplicate" aria-label={`Duplicate ${strategy.name}`} disabled={locked} onClick={(event) => { event.stopPropagation(); onDuplicate(); }}>
            <Copy size={14} />
          </button>
          <button type="button" title="Delete" aria-label={`Delete ${strategy.name}`} disabled={locked} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function EditorModal({
  draft,
  setDraft,
  onClose,
  onSave,
}: {
  draft: StrategyDefinition;
  setDraft: (strategy: StrategyDefinition) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={modalRef} className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" aria-describedby="editor-description" onMouseDown={(event) => event.stopPropagation()}>
        <header className="editor-head">
          <div>
            <div className="eyebrow"><Braces size={14} /> Algorithm editor</div>
            <h2 id="editor-title">Edit strategy logic</h2>
            <p id="editor-description">Your code runs locally in a disposable browser worker.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close editor"><X size={18} /></button>
        </header>

        <div className="editor-meta">
          <label>
            Strategy name
            <input autoFocus value={draft.name} maxLength={48} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            Description
            <input value={draft.description} maxLength={120} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
        </div>

        <div className="contract-strip">
          <div><ShieldCheck size={16} /><span><strong>Contract</strong> Return an array of BUY / SELL signals</span></div>
          <code>{`{ type: "BUY" | "SELL", date, price, reason? }`}</code>
        </div>

        <div className="code-shell">
          <div className="code-toolbar">
            <div><span className="dot red" /><span className="dot yellow" /><span className="dot green" /></div>
            <span>strategy.js</span>
            <span>JavaScript</span>
          </div>
          <textarea
            aria-label="Strategy JavaScript"
            spellCheck={false}
            maxLength={50_000}
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </div>

        <div className="helper-row">
          <span>Available helpers</span>
          {['sma(values, n)', 'ema(values, n)', 'rsi(values, n)', 'highest(values, n)', 'lowest(values, n)', 'stdev(values, n)'].map((helper) => <code key={helper}>{helper}</code>)}
        </div>

        <footer className="editor-footer">
          <p><Info size={14} /> Use only current/past bars for each signal; fills occur at the next session&apos;s open.</p>
          <div>
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="button primary" disabled={!draft.name.trim() || !draft.code.trim()} onClick={onSave}>
              <Check size={16} /> Save algorithm
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function TradingStudio() {
  const idPrefix = useId().replace(/:/g, "");
  const idCounter = useRef(DEFAULT_STRATEGIES.length);
  const runVersion = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>(DEFAULT_STRATEGIES);
  const [symbol, setSymbol] = useState("AAPL");
  const [activeSymbol, setActiveSymbol] = useState("AAPL");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [activeRange, setActiveRange] = useState<RangeKey>("1Y");
  const [settings] = useState<RunSettings>({ startingCapital: 10_000, feePct: 0, slippagePct: 0 });
  const [market, setMarket] = useState<MarketDataResponse | null>(null);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [selectedId, setSelectedId] = useState(DEFAULT_STRATEGIES[0].id);
  const [draft, setDraft] = useState<StrategyDefinition | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [hasLoadedSaved, setHasLoadedSaved] = useState(false);
  const [needsRun, setNeedsRun] = useState(false);
  const [toast, setToast] = useState("");
  const [strategyQuery, setStrategyQuery] = useState("");
  const currency = market?.meta.currency || "USD";
  const wholeMoney = useMemo(() => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }), [currency]);
  const preciseMoney = useMemo(() => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [currency]);
  const closeEditor = useCallback(() => setDraft(null), []);
  const cancelRun = useCallback(() => {
    runVersion.current += 1;
    requestAbort.current?.abort();
    requestAbort.current = null;
    setRunning(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("signal-forge-strategies");
        if (saved) {
          const parsed = JSON.parse(saved) as StrategyDefinition[];
          if (isStrategyList(parsed)) {
            idCounter.current = Math.max(idCounter.current, ...parsed.map((strategy) => {
              const parts = strategy.id.split("-");
              return Number(parts[parts.length - 1]) || 0;
            }));
            setStrategies(parsed);
            setSelectedId(parsed[0]?.id ?? "");
          }
        }
      } catch {
        // A malformed local draft should never prevent the app from opening.
      }
      setHasLoadedSaved(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hasLoadedSaved) return;
    try {
      window.localStorage.setItem("signal-forge-strategies", JSON.stringify(strategies));
    } catch {
      // The in-memory workspace remains usable if browser storage is full or blocked.
    }
  }, [hasLoadedSaved, strategies]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const runAll = useCallback(async (ticker = symbol, selectedRange = range) => {
    const cleanSymbol = ticker.trim().toUpperCase();
    if (!cleanSymbol) {
      setRunError("Enter a ticker symbol before running the backtest.");
      return;
    }
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    const version = runVersion.current + 1;
    runVersion.current = version;
    setRunning(true);
    setRunError("");
    try {
      const response = await fetch(`/api/market?symbol=${encodeURIComponent(cleanSymbol)}&range=${selectedRange}`, {
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load market data.");
      const nextMarket = payload as MarketDataResponse;
      const testBars = nextMarket.bars.filter((bar) => bar.date >= nextMarket.periodStart);
      const enabled = strategies.filter((strategy) => strategy.enabled);
      const nextResults = await mapInBatches(enabled, async (strategy) => {
        try {
          const allSignals = await executeStrategy(strategy.code, nextMarket.bars, 1800, controller.signal);
          const periodSignals = allSignals.filter((signal) => signal.date >= nextMarket.periodStart);
          return runBacktest(strategy.id, testBars, periodSignals, settings);
        } catch (error) {
          return errorResult(strategy.id, error instanceof Error ? error.message : "Algorithm failed.");
        }
      });
      if (runVersion.current !== version || controller.signal.aborted) return;
      setMarket(nextMarket);
      setResults(nextResults);
      setActiveSymbol(nextMarket.symbol);
      setActiveRange(selectedRange);
      setSymbol(nextMarket.symbol);
      setLastRunAt(new Date());
      setNeedsRun(false);
      setToast(`Finished ${enabled.length} algorithm${enabled.length === 1 ? "" : "s"} on ${nextMarket.symbol}.`);
      if (!enabled.some((strategy) => strategy.id === selectedId) && enabled[0]) setSelectedId(enabled[0].id);
    } catch (error) {
      if (runVersion.current !== version || controller.signal.aborted) return;
      setRunError(error instanceof Error ? error.message : "The backtest could not be completed.");
      setNeedsRun(true);
    } finally {
      if (runVersion.current === version) {
        requestAbort.current = null;
        setRunning(false);
      }
    }
  }, [range, selectedId, settings, strategies, symbol]);

  const selectedBars = useMemo(
    () => market?.bars.filter((bar) => bar.date >= market.periodStart) ?? [],
    [market],
  );
  const benchmark = useMemo(
    () => calculateBuyAndHold(selectedBars, settings.startingCapital),
    [selectedBars, settings.startingCapital],
  );
  const benchmarkEnd = benchmark[benchmark.length - 1];
  const benchmarkReturn = benchmarkEnd?.returnPct ?? 0;
  const enabledIds = new Set(strategies.filter((strategy) => strategy.enabled).map((strategy) => strategy.id));
  const validResults = results.filter((result) => !result.error && enabledIds.has(result.strategyId));
  const bestResult = validResults.length
    ? validResults.reduce((best, result) => result.metrics.totalReturnPct > best.metrics.totalReturnPct ? result : best)
    : null;
  const bestStrategy = strategies.find((strategy) => strategy.id === bestResult?.strategyId);
  const selectedResult = results.find((result) => result.strategyId === selectedId);
  const selectedStrategy = strategies.find((strategy) => strategy.id === selectedId);
  const currentSignal = useMemo(
    () => deriveCurrentSignal({
      result: selectedResult,
      bars: selectedBars,
      updating: running,
      stale: needsRun || Boolean(runError),
    }),
    [needsRun, runError, running, selectedBars, selectedResult],
  );
  const visibleStrategies = useMemo(() => {
    const query = strategyQuery.trim().toLocaleLowerCase();
    if (!query) return strategies;
    return strategies.filter((strategy) =>
      `${strategy.name} ${strategy.description}`.toLocaleLowerCase().includes(query),
    );
  }, [strategies, strategyQuery]);

  function submitRun(event: FormEvent) {
    event.preventDefault();
    void runAll();
  }

  function openEditor(strategy: StrategyDefinition) {
    cancelRun();
    setDraft({ ...strategy });
  }

  function toggleStrategy(strategy: StrategyDefinition) {
    cancelRun();
    const enabled = !strategy.enabled;
    setStrategies((current) => current.map((item) => item.id === strategy.id ? { ...item, enabled } : item));
    setNeedsRun(true);
    setToast(`${strategy.name} ${enabled ? "enabled" : "paused"}.`);
  }

  function addStrategy() {
    cancelRun();
    setStrategyQuery("");
    idCounter.current += 1;
    const id = `custom-${idPrefix}-${idCounter.current}`;
    const next: StrategyDefinition = {
      id,
      name: `Custom algorithm ${strategies.length + 1}`,
      description: "A custom signal model ready for your trading logic.",
      color: STRATEGY_COLORS[strategies.length % STRATEGY_COLORS.length],
      code: BLANK_STRATEGY,
      enabled: true,
    };
    setDraft(next);
  }

  function duplicateStrategy(strategy: StrategyDefinition) {
    cancelRun();
    idCounter.current += 1;
    const copy = {
      ...strategy,
      id: `copy-${idPrefix}-${idCounter.current}`,
      name: `${strategy.name} copy`,
      color: STRATEGY_COLORS[strategies.length % STRATEGY_COLORS.length],
    };
    setStrategies((current) => [...current, copy]);
    setSelectedId(copy.id);
    setNeedsRun(true);
    setToast(`${strategy.name} duplicated.`);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-strategy-id="${copy.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  }

  function deleteStrategy(id: string) {
    const target = strategies.find((strategy) => strategy.id === id);
    if (target && !window.confirm(`Delete “${target.name}”? This removes its saved code and results.`)) return;
    cancelRun();
    setStrategies((current) => current.filter((strategy) => strategy.id !== id));
    setResults((current) => current.filter((result) => result.strategyId !== id));
    if (selectedId === id) {
      const remaining = strategies.find((strategy) => strategy.id !== id);
      setSelectedId(remaining?.id ?? "");
    }
    setNeedsRun(true);
    setToast(target ? `${target.name} deleted.` : "Algorithm deleted.");
  }

  function selectResult(strategyId: string) {
    setSelectedId(strategyId);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".signal-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark"><TrendingUp size={21} /></div>
        <nav aria-label="Primary navigation">
          <button type="button" className="rail-button active" title="Backtest lab" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><FlaskConical size={20} /></button>
          <button type="button" className="rail-button" title="Algorithms" onClick={() => document.querySelector(".strategies-panel")?.scrollIntoView({ behavior: "smooth" })}><Braces size={20} /></button>
        </nav>
        <div className="rail-bottom">
          <div className="avatar">DS</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="wordmark"><span>Signal</span>Forge <span className="version">LAB</span></div>
          <div className="topbar-center">
            <button type="button" className="topnav active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><FlaskConical size={15} /> Backtest</button>
            <button type="button" className="topnav" onClick={() => document.querySelector(".strategies-panel")?.scrollIntoView({ behavior: "smooth" })}><Layers3 size={15} /> Algorithms <span>{strategies.length}</span></button>
          </div>
          <div className="data-status"><span /><Database size={14} /> Adjusted daily data</div>
        </header>

        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow"><Sparkles size={14} /> Quant workspace</div>
              <h1>Strategy workbench</h1>
              <p>Test every idea on the same market window. Compare signals, trades, and returns side by side.</p>
            </div>
            <div className="run-meta">
              {needsRun && market ? (
                <><span className="pending-dot" /> Changes ready — run again to apply</>
              ) : lastRunAt ? (
                <><span className="pulse-dot" /> Last run {lastRunAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
              ) : "Ready — configure or run when you want"}
            </div>
          </section>

          <form className="runbar" onSubmit={submitRun}>
            <label className="symbol-field">
              <span>Ticker</span>
              <div><Search size={17} /><input value={symbol} onChange={(event) => { cancelRun(); setSymbol(event.target.value.toUpperCase()); setNeedsRun(true); }} placeholder="AAPL" maxLength={15} /></div>
            </label>
            <div className="divider" />
            <fieldset className="range-field">
              <legend>Duration</legend>
              <div>
                {RANGES.map((option) => (
                  <button key={option} type="button" aria-pressed={range === option} className={range === option ? "active" : ""} onClick={() => { cancelRun(); setRange(option); setNeedsRun(true); }}>{option}</button>
                ))}
              </div>
            </fieldset>
            <div className="divider" />
            <div className="capital-field">
              <span>Starting capital</span>
              <strong>{wholeMoney.format(settings.startingCapital)}</strong>
            </div>
            <div className="divider" />
            <div className="cost-field">
              <span>Costs</span>
              <strong>0.00%</strong>
              <small>Fee + slippage</small>
            </div>
            <button
              className={`run-button ${running ? "cancel" : ""}`}
              type={running ? "button" : "submit"}
              onClick={running ? cancelRun : undefined}
              disabled={!running && (draft !== null || !strategies.some((strategy) => strategy.enabled))}
            >
              {running ? <X size={17} /> : <Play fill="currentColor" size={16} />}
              {running
                ? "Cancel run"
                : strategies.some((strategy) => strategy.enabled)
                  ? "Run all algorithms"
                  : "Enable an algorithm"}
            </button>
          </form>

          {runError && (
            <div className="alert error-alert" role="alert"><Info size={17} /><span><strong>Couldn&apos;t load that backtest.</strong> {runError}</span><button aria-label="Dismiss error" onClick={() => setRunError("")}><X size={15} /></button></div>
          )}

          <section className="metric-grid" aria-label="Backtest summary">
            <article className="metric-card feature">
              <div className="metric-icon"><Zap size={18} /></div>
              <div><span>Best performer</span><strong>{bestStrategy?.name ?? (running ? "Calculating…" : "—")}</strong></div>
              {bestResult && <em className={bestResult.metrics.totalReturnPct >= 0 ? "positive-pill" : "negative-pill"}>{percent(bestResult.metrics.totalReturnPct)}</em>}
            </article>
            <article className="metric-card">
              <div className="metric-icon purple"><Gauge size={18} /></div>
              <div><span>Buy &amp; hold</span><strong className={benchmarkReturn >= 0 ? "positive" : "negative"}>{market ? percent(benchmarkReturn) : "—"}</strong></div>
              <small>{activeSymbol} benchmark</small>
            </article>
            <article className="metric-card">
              <div className="metric-icon amber"><Braces size={18} /></div>
              <div><span>Algorithms tested</span><strong>{results.length || "—"}</strong></div>
              <small>{strategies.filter((strategy) => strategy.enabled).length} enabled</small>
            </article>
            <article className="metric-card">
              <div className="metric-icon blue"><CalendarDays size={18} /></div>
              <div><span>Market window</span><strong>{selectedBars.length ? `${selectedBars.length} sessions` : "—"}</strong></div>
              <small>{activeRange} · Daily candles</small>
            </article>
          </section>

          {selectedStrategy && (
            <TradeIndicator
              currency={currency}
              indicator={currentSignal}
              range={market ? activeRange : range}
              strategy={selectedStrategy}
              symbol={market ? activeSymbol : symbol.trim().toUpperCase() || "Ticker"}
            />
          )}

          <section className="main-grid">
            <div className="strategies-panel panel">
              <div className="panel-heading">
                <div><span className="section-kicker">YOUR LOGIC</span><h2>Algorithms <b>{strategies.length}</b></h2></div>
                <button type="button" className="add-button" disabled={running} onClick={addStrategy}><Plus size={16} /> Add</button>
              </div>
              <div className="unlimited-note"><Sparkles size={14} /><span>Add as many algorithms as you need. Each runs independently.</span></div>
              {strategies.length > 0 && (
                <label className="strategy-filter">
                  <Search size={14} />
                  <input
                    value={strategyQuery}
                    onChange={(event) => setStrategyQuery(event.target.value)}
                    placeholder="Filter algorithms"
                    aria-label="Filter algorithms"
                  />
                  <span>{visibleStrategies.length}/{strategies.length}</span>
                </label>
              )}
              <div className="strategy-list">
                {visibleStrategies.map((strategy) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    result={results.find((result) => result.strategyId === strategy.id)}
                    selected={selectedId === strategy.id}
                    onSelect={() => setSelectedId(strategy.id)}
                    onToggle={() => toggleStrategy(strategy)}
                    onEdit={() => openEditor(strategy)}
                    onDuplicate={() => duplicateStrategy(strategy)}
                    onDelete={() => deleteStrategy(strategy.id)}
                    locked={running}
                  />
                ))}
                {!strategies.length && (
                  <button type="button" className="empty-add" onClick={addStrategy}><Plus size={22} /><strong>Add your first algorithm</strong><span>Start with an editable crossover template.</span></button>
                )}
                {strategies.length > 0 && !visibleStrategies.length && (
                  <div className="strategy-no-match">
                    <Search size={18} />
                    <strong>No matching algorithms</strong>
                    <button type="button" onClick={() => setStrategyQuery("")}>Clear filter</button>
                  </div>
                )}
              </div>
            </div>

            <div className="results-column">
              <section className="chart-panel panel">
                <div className="panel-heading chart-heading">
                  <div><span className="section-kicker">PERFORMANCE</span><h2>Equity curves</h2></div>
                  <div className="chart-meta">
                    {market && benchmarkEnd && (
                      <span
                        className="chart-benchmark"
                        aria-label={`Buy and hold ending value ${wholeMoney.format(benchmarkEnd.value)} from ${wholeMoney.format(settings.startingCapital)}, a return of ${percent(benchmarkReturn)}`}
                      >
                        <span>Buy &amp; hold value</span>
                        <strong>{wholeMoney.format(benchmarkEnd.value)}</strong>
                        <em className={benchmarkReturn >= 0 ? "positive-pill" : "negative-pill"}>{percent(benchmarkReturn)}</em>
                      </span>
                    )}
                    <span className="chart-symbol"><i className="live-dot" /> {activeSymbol}</span>
                    <span className="chart-adjustment">{market?.meta.adjusted ? "Split + dividend adjusted" : "Raw prices"}</span>
                  </div>
                </div>
                <PerformanceChart
                  bars={selectedBars}
                  results={results}
                  strategies={strategies}
                  selectedId={selectedId}
                  benchmark={benchmark}
                  currency={currency}
                />
                {!market && !running && <div className="chart-empty"><TrendingUp size={28} /><strong>Your comparison will appear here</strong><span>Choose a ticker, then run every enabled algorithm.</span></div>}
                {running && <div className="chart-loading"><LoaderCircle className="spin" size={26} /><strong>Running your strategy set</strong><span>Loading daily prices and evaluating signals…</span></div>}
              </section>

              <section className="results-panel panel">
                <div className="panel-heading table-heading">
                  <div><span className="section-kicker">LEADERBOARD</span><h2>Return comparison</h2></div>
                  <span className="basis-note"><Info size={13} /> Next-open fills · No fees</span>
                </div>
                <ResultsTable
                  strategies={strategies}
                  results={results}
                  benchmarkReturn={benchmarkReturn}
                  selectedId={selectedId}
                  onSelect={selectResult}
                />
              </section>
            </div>
          </section>

          {selectedStrategy && selectedResult && (
            <section className="signal-panel panel">
              <div className="panel-heading signal-heading">
                <div>
                  <span className="section-kicker">TRADE TRACE</span>
                  <h2><i style={{ background: selectedStrategy.color }} /> {selectedStrategy.name}</h2>
                </div>
                <div className="signal-summary">
                  <div><span>Ending value</span><strong>{selectedResult.error ? "—" : wholeMoney.format(selectedResult.metrics.endingValue)}</strong></div>
                  <div><span>Exposure</span><strong>{selectedResult.metrics.exposurePct.toFixed(1)}%</strong></div>
                  <button disabled={running} onClick={() => setDraft({ ...selectedStrategy })}><Pencil size={14} /> Edit algorithm</button>
                </div>
              </div>
              {selectedResult.error ? (
                <div className="result-error"><Info size={18} /><div><strong>Algorithm needs attention</strong><span>{selectedResult.error}</span></div><button disabled={running} onClick={() => setDraft({ ...selectedStrategy })}>Open editor <ArrowRight size={14} /></button></div>
              ) : selectedResult.signals.length ? (
                <div className="signal-table-wrap">
                  <table className="signal-table">
                    <thead><tr><th>Signal</th><th>Triggered</th><th>Trigger price</th><th>Filled</th><th>Fill price</th><th>Reason</th><th>Status</th></tr></thead>
                    <tbody>
                      {selectedResult.signals.slice().reverse().map((signal) => (
                        <tr key={signal.id}>
                          <td><span className={`signal-type ${signal.type.toLowerCase()}`}>{signal.type === "BUY" ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{signal.type}</span></td>
                          <td>{new Date(`${signal.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                          <td className="mono">{preciseMoney.format(signal.price)}</td>
                          <td>{signal.fillDate ? new Date(`${signal.fillDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                          <td className="mono">{signal.fillPrice ? preciseMoney.format(signal.fillPrice) : "—"}</td>
                          <td className="reason-cell">{signal.reason || "Custom condition met"}</td>
                          <td><span className={`status ${signal.status.toLowerCase()}`}>{signal.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="no-signals"><Activity size={22} /><div><strong>No signals in this window</strong><span>The algorithm ran successfully but its conditions were not met.</span></div></div>
              )}
            </section>
          )}

          <footer className="disclaimer">
            <ShieldCheck size={15} />
            <span>Research environment only. Historical backtests are hypothetical and do not predict future results. Data may be delayed or corrected.</span>
            {market && <span className="source">Source: {market.meta.provider} · {market.meta.currency}</span>}
          </footer>
        </main>
      </div>

      {draft && (
        <EditorModal
          draft={draft}
          setDraft={setDraft}
          onClose={closeEditor}
          onSave={() => {
            setStrategies((current) => current.some((strategy) => strategy.id === draft.id)
              ? current.map((strategy) => strategy.id === draft.id ? draft : strategy)
              : [...current, draft]);
            setResults((current) => current.filter((result) => result.strategyId !== draft.id));
            setSelectedId(draft.id);
            setNeedsRun(true);
            setToast(`${draft.name} saved. Run all algorithms to apply it.`);
            setDraft(null);
          }}
        />
      )}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={15} /> {toast}</div>}
    </div>
  );
}
