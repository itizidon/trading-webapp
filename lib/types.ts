export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export type SignalType = "BUY" | "SELL";

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RawSignal {
  type: SignalType;
  date: string;
  price: number;
  reason?: string;
}

export interface TradeSignal extends RawSignal {
  id: string;
  barIndex: number;
  fillDate?: string;
  fillPrice?: number;
  status: "FILLED" | "IGNORED" | "PENDING";
}

export interface CompletedTrade {
  id: string;
  entryDate: string;
  entryPrice: number;
  exitDate?: string;
  exitPrice?: number;
  quantity: number;
  pnl: number;
  returnPct: number;
  status: "CLOSED" | "OPEN";
}

export interface EquityPoint {
  date: string;
  value: number;
  returnPct: number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  endingValue: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  completedTrades: number;
  totalSignals: number;
  exposurePct: number;
}

export interface BacktestResult {
  strategyId: string;
  signals: TradeSignal[];
  trades: CompletedTrade[];
  equity: EquityPoint[];
  metrics: BacktestMetrics;
  error?: string;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  code: string;
  enabled: boolean;
}

export interface MarketDataResponse {
  symbol: string;
  bars: PriceBar[];
  periodStart: string;
  meta: {
    currency: string;
    exchange: string;
    timezone: string;
    provider: string;
    fetchedAt: string;
    adjusted: boolean;
    warning?: string;
  };
}

export interface RunSettings {
  startingCapital: number;
  feePct: number;
  slippagePct: number;
}
