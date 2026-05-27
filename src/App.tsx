import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Info,
  KeyRound,
  LineChart as LineChartIcon,
  Lock,
  LogOut,
  PieChart,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  User,
  Wallet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  applyStateLookback,
  classifyMarketState,
  loadMarketDataset,
  type Candle,
  type MarketDataset,
  type MarketState,
  type StockSymbol,
} from "./data/market";

type Screen = "stocks" | "portfolio" | "strategies" | "settings";
type ChartMode = "price" | "candles" | "volume" | "returns";
type StrategyUniverseMode = "all" | "top10-volume" | "top20-volume";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MARKET_STATES: MarketState[] = ["Bull", "Sideways", "Bear"];
const DEFAULT_STATE_LOOKBACK = 21;
const DEFAULT_ALPACA_ENDPOINT = "https://paper-api.alpaca.markets/v2";
const LIVE_ALPACA_ENDPOINT = "https://api.alpaca.markets/v2";
const RECOMMENDATION_WINDOWS = [1, 7, 14, 21, 60] as const;
const PORTFOLIO_PL_WINDOWS = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "1 year", days: 365 },
] as const;
const TECHNICAL_SIGNAL_DEFINITIONS = [
  {
    key: "smaTrend",
    label: "SMA 20/50 trend",
    group: "Trend",
    defaultWeight: 1.2,
    description: "Compares the 20-day simple moving average with the 50-day average.",
    decision: "Positive means the shorter trend is above the medium trend, often supporting buy or hold. Negative means trend is weakening and deserves caution.",
  },
  {
    key: "emaMacd",
    label: "EMA MACD",
    group: "Trend",
    defaultWeight: 1.1,
    description: "Measures the distance between fast and slow exponential moving-average momentum.",
    decision: "Positive MACD pressure suggests momentum is improving. Negative pressure suggests momentum is fading or reversing.",
  },
  {
    key: "priceVsSma200",
    label: "Price vs SMA 200",
    group: "Trend",
    defaultWeight: 0.9,
    description: "Shows whether the stock trades above or below its long-term 200-day average.",
    decision: "Above SMA 200 is usually constructive for longer holds. Below SMA 200 often means avoid or reduce unless another setup is very strong.",
  },
  {
    key: "roc20",
    label: "20d rate of change",
    group: "Momentum",
    defaultWeight: 1,
    description: "Measures the stock return over the last 20 trading days.",
    decision: "Strong positive ROC confirms momentum. Very negative ROC warns that sellers are in control.",
  },
  {
    key: "rsi14",
    label: "RSI 14",
    group: "Momentum",
    defaultWeight: 0.8,
    description: "Relative Strength Index estimates whether recent gains are stronger than recent losses.",
    decision: "Middle-to-high RSI can support momentum. Extremely high RSI can be overbought; very low RSI can be a rebound candidate but risky.",
  },
  {
    key: "stochastic14",
    label: "Stochastic 14",
    group: "Momentum",
    defaultWeight: 0.65,
    description: "Compares the latest close to the recent 14-day high-low range.",
    decision: "High values show price closing near recent highs. Very low values can mean weakness, or an early mean-reversion setup if other signals agree.",
  },
  {
    key: "bollinger20",
    label: "Bollinger position",
    group: "Mean reversion",
    defaultWeight: 0.7,
    description: "Measures how far price is from the 20-day average relative to recent volatility bands.",
    decision: "Far below the band can suggest a rebound setup. Far above the band can suggest stretched price where chasing is risky.",
  },
  {
    key: "atr14",
    label: "ATR risk",
    group: "Volatility",
    defaultWeight: 0.75,
    description: "Average True Range estimates how much the stock typically moves each day.",
    decision: "Lower ATR is usually easier to size and hold. Higher ATR means larger stops, smaller position size, or avoiding the trade.",
  },
  {
    key: "volumeRatio",
    label: "Volume 5/20",
    group: "Volume",
    defaultWeight: 0.7,
    description: "Compares recent 5-day volume with the 20-day volume average.",
    decision: "Rising price on higher volume strengthens a buy signal. Falling price on higher volume warns of distribution or liquidation.",
  },
  {
    key: "obvTrend",
    label: "OBV trend",
    group: "Volume",
    defaultWeight: 0.65,
    description: "On-Balance Volume accumulates volume on up days and subtracts volume on down days.",
    decision: "Rising OBV suggests accumulation. Falling OBV suggests sellers dominate even if price has not broken down yet.",
  },
  {
    key: "breakout20",
    label: "20d breakout",
    group: "Breakout",
    defaultWeight: 0.95,
    description: "Measures where price sits inside its recent 20-day high-low range.",
    decision: "Near a new high supports breakout buying if volume and market state agree. Near the low warns against buying too early.",
  },
  {
    key: "gap",
    label: "Gap pressure",
    group: "Gap",
    defaultWeight: 0.55,
    description: "Measures how much today opened above or below the previous close.",
    decision: "Positive gaps can signal demand, especially over resistance. Negative gaps often mean risk is rising and entries should wait.",
  },
  {
    key: "relativeSpy20",
    label: "20d vs SPY",
    group: "Relative",
    defaultWeight: 1.05,
    description: "Compares the stock's 20-day return against SPY over the same period.",
    decision: "Positive relative strength means the stock is outperforming the market. Negative relative strength means capital may be better deployed elsewhere.",
  },
  {
    key: "goldenCross50_200",
    label: "SMA 50/200 cross",
    group: "Trend",
    defaultWeight: 0.85,
    description: "Compares the 50-day moving average with the long-term 200-day moving average.",
    decision: "Positive values favor long-term trend following. Negative values warn that the stock is below its longer-term trend structure.",
  },
  {
    key: "adxTrend",
    label: "ADX trend strength",
    group: "Trend",
    defaultWeight: 0.7,
    description: "Approximates ADX-style directional strength from recent directional movement and true range.",
    decision: "A strong positive trend supports buy/hold. A strong negative trend supports caution or sell. Weak values mean the market is choppy.",
  },
  {
    key: "cci20",
    label: "CCI 20",
    group: "Momentum",
    defaultWeight: 0.6,
    description: "Commodity Channel Index compares typical price with its recent average deviation.",
    decision: "Positive CCI supports momentum. Very negative CCI warns of weakness, though it can also become a rebound setup with confirmation.",
  },
  {
    key: "williamsR14",
    label: "Williams %R 14",
    group: "Momentum",
    defaultWeight: 0.55,
    description: "Shows where the close sits inside the recent 14-day high-low range on a -100 to 0 scale.",
    decision: "Near zero means price is closing near highs. Deeply negative values show weakness or possible oversold conditions.",
  },
  {
    key: "mfi14",
    label: "MFI 14",
    group: "Volume",
    defaultWeight: 0.65,
    description: "Money Flow Index is RSI-like momentum that includes both price and volume.",
    decision: "Rising MFI supports accumulation. Very high MFI can be crowded; very low MFI can be a risky rebound candidate.",
  },
  {
    key: "chaikinMoneyFlow20",
    label: "Chaikin money flow 20",
    group: "Volume",
    defaultWeight: 0.7,
    description: "Measures whether volume is flowing into closes near the top or bottom of each daily range.",
    decision: "Positive CMF suggests accumulation. Negative CMF suggests distribution and weak sponsorship.",
  },
  {
    key: "accumulationDistributionTrend",
    label: "A/D line trend",
    group: "Volume",
    defaultWeight: 0.6,
    description: "Tracks the accumulation/distribution line and compares its short trend with its medium trend.",
    decision: "Positive A/D trend means volume-adjusted closes are improving. Negative trend warns that sellers may be quietly dominating.",
  },
  {
    key: "keltner20",
    label: "Keltner position",
    group: "Volatility",
    defaultWeight: 0.55,
    description: "Compares price with an EMA channel based on ATR volatility.",
    decision: "Above the channel can confirm trend strength but may be stretched. Below the channel warns of downside pressure.",
  },
  {
    key: "donchian55",
    label: "Donchian 55 position",
    group: "Breakout",
    defaultWeight: 0.8,
    description: "Shows where price is inside the 55-day breakout range.",
    decision: "Near the range high supports trend breakout logic. Near the range low warns that the stock is not leading.",
  },
  {
    key: "squeeze20",
    label: "Volatility squeeze",
    group: "Volatility",
    defaultWeight: 0.45,
    description: "Measures Bollinger bandwidth to identify compressed volatility before possible expansion.",
    decision: "A squeeze with positive momentum can favor an upside breakout. A squeeze with negative momentum warns of downside expansion.",
  },
  {
    key: "choppiness14",
    label: "Choppiness 14",
    group: "Regime",
    defaultWeight: 0.55,
    description: "Estimates whether recent movement is directional or noisy and range-bound.",
    decision: "Lower choppiness is better for trend trades. High choppiness favors smaller size or waiting.",
  },
  {
    key: "downsideVolatility20",
    label: "Downside volatility",
    group: "Risk",
    defaultWeight: 0.7,
    description: "Measures volatility from negative-return days over the recent window.",
    decision: "Low downside volatility supports holding. High downside volatility means stops and position size matter more.",
  },
  {
    key: "betaSpy60",
    label: "Beta vs SPY 60",
    group: "Relative",
    defaultWeight: 0.5,
    description: "Estimates how sensitive the stock is to SPY over roughly 60 trading days.",
    decision: "Lower or moderate beta can reduce portfolio risk. Very high beta needs stronger conviction and smaller sizing.",
  },
  {
    key: "correlationSpy60",
    label: "Correlation vs SPY",
    group: "Relative",
    defaultWeight: 0.45,
    description: "Measures how closely the stock has moved with SPY recently.",
    decision: "High correlation helps in strong markets. In weak markets, lower correlation can be more defensive.",
  },
  {
    key: "dollarVolumeTrend",
    label: "Dollar volume trend",
    group: "Liquidity",
    defaultWeight: 0.55,
    description: "Compares recent traded dollar volume with its 20-day baseline.",
    decision: "Expanding dollar volume on up moves confirms participation. Expanding dollar volume on down moves is a warning.",
  },
  {
    key: "supportDistance20",
    label: "Distance from support",
    group: "Support/resistance",
    defaultWeight: 0.45,
    description: "Measures how far price is above the recent 20-day low support area.",
    decision: "A healthy distance above support confirms recovery. Too close to support means the stock can break down quickly.",
  },
  {
    key: "resistanceDistance20",
    label: "Distance to resistance",
    group: "Support/resistance",
    defaultWeight: 0.55,
    description: "Measures how far price is below the recent 20-day high resistance area.",
    decision: "Small distance to resistance supports breakout watchlists. Large distance means price is still far from proving strength.",
  },
  {
    key: "high52wDistance",
    label: "Distance from 52w high",
    group: "Positioning",
    defaultWeight: 0.65,
    description: "Measures how far price is below the highest high of the last year.",
    decision: "Stocks near 52-week highs often lead in momentum regimes. Deep discounts need stronger reversal evidence.",
  },
  {
    key: "low52wRebound",
    label: "Rebound from 52w low",
    group: "Positioning",
    defaultWeight: 0.45,
    description: "Measures how much the stock has recovered from its lowest low of the last year.",
    decision: "A meaningful rebound shows buyers have stepped in. A stock near yearly lows is usually lower quality for long trades.",
  },
] as const;
const VISIBLE_TIMEFRAME_OPTIONS = [
  { id: "2h", label: "2h", days: 1 },
  { id: "24h", label: "24h", days: 1 },
  { id: "7d", label: "7d", days: 7 },
  { id: "14d", label: "14d", days: 14 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "180d", label: "180d", days: 180 },
  { id: "1y", label: "1y", days: 260 },
  { id: "2y", label: "2y", days: 520 },
  { id: "5y", label: "5y", days: 1300 },
] as const;
const CHART_AGGREGATION_OPTIONS = [
  { id: "1m", label: "1 minute", minutes: 1 },
  { id: "15m", label: "15 minutes", minutes: 15 },
  { id: "30m", label: "30 minutes", minutes: 30 },
  { id: "1h", label: "1h", minutes: 60 },
  { id: "4h", label: "4h", minutes: 240 },
  { id: "1d", label: "1d", minutes: 1440 },
] as const;

type VisibleTimeframeKey = (typeof VISIBLE_TIMEFRAME_OPTIONS)[number]["id"];
type ChartAggregationKey = (typeof CHART_AGGREGATION_OPTIONS)[number]["id"];

type ChartCandle = Candle & {
  chartState: MarketState;
  chartRisk: StockSymbol["risk"];
  gapReturn: number;
  gapUp: boolean;
};

type StateBand = {
  start: string;
  end: string;
  state: MarketState;
  count: number;
};

type RiskBand = {
  start: string;
  end: string;
  risk: StockSymbol["risk"];
  count: number;
};

type RecommendationStackBand = {
  start: string;
  end: string;
  action: RecommendationAction;
  count: number;
  trendReturn: number;
  risk: StockSymbol["risk"];
};

type RecommendationStackRow = {
  days: number;
  latestAction: RecommendationAction;
  bands: RecommendationStackBand[];
};

type MarkovModel = {
  currentState: MarketState;
  probabilities: Record<MarketState, number>;
  matrix: Record<MarketState, Record<MarketState, number>>;
  transitions: number;
};

type VolumeStateRiskSignal = {
  signalDate: string;
  date: string;
  riskOffProb: number;
  stateChangeProb: number;
  predictedSpyReturn5d: number;
  breadthPositive: number;
  volumeRatioMean: number;
  volumeRatioP90: number;
  downDollarVolumeShare: number;
  spyVolatility10d: number;
  leaderRelativeMomentumMean: number;
  leaderVolumeShapeMean: number;
  volumeStateRiskScore: number;
  riskOff: boolean;
  liquidationRisk: boolean;
  rotationRisk: boolean;
  leaderRisk: boolean;
};

type IntradayCachePayload = {
  symbol: string;
  source: string;
  start: string;
  end: string;
  rows: Candle[];
};

type StockVolumeFactor = {
  tone: StockSymbol["risk"];
  ratio5v20: number;
  acceleration5d: number;
  downVolumeShare10d: number;
  abnormalVolumeDays10d: number;
};

type TechnicalSignalKey = (typeof TECHNICAL_SIGNAL_DEFINITIONS)[number]["key"];
type SignalWeights = Record<TechnicalSignalKey, number>;
type TechnicalSignalSnapshot = {
  date: string;
  scores: Record<TechnicalSignalKey, number>;
  values: Record<TechnicalSignalKey, number>;
};
type TechnicalSignalCache = {
  cacheKey: string;
  generatedAt: string;
  symbols: Record<string, TechnicalSignalSnapshot[]>;
};
type WeightedTechnicalSignal = {
  score: number;
  action: RecommendationAction;
  confidence: number;
  contributions: Array<{ key: TechnicalSignalKey; label: string; group: string; score: number; weight: number; contribution: number; value: number }>;
};

type TradingStrategy = {
  id: string;
  name: string;
  description: string;
  weights: SignalWeights;
  createdAt: string;
  updatedAt: string;
};

type StrategyBacktestPoint = {
  date: string;
  value: number;
  cash: number;
  holdings: number;
  spy: number;
  trades: number;
};

type StrategyBacktestResult = {
  strategyId: string;
  name: string;
  endingValue: number;
  returnPct: number;
  spyReturnPct: number;
  alphaPct: number;
  maxDrawdownPct: number;
  winRate: number;
  trades: number;
  buys: number;
  sells: number;
  openPositions: number;
  points: StrategyBacktestPoint[];
};

type RecommendationAction = "Strong Buy" | "Buy" | "Hold" | "Sell";
type TableSortKey = "recommendation" | "confidence" | "gapUps" | "trend" | "change" | "weight" | "volume" | "state" | "risk" | "symbol";
type RecommendationFilter = "all" | RecommendationAction;
type StateFilter = "all" | MarketState;
type RiskFilter = "all" | StockSymbol["risk"];
type WindowedRecommendations = Record<number, TradeRecommendation>;

type TradeRecommendation = {
  action: RecommendationAction;
  score: number;
  confidence: number;
  reason: string;
};

type PortfolioHolding = {
  symbol: string;
  shares: number;
  marketValue: number;
  averageCost: number;
  profitLoss: number;
  firstBuyDate: string;
  holdingDays: number;
  stock: StockSymbol;
  recommendation: TradeRecommendation;
};

type AlpacaCredentials = {
  endpoint: string;
  apiKey: string;
  secret: string;
  accountId?: string;
};

type AlpacaAccount = Record<string, string | number | boolean | null | undefined> & {
  cash?: string;
  equity?: string;
  portfolio_value?: string;
  buying_power?: string;
  status?: string;
};

type AlpacaPosition = {
  symbol: string;
  qty: string;
  market_value?: string;
  avg_entry_price?: string;
  unrealized_pl?: string;
  current_price?: string;
  asset_class?: string;
};

type AlpacaPortfolioHistory = {
  timestamp?: number[];
  equity?: Array<number | string>;
  profit_loss?: Array<number | string>;
};

type PortfolioProfitLossPeriod = {
  label: string;
  days: number;
  value: number | null;
  percent: number | null;
  complete: boolean;
};

type AlpacaFillEvent = {
  id: string;
  date: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
};

type AlpacaOrder = Record<string, string | number | boolean | null | undefined> & {
  id: string;
  submitted_at?: string;
  filled_at?: string;
  symbol: string;
  side: "buy" | "sell";
  qty?: string;
  filled_qty?: string;
  type?: string;
  time_in_force?: string;
  status?: string;
  limit_price?: string | null;
  filled_avg_price?: string | null;
};

type AlpacaOrderRequest = {
  symbol?: string;
  qty?: string;
  notional?: string;
  side?: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
  time_in_force: "day" | "gtc" | "opg" | "cls" | "ioc" | "fok";
  limit_price?: string;
  stop_price?: string;
  trail_price?: string;
  trail_percent?: string;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: "simple" | "bracket" | "oco" | "oto" | "mleg";
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string; limit_price?: string };
  position_intent?: "buy_to_open" | "buy_to_close" | "sell_to_open" | "sell_to_close";
  legs?: Array<Record<string, unknown>>;
  advanced_instructions?: Record<string, unknown>;
};

type AlpacaActivity = Record<string, string | number | boolean | null | undefined> & {
  id?: string;
  activity_type?: string;
  transaction_time?: string;
  date?: string;
  symbol?: string;
  side?: string;
  qty?: string;
  price?: string;
  net_amount?: string;
  type?: string;
};

type AlpacaPortfolioData = {
  account: AlpacaAccount;
  positions: AlpacaPosition[];
  history: AlpacaPortfolioHistory;
  orders: AlpacaOrder[];
  activities: AlpacaActivity[];
};

type PortfolioView = "overview" | "orders" | "activities" | "balances";
type MinuteSyncFeed = "iex" | "sip";
type SyncState = "idle" | "syncing" | "success" | "error";

type IntradaySyncResult = {
  symbol: string;
  added: number;
  rows: number;
  start: string;
  end: string;
  path: string;
};

type IntradaySyncResponse = {
  ok: boolean;
  error?: string;
  feed?: string;
  start?: string;
  symbolsRequested?: number;
  symbolsSynced?: number;
  barsAdded?: number;
  results?: IntradaySyncResult[];
};

type AlpacaSyncSummary = {
  barsAdded?: number;
  symbolsSynced?: number;
  portfolioSynced?: boolean;
  portfolio?: AlpacaPortfolioData;
  error?: string;
};

type RecommendedPortfolioTrade = {
  symbol: string;
  shares: number;
  estimatedCost: number;
  price: number;
  allocationWeight: number;
  stock: StockSymbol;
  recommendation: TradeRecommendation;
};

function stateClass(state: MarketState) {
  return state.toLowerCase();
}

function riskClass(risk: StockSymbol["risk"]) {
  return risk.toLowerCase();
}

function recommendationClass(action: RecommendationAction) {
  return action.toLowerCase().replace(/\s+/g, "-");
}

function recommendationRank(action: RecommendationAction) {
  return { "Strong Buy": 4, Buy: 3, Hold: 2, Sell: 1 }[action];
}

function recommendationScore(action: RecommendationAction) {
  return { "Strong Buy": 2, Buy: 1, Hold: 0, Sell: -1 }[action];
}

function recommendationShortLabel(action: RecommendationAction) {
  return action.toUpperCase();
}

function recommendationStackLabel(action: RecommendationAction) {
  return action === "Strong Buy" ? "SB" : action.toUpperCase();
}

function defaultSignalWeights(): SignalWeights {
  return Object.fromEntries(
    TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => [definition.key, definition.defaultWeight]),
  ) as SignalWeights;
}

function loadSignalWeights(): SignalWeights {
  const defaults = defaultSignalWeights();
  try {
    const parsed = JSON.parse(localStorage.getItem("technical_signal_weights") ?? "{}") as Partial<Record<TechnicalSignalKey, number>>;
    return Object.fromEntries(
      TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => {
        const value = Number(parsed[definition.key]);
        return [definition.key, Number.isFinite(value) ? value : defaults[definition.key]];
      }),
    ) as SignalWeights;
  } catch {
    return defaults;
  }
}

function saveSignalWeights(weights: SignalWeights) {
  localStorage.setItem("technical_signal_weights", JSON.stringify(weights));
}

function normalizeSignalWeights(weights: Partial<Record<TechnicalSignalKey, number>> | undefined): SignalWeights {
  const defaults = defaultSignalWeights();
  return Object.fromEntries(
    TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => {
      const value = Number(weights?.[definition.key]);
      return [definition.key, Number.isFinite(value) ? value : defaults[definition.key]];
    }),
  ) as SignalWeights;
}

function scaleSignalWeights(base: SignalWeights, multipliers: Partial<Record<TechnicalSignalKey, number>>, mutedGroups: string[] = []): SignalWeights {
  return Object.fromEntries(
    TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => {
      if (mutedGroups.includes(definition.group)) {
        return [definition.key, 0];
      }
      return [definition.key, Number(((base[definition.key] ?? 0) * (multipliers[definition.key] ?? 1)).toFixed(2))];
    }),
  ) as SignalWeights;
}

function starterStrategies(): TradingStrategy[] {
  const now = new Date().toISOString();
  const defaults = defaultSignalWeights();
  const trendMomentum = scaleSignalWeights(defaults, {
    smaTrend: 1.65,
    emaMacd: 1.55,
    priceVsSma200: 1.45,
    roc20: 1.55,
    goldenCross50_200: 1.6,
    adxTrend: 1.5,
    relativeSpy20: 1.35,
    bollinger20: 0.35,
    choppiness14: 1.25,
  });
  const breakout = scaleSignalWeights(defaults, {
    breakout20: 1.8,
    donchian55: 1.8,
    volumeRatio: 1.45,
    dollarVolumeTrend: 1.45,
    gap: 1.35,
    resistanceDistance20: 1.55,
    relativeSpy20: 1.25,
    squeeze20: 1.2,
  });
  const volumeFlow = scaleSignalWeights(defaults, {
    volumeRatio: 1.7,
    obvTrend: 1.6,
    mfi14: 1.45,
    chaikinMoneyFlow20: 1.7,
    accumulationDistributionTrend: 1.55,
    dollarVolumeTrend: 1.55,
    downsideVolatility20: 1.2,
  });
  const defensive = scaleSignalWeights(defaults, {
    atr14: 1.75,
    downsideVolatility20: 1.8,
    betaSpy60: 1.65,
    correlationSpy60: 1.25,
    priceVsSma200: 1.2,
    choppiness14: 1.45,
    supportDistance20: 1.25,
  });
  const meanReversion = scaleSignalWeights(defaults, {
    bollinger20: 1.85,
    rsi14: 1.6,
    stochastic14: 1.45,
    williamsR14: 1.45,
    cci20: 1.35,
    supportDistance20: 1.2,
    emaMacd: 0.55,
    breakout20: 0.4,
    donchian55: 0.4,
  });
  const lowVolatilityCompounder = scaleSignalWeights(defaults, {
    atr14: 2.05,
    downsideVolatility20: 2.05,
    betaSpy60: 1.85,
    choppiness14: 1.55,
    priceVsSma200: 1.45,
    goldenCross50_200: 1.35,
    supportDistance20: 1.35,
    gap: 0.45,
    squeeze20: 0.55,
  });
  const riskOffCapitalPreservation = scaleSignalWeights(defaults, {
    atr14: 2.35,
    downsideVolatility20: 2.45,
    betaSpy60: 2.2,
    correlationSpy60: 1.8,
    choppiness14: 1.8,
    priceVsSma200: 1.6,
    supportDistance20: 1.5,
    resistanceDistance20: 0.55,
    gap: 0.25,
    breakout20: 0.25,
    donchian55: 0.25,
    squeeze20: 0.25,
  });
  const spyRelativeLeader = scaleSignalWeights(defaults, {
    relativeSpy20: 2.1,
    priceVsSma200: 1.55,
    roc20: 1.7,
    smaTrend: 1.5,
    emaMacd: 1.35,
    high52wDistance: 1.55,
    low52wRebound: 1.15,
    betaSpy60: 1.1,
    correlationSpy60: 0.85,
  });
  const qualityBreakoutRiskGuard = scaleSignalWeights(defaults, {
    breakout20: 1.7,
    donchian55: 1.65,
    resistanceDistance20: 1.45,
    volumeRatio: 1.35,
    dollarVolumeTrend: 1.35,
    atr14: 1.65,
    downsideVolatility20: 1.75,
    betaSpy60: 1.45,
    choppiness14: 1.4,
  });
  const cashConservative = scaleSignalWeights(defaults, {
    atr14: 2.7,
    downsideVolatility20: 2.75,
    betaSpy60: 2.45,
    correlationSpy60: 2.0,
    choppiness14: 2.1,
    volumeRatio: 0.45,
    gap: 0.15,
    breakout20: 0.1,
    donchian55: 0.1,
    squeeze20: 0,
    bollinger20: 0,
    stochastic14: 0.4,
    williamsR14: 0.4,
  });
  const rotationRecovery = scaleSignalWeights(defaults, {
    low52wRebound: 1.85,
    supportDistance20: 1.6,
    chaikinMoneyFlow20: 1.55,
    accumulationDistributionTrend: 1.5,
    mfi14: 1.35,
    rsi14: 1.25,
    cci20: 1.25,
    relativeSpy20: 1.2,
    high52wDistance: 0.65,
    betaSpy60: 1.35,
    downsideVolatility20: 1.35,
  });
  const researchTrendQualityHold3d = scaleSignalWeights(defaults, {
    roc20: 2.1,
    smaTrend: 1.65,
    emaMacd: 1.45,
    breakout20: 1.75,
    donchian55: 1.35,
    priceVsSma200: 1.45,
    goldenCross50_200: 1.25,
    atr14: 1.85,
    downsideVolatility20: 1.75,
    choppiness14: 1.45,
    volumeRatio: 1.1,
    relativeSpy20: 1.25,
  });
  const researchTrendQualityAvoidFailedGap = scaleSignalWeights(defaults, {
    roc20: 2.05,
    smaTrend: 1.65,
    emaMacd: 1.35,
    breakout20: 1.65,
    donchian55: 1.25,
    volumeRatio: 1.35,
    dollarVolumeTrend: 1.35,
    chaikinMoneyFlow20: 1.25,
    resistanceDistance20: 1.15,
    gap: 0.15,
    atr14: 1.9,
    downsideVolatility20: 1.85,
    choppiness14: 1.5,
  });
  const researchRelativeMomentumExit = scaleSignalWeights(defaults, {
    relativeSpy20: 2.55,
    roc20: 1.75,
    high52wDistance: 1.5,
    priceVsSma200: 1.35,
    smaTrend: 1.25,
    betaSpy60: 1.55,
    downsideVolatility20: 1.8,
    atr14: 1.55,
    choppiness14: 1.45,
    breakout20: 0.55,
    gap: 0.25,
  });
  const researchHybridMarkovTrend = scaleSignalWeights(defaults, {
    roc20: 1.7,
    relativeSpy20: 1.75,
    smaTrend: 1.45,
    emaMacd: 1.35,
    breakout20: 1.25,
    donchian55: 1.2,
    priceVsSma200: 1.35,
    volumeRatio: 1.2,
    dollarVolumeTrend: 1.15,
    atr14: 1.45,
    downsideVolatility20: 1.45,
    choppiness14: 1.35,
    correlationSpy60: 1.2,
  });
  const researchVolumeStateLeaderGate = scaleSignalWeights(defaults, {
    roc20: 1.95,
    relativeSpy20: 1.95,
    volumeRatio: 1.65,
    dollarVolumeTrend: 1.65,
    obvTrend: 1.4,
    chaikinMoneyFlow20: 1.45,
    accumulationDistributionTrend: 1.35,
    atr14: 1.95,
    downsideVolatility20: 2.05,
    betaSpy60: 1.75,
    choppiness14: 1.65,
    gap: 0.45,
    squeeze20: 0.65,
  });
  const researchAdaptiveMarkovConfirmed = scaleSignalWeights(defaults, {
    relativeSpy20: 1.7,
    roc20: 1.35,
    smaTrend: 1.2,
    emaMacd: 1.15,
    priceVsSma200: 1.2,
    choppiness14: 1.85,
    atr14: 1.75,
    downsideVolatility20: 1.85,
    betaSpy60: 1.4,
    correlationSpy60: 1.35,
    volumeRatio: 0.8,
    gap: 0.2,
    breakout20: 0.65,
  });
  const researchLiquidTop10Trend = scaleSignalWeights(defaults, {
    roc20: 2.2,
    relativeSpy20: 1.6,
    volumeRatio: 1.55,
    dollarVolumeTrend: 1.65,
    breakout20: 1.65,
    donchian55: 1.35,
    high52wDistance: 1.35,
    priceVsSma200: 1.35,
    atr14: 1.6,
    downsideVolatility20: 1.55,
    choppiness14: 1.25,
  });

  return [
    {
      id: "default-balanced",
      name: "Balanced signal mix",
      description: "Default weighted blend across trend, momentum, volume, risk, and relative strength.",
      weights: defaults,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "trend-momentum",
      name: "Trend momentum",
      description: "Favors sustained uptrends, positive MACD, 50/200 structure, and SPY-relative strength.",
      weights: trendMomentum,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "breakout-volume",
      name: "Breakout with volume",
      description: "Looks for range breakouts, gap pressure, resistance tests, and expanding traded volume.",
      weights: breakout,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "volume-accumulation",
      name: "Volume accumulation",
      description: "Prioritizes money flow, OBV, accumulation/distribution, and dollar-volume confirmation.",
      weights: volumeFlow,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "risk-controlled",
      name: "Risk controlled",
      description: "Penalizes downside volatility, high beta, high ATR, and noisy regimes more aggressively.",
      weights: defensive,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mean-reversion",
      name: "Mean reversion",
      description: "Leans on RSI, stochastic, Williams %R, CCI, and Bollinger position while muting breakouts.",
      weights: meanReversion,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "low-volatility-compounder",
      name: "Low volatility compounder",
      description: "Prefers calm uptrends with lower ATR, lower downside volatility, moderate beta, and solid long-term trend support.",
      weights: lowVolatilityCompounder,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "risk-off-capital-preservation",
      name: "Risk-off capital preservation",
      description: "Very defensive profile that heavily penalizes high volatility, high beta, high correlation, choppy action, and speculative breakouts.",
      weights: riskOffCapitalPreservation,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "spy-relative-leader",
      name: "SPY relative leader",
      description: "Searches for stocks beating SPY while staying above long-term trend and near leadership territory.",
      weights: spyRelativeLeader,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "quality-breakout-risk-guard",
      name: "Quality breakout risk guard",
      description: "Combines breakout and volume confirmation with stronger risk filters to avoid fragile high-volatility breakouts.",
      weights: qualityBreakoutRiskGuard,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "cash-conservative",
      name: "Cash conservative",
      description: "Keeps recommendations sparse by muting aggressive signals and requiring unusually clean risk conditions.",
      weights: cashConservative,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "rotation-recovery",
      name: "Rotation recovery",
      description: "Looks for improving money flow and rebounds from support while still applying beta and downside-volatility checks.",
      weights: rotationRecovery,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-trend-quality-hold-3d",
      name: "Research: trend quality 3d",
      description: "Imported from trading-autoresearch. Recent 2026 slice: +17.83% vs SPY +9.65%; strict liquid multi-year average: +25.65% return and +14.61% alpha, but with large 2022 drawdown.",
      weights: researchTrendQualityHold3d,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-trend-quality-gap-filter",
      name: "Research: trend quality gap filter",
      description: "Imported from trading-autoresearch. Approximates trend_quality_avoid_failed_gap_hold_3d; recent 2026 diagnostic: +29.90% vs SPY +9.65%, using gap-failure awareness instead of buying every gap.",
      weights: researchTrendQualityAvoidFailedGap,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-relative-momentum-exit",
      name: "Research: relative momentum exit",
      description: "Imported from trading-autoresearch. Lower-turnover relative-strength candidate; 2026 slice: +11.49% vs SPY +9.65% with -6.15% max drawdown, and top-10 2026 YTD: +21.86% vs SPY +9.78%.",
      weights: researchRelativeMomentumExit,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-hybrid-markov-trend",
      name: "Research: hybrid Markov trend",
      description: "Imported from trading-autoresearch. Blends trend quality and relative momentum with this app's built-in Markov/state component; 2026 slice: +14.76% vs SPY +9.65%.",
      weights: researchHybridMarkovTrend,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-volume-state-leader-gate",
      name: "Research: volume-state leader gate",
      description: "Imported from trading-autoresearch. Approximates the leader-aware volume-state gate: average alpha +11.49% over tested folds, with improved worst alpha and drawdown versus the hard gate.",
      weights: researchVolumeStateLeaderGate,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-adaptive-markov-confirmed",
      name: "Research: adaptive Markov confirmed",
      description: "Imported from trading-autoresearch. Inspired by adaptive 10d confirmed_signal_exit_max10, which showed +26.99% vs SPY +9.65% on the 2026 slice with -4.75% max drawdown; not robust alone.",
      weights: researchAdaptiveMarkovConfirmed,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "research-liquid-top10-trend",
      name: "Research: liquid top-10 trend",
      description: "Imported from trading-autoresearch. Emphasizes the strict top-10 volume/value universe result where liquidity filtering helped trend-quality beat SPY in 5 of 6 yearly folds.",
      weights: researchLiquidTop10Trend,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function loadStrategies(): TradingStrategy[] {
  const starters = starterStrategies();
  try {
    const parsed = JSON.parse(localStorage.getItem("trading_signal_strategies") ?? "[]") as TradingStrategy[];
    if (Array.isArray(parsed) && parsed.length) {
      const normalized = parsed.map((strategy) => ({
        ...strategy,
        weights: normalizeSignalWeights(strategy.weights),
      }));
      const existingIds = new Set(normalized.map((strategy) => strategy.id));
      const missingStarters = starters.filter((strategy) => !existingIds.has(strategy.id));
      const merged = [...normalized, ...missingStarters];
      if (missingStarters.length) {
        saveStrategies(merged);
      }
      return merged;
    }
  } catch {
    // Fall through to starter strategies.
  }
  saveStrategies(starters);
  return starters;
}

function saveStrategies(strategies: TradingStrategy[]) {
  localStorage.setItem("trading_signal_strategies", JSON.stringify(strategies));
}

function stateRank(state: MarketState) {
  return { Bull: 3, Sideways: 2, Bear: 1 }[state];
}

function riskRank(risk: StockSymbol["risk"]) {
  return { Low: 3, Medium: 2, High: 1 }[risk];
}

function normalizeVisibleTimeframe(rawValue: string | null | undefined): VisibleTimeframeKey {
  if (VISIBLE_TIMEFRAME_OPTIONS.some((option) => option.id === rawValue)) {
    return rawValue as VisibleTimeframeKey;
  }

  const legacyDays = Number(rawValue);
  const legacyMatch = VISIBLE_TIMEFRAME_OPTIONS.find((option) => option.days === legacyDays && option.days > 1);
  return legacyMatch?.id ?? "90d";
}

function timeframeToDays(value: VisibleTimeframeKey) {
  return VISIBLE_TIMEFRAME_OPTIONS.find((option) => option.id === value)?.days ?? 90;
}

function timeframeToMilliseconds(value: VisibleTimeframeKey) {
  const days = timeframeToDays(value);
  if (value === "2h") {
    return 2 * 60 * 60_000;
  }
  if (value === "24h") {
    return 24 * 60 * 60_000;
  }
  return days * 24 * 60 * 60_000;
}

function visibleTimeframeLabel(value: VisibleTimeframeKey) {
  return VISIBLE_TIMEFRAME_OPTIONS.find((option) => option.id === value)?.label ?? value;
}

function autoChartAggregation(value: VisibleTimeframeKey): ChartAggregationKey {
  if (value === "2h") {
    return "1m";
  }
  if (value === "24h") {
    return "15m";
  }
  if (value === "7d") {
    return "30m";
  }
  if (value === "14d") {
    return "1h";
  }
  if (value === "30d") {
    return "4h";
  }
  return "1d";
}

function chartAggregationLabel(value: ChartAggregationKey) {
  return CHART_AGGREGATION_OPTIONS.find((option) => option.id === value)?.label ?? value;
}

function aggregationMinutes(value: ChartAggregationKey) {
  return CHART_AGGREGATION_OPTIONS.find((option) => option.id === value)?.minutes ?? 1440;
}

function volumeNumber(volume: string) {
  const clean = volume.trim().toUpperCase();
  const number = Number(clean.replace(/[BMK,]/g, ""));
  if (!Number.isFinite(number)) {
    return 0;
  }
  if (clean.endsWith("B")) {
    return number * 1_000_000_000;
  }
  if (clean.endsWith("M")) {
    return number * 1_000_000;
  }
  if (clean.endsWith("K")) {
    return number * 1_000;
  }
  return number;
}

function strategyUniverseLabel(mode: StrategyUniverseMode) {
  if (mode === "top10-volume") {
    return "Top 10 by volume";
  }
  if (mode === "top20-volume") {
    return "Top 20 by volume";
  }
  return "All cached symbols";
}

function strategyUniverseStocks(stocks: StockSymbol[], mode: StrategyUniverseMode) {
  if (mode === "all") {
    return stocks;
  }
  const limit = mode === "top10-volume" ? 10 : 20;
  const spy = stocks.find((stock) => stock.symbol === "SPY");
  const topByVolume = stocks
    .filter((stock) => stock.symbol !== "SPY")
    .sort((left, right) => volumeNumber(right.volume) - volumeNumber(left.volume) || left.symbol.localeCompare(right.symbol))
    .slice(0, limit);
  return spy ? [spy, ...topByVolume] : topByVolume;
}

function stateFromTrend(trendReturn: number): MarketState {
  if (trendReturn >= 5) {
    return "Bull";
  }
  if (trendReturn <= -5) {
    return "Bear";
  }
  return "Sideways";
}

function stateColor(state: MarketState, opacity = 0.14) {
  const color = state === "Bull" ? "22, 133, 111" : state === "Bear" ? "194, 65, 75" : "211, 154, 0";
  return `rgba(${color}, ${opacity})`;
}

function riskFromVolatility(volatility: number): StockSymbol["risk"] {
  if (volatility >= 0.028) {
    return "High";
  }
  if (volatility >= 0.016) {
    return "Medium";
  }
  return "Low";
}

function riskFromScore(score: number): StockSymbol["risk"] {
  if (score >= 0.8) {
    return "High";
  }
  if (score >= 0.55) {
    return "Medium";
  }
  return "Low";
}

function rollingRisk(candles: Candle[], index: number, window = 20): StockSymbol["risk"] {
  const start = Math.max(1, index - window + 1);
  const returns: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = candles[cursor - 1];
    const current = candles[cursor];
    if (previous?.close && current?.close) {
      returns.push(current.close / previous.close - 1);
    }
  }
  if (returns.length < 2) {
    return "Low";
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return riskFromVolatility(Math.sqrt(variance));
}

function clampScore(value: number, min = -1, max = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

function windowSlice<T>(rows: T[], index: number, window: number) {
  return rows.slice(Math.max(0, index - window + 1), index + 1);
}

function average(values: number[]) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return 0;
  }
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function rollingAverage(candles: Candle[], index: number, window: number, key: keyof Pick<Candle, "close" | "volume" | "high" | "low">) {
  return average(windowSlice(candles, index, window).map((candle) => Number(candle[key])));
}

function percentReturn(candles: Candle[], index: number, lookback: number) {
  const baseline = candles[Math.max(0, index - lookback)];
  const current = candles[index];
  return baseline?.close && current?.close ? (current.close / baseline.close - 1) * 100 : 0;
}

function emaValues(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  let previous = values[0] ?? 0;
  return values.map((value, index) => {
    previous = index === 0 ? value : value * multiplier + previous * (1 - multiplier);
    return previous;
  });
}

function rsiAt(candles: Candle[], index: number, window = 14) {
  const start = Math.max(1, index - window + 1);
  let gains = 0;
  let losses = 0;
  let count = 0;
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = candles[cursor - 1];
    const current = candles[cursor];
    if (!previous || !current) {
      continue;
    }
    const change = current.close - previous.close;
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
    count += 1;
  }
  if (!count || losses === 0) {
    return gains > 0 ? 100 : 50;
  }
  const relativeStrength = gains / count / (losses / count);
  return 100 - 100 / (1 + relativeStrength);
}

function atrPercentAt(candles: Candle[], index: number, window = 14) {
  const ranges = windowSlice(candles, index, window).map((candle, offset, rows) => {
    const sourceIndex = index - rows.length + 1 + offset;
    const previousClose = candles[sourceIndex - 1]?.close ?? candle.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const close = candles[index]?.close ?? 0;
  return close ? average(ranges) / close : 0;
}

function stochasticAt(candles: Candle[], index: number, window = 14) {
  const rows = windowSlice(candles, index, window);
  const high = Math.max(...rows.map((candle) => candle.high));
  const low = Math.min(...rows.map((candle) => candle.low));
  const close = candles[index]?.close ?? 0;
  return high > low ? ((close - low) / (high - low)) * 100 : 50;
}

function highestHigh(candles: Candle[], index: number, window: number) {
  return Math.max(...windowSlice(candles, index, window).map((candle) => candle.high));
}

function lowestLow(candles: Candle[], index: number, window: number) {
  return Math.min(...windowSlice(candles, index, window).map((candle) => candle.low));
}

function trueRangeAt(candles: Candle[], index: number) {
  const candle = candles[index];
  if (!candle) {
    return 0;
  }
  const previousClose = candles[index - 1]?.close ?? candle.close;
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
}

function simpleReturns(candles: Candle[], index: number, window: number) {
  const start = Math.max(1, index - window + 1);
  const returns: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = candles[cursor - 1];
    const current = candles[cursor];
    if (previous?.close && current?.close) {
      returns.push(current.close / previous.close - 1);
    }
  }
  return returns;
}

function covariance(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (length < 2) {
    return 0;
  }
  const leftRows = left.slice(left.length - length);
  const rightRows = right.slice(right.length - length);
  const leftAverage = average(leftRows);
  const rightAverage = average(rightRows);
  return leftRows.reduce((sum, value, index) => sum + (value - leftAverage) * (rightRows[index] - rightAverage), 0) / length;
}

function correlation(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (length < 2) {
    return 0;
  }
  const leftRows = left.slice(left.length - length);
  const rightRows = right.slice(right.length - length);
  const denominator = standardDeviation(leftRows) * standardDeviation(rightRows);
  return denominator ? covariance(leftRows, rightRows) / denominator : 0;
}

function directionalTrendAt(candles: Candle[], index: number, window = 14) {
  const start = Math.max(1, index - window + 1);
  let plusDm = 0;
  let minusDm = 0;
  let range = 0;
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = candles[cursor - 1];
    const current = candles[cursor];
    if (!previous || !current) {
      continue;
    }
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDm += upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm += downMove > upMove && downMove > 0 ? downMove : 0;
    range += trueRangeAt(candles, cursor);
  }
  const plusDi = range ? (plusDm / range) * 100 : 0;
  const minusDi = range ? (minusDm / range) * 100 : 0;
  const direction = plusDi - minusDi;
  const strength = plusDi + minusDi ? (Math.abs(direction) / (plusDi + minusDi)) * 100 : 0;
  return direction >= 0 ? strength : -strength;
}

function cciAt(candles: Candle[], index: number, window = 20) {
  const rows = windowSlice(candles, index, window);
  const typicalPrices = rows.map((candle) => (candle.high + candle.low + candle.close) / 3);
  const currentTypical = typicalPrices[typicalPrices.length - 1] ?? 0;
  const typicalAverage = average(typicalPrices);
  const meanDeviation = average(typicalPrices.map((value) => Math.abs(value - typicalAverage)));
  return meanDeviation ? (currentTypical - typicalAverage) / (0.015 * meanDeviation) : 0;
}

function moneyFlowIndexAt(candles: Candle[], index: number, window = 14) {
  const start = Math.max(1, index - window + 1);
  let positive = 0;
  let negative = 0;
  for (let cursor = start; cursor <= index; cursor += 1) {
    const previous = candles[cursor - 1];
    const current = candles[cursor];
    if (!previous || !current) {
      continue;
    }
    const previousTypical = (previous.high + previous.low + previous.close) / 3;
    const currentTypical = (current.high + current.low + current.close) / 3;
    const rawFlow = currentTypical * current.volume;
    if (currentTypical > previousTypical) {
      positive += rawFlow;
    } else if (currentTypical < previousTypical) {
      negative += rawFlow;
    }
  }
  if (!negative) {
    return positive ? 100 : 50;
  }
  return 100 - 100 / (1 + positive / negative);
}

function chaikinMoneyFlowAt(candles: Candle[], index: number, window = 20) {
  const rows = windowSlice(candles, index, window);
  const moneyVolume = rows.reduce((sum, candle) => {
    const range = candle.high - candle.low;
    const multiplier = range ? ((candle.close - candle.low) - (candle.high - candle.close)) / range : 0;
    return sum + multiplier * candle.volume;
  }, 0);
  const volume = rows.reduce((sum, candle) => sum + candle.volume, 0);
  return volume ? moneyVolume / volume : 0;
}

function choppinessAt(candles: Candle[], index: number, window = 14) {
  const rows = windowSlice(candles, index, window);
  if (rows.length < 2) {
    return 50;
  }
  const high = Math.max(...rows.map((candle) => candle.high));
  const low = Math.min(...rows.map((candle) => candle.low));
  const range = high - low;
  const trueRangeSum = rows.reduce((sum, _, offset) => sum + trueRangeAt(candles, index - rows.length + 1 + offset), 0);
  return range > 0 && trueRangeSum > 0 ? (100 * Math.log10(trueRangeSum / range)) / Math.log10(rows.length) : 50;
}

function withChartStates(candles: Candle[], lookbackDays: number): ChartCandle[] {
  return candles.map((candle, index) => {
    const baselineIndex = Math.max(0, index - Math.max(1, Math.round(lookbackDays)));
    const baseline = candles[baselineIndex];
    const previous = candles[index - 1];
    const trendReturn = baseline.close ? (candle.close / baseline.close - 1) * 100 : 0;
    const gapReturn = previous?.close ? (candle.open / previous.close - 1) * 100 : 0;
    return {
      ...candle,
      chartState: stateFromTrend(trendReturn),
      chartRisk: rollingRisk(candles, index),
      gapReturn: Number(gapReturn.toFixed(2)),
      gapUp: gapReturn >= 1,
    };
  });
}

function candleTime(candle: Candle) {
  const date = candle.date.includes("T") ? new Date(candle.date) : new Date(`${candle.date}T00:00:00`);
  return date.getTime();
}

function chartTickLabel(value: string | number) {
  const raw = String(value);
  if (!raw.includes("T")) {
    return raw;
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return raw;
  }
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function aggregateCandles(candles: Candle[], aggregation: ChartAggregationKey): Candle[] {
  const minutes = aggregationMinutes(aggregation);
  if (minutes <= 1) {
    return candles;
  }

  const bucketMs = minutes * 60_000;
  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    const time = candleTime(candle);
    if (!Number.isFinite(time)) {
      continue;
    }
    const bucket = Math.floor(time / bucketMs) * bucketMs;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), candle]);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, rows]) => {
      const sorted = [...rows].sort((left, right) => candleTime(left) - candleTime(right));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        date: new Date(bucket).toISOString().slice(0, first.date.includes("T") ? 16 : 10),
        open: first.open,
        high: Math.max(...sorted.map((row) => row.high)),
        low: Math.min(...sorted.map((row) => row.low)),
        close: last.close,
        volume: sorted.reduce((sum, row) => sum + row.volume, 0),
      };
    });
}

const technicalSignalMemoryCache = new Map<string, TechnicalSignalCache>();

function technicalCacheKey(dataset: MarketDataset) {
  return `${dataset.generatedAt}:${dataset.source}:${dataset.startDate}:${dataset.endDate}:${dataset.symbols.length}`;
}

function computeTechnicalSignalSnapshots(stock: StockSymbol, marketStock?: StockSymbol): TechnicalSignalSnapshot[] {
  const candles = stock.candles;
  const closes = candles.map((candle) => candle.close);
  const ema12 = emaValues(closes, 12);
  const ema20 = emaValues(closes, 20);
  const ema26 = emaValues(closes, 26);
  const macd = closes.map((_, index) => ema12[index] - ema26[index]);
  const macdSignal = emaValues(macd, 9);

  let obv = 0;
  const obvValues = candles.map((candle, index) => {
    const previous = candles[index - 1];
    if (previous) {
      obv += candle.close > previous.close ? candle.volume : candle.close < previous.close ? -candle.volume : 0;
    }
    return obv;
  });

  let accumulationDistribution = 0;
  const accumulationDistributionValues = candles.map((candle) => {
    const range = candle.high - candle.low;
    const multiplier = range ? ((candle.close - candle.low) - (candle.high - candle.close)) / range : 0;
    accumulationDistribution += multiplier * candle.volume;
    return accumulationDistribution;
  });

  return candles.map((candle, index) => {
    const previous = candles[index - 1];
    const sma20 = rollingAverage(candles, index, 20, "close");
    const sma50 = rollingAverage(candles, index, 50, "close");
    const sma200 = rollingAverage(candles, index, 200, "close");
    const closeStd20 = standardDeviation(windowSlice(candles, index, 20).map((row) => row.close));
    const bollingerPosition = closeStd20 ? (candle.close - sma20) / (2 * closeStd20) : 0;
    const volume5 = rollingAverage(candles, index, 5, "volume");
    const volume20 = rollingAverage(candles, index, 20, "volume");
    const volumeRatio = volume20 ? volume5 / volume20 : 1;
    const obv10 = average(windowSlice(obvValues, index, 10));
    const obv30 = average(windowSlice(obvValues, index, 30));
    const high20 = highestHigh(candles, index, 20);
    const low20 = lowestLow(candles, index, 20);
    const high14 = highestHigh(candles, index, 14);
    const low14 = lowestLow(candles, index, 14);
    const high55 = highestHigh(candles, index, 55);
    const low55 = lowestLow(candles, index, 55);
    const high252 = highestHigh(candles, index, 252);
    const low252 = lowestLow(candles, index, 252);
    const gapReturn = previous?.close ? (candle.open / previous.close - 1) * 100 : 0;
    const stockReturn20 = percentReturn(candles, index, 20);
    const marketReturn20 = marketStock ? percentReturn(marketStock.candles, Math.min(index, marketStock.candles.length - 1), 20) : 0;
    const atrPct = atrPercentAt(candles, index, 14);
    const atrValue = atrPct * candle.close;
    const rsi = rsiAt(candles, index, 14);
    const stochastic = stochasticAt(candles, index, 14);
    const dayReturn = previous?.close ? (candle.close / previous.close - 1) * 100 : 0;
    const ad10 = average(windowSlice(accumulationDistributionValues, index, 10));
    const ad30 = average(windowSlice(accumulationDistributionValues, index, 30));
    const adTrend = ad30 ? (ad10 / Math.abs(ad30)) * 100 : 0;
    const williamsR = high14 > low14 ? ((high14 - candle.close) / (high14 - low14)) * -100 : -50;
    const cci = cciAt(candles, index, 20);
    const mfi = moneyFlowIndexAt(candles, index, 14);
    const cmf = chaikinMoneyFlowAt(candles, index, 20);
    const keltnerPosition = atrValue ? (candle.close - ema20[index]) / (2 * atrValue) : 0;
    const donchianPosition = high55 > low55 ? ((candle.close - low55) / (high55 - low55)) * 100 : 50;
    const bollingerBandwidth = sma20 ? ((4 * closeStd20) / sma20) * 100 : 0;
    const choppiness = choppinessAt(candles, index, 14);
    const negativeReturns = simpleReturns(candles, index, 20).filter((value) => value < 0);
    const downsideVolatility = standardDeviation(negativeReturns) * Math.sqrt(252) * 100;
    const stockReturns60 = simpleReturns(candles, index, 60);
    const marketReturns60 = marketStock ? simpleReturns(marketStock.candles, Math.min(index, marketStock.candles.length - 1), 60) : [];
    const marketVariance60 = standardDeviation(marketReturns60) ** 2;
    const betaSpy60 = marketVariance60 ? covariance(stockReturns60, marketReturns60) / marketVariance60 : 1;
    const correlationSpy60 = marketReturns60.length ? correlation(stockReturns60, marketReturns60) : 0;
    const dollarVolumeRows = windowSlice(candles, index, 20).map((row) => row.close * row.volume);
    const dollarVolume5 = average(dollarVolumeRows.slice(-5));
    const dollarVolume20 = average(dollarVolumeRows);
    const dollarVolumeTrend = dollarVolume20 ? dollarVolume5 / dollarVolume20 : 1;
    const supportDistance20 = low20 ? (candle.close / low20 - 1) * 100 : 0;
    const resistanceDistance20 = candle.close ? (high20 / candle.close - 1) * 100 : 0;
    const high52wDistance = high252 ? (candle.close / high252 - 1) * 100 : 0;
    const low52wRebound = low252 ? (candle.close / low252 - 1) * 100 : 0;

    const values: Record<TechnicalSignalKey, number> = {
      smaTrend: sma50 ? (sma20 / sma50 - 1) * 100 : 0,
      emaMacd: candle.close ? ((macd[index] - macdSignal[index]) / candle.close) * 100 : 0,
      priceVsSma200: sma200 ? (candle.close / sma200 - 1) * 100 : 0,
      roc20: stockReturn20,
      rsi14: rsi,
      stochastic14: stochastic,
      bollinger20: bollingerPosition,
      atr14: atrPct * 100,
      volumeRatio,
      obvTrend: obv30 ? (obv10 / Math.abs(obv30)) * 100 : 0,
      breakout20: high20 > low20 ? ((candle.close - low20) / (high20 - low20)) * 100 : 50,
      gap: gapReturn,
      relativeSpy20: stockReturn20 - marketReturn20,
      goldenCross50_200: sma200 ? (sma50 / sma200 - 1) * 100 : 0,
      adxTrend: directionalTrendAt(candles, index, 14),
      cci20: cci,
      williamsR14: williamsR,
      mfi14: mfi,
      chaikinMoneyFlow20: cmf,
      accumulationDistributionTrend: adTrend,
      keltner20: keltnerPosition,
      donchian55: donchianPosition,
      squeeze20: bollingerBandwidth,
      choppiness14: choppiness,
      downsideVolatility20: downsideVolatility,
      betaSpy60,
      correlationSpy60,
      dollarVolumeTrend,
      supportDistance20,
      resistanceDistance20,
      high52wDistance,
      low52wRebound,
    };

    const scores: Record<TechnicalSignalKey, number> = {
      smaTrend: clampScore(values.smaTrend / 4),
      emaMacd: clampScore(values.emaMacd / 1.2),
      priceVsSma200: clampScore(values.priceVsSma200 / 18),
      roc20: clampScore(stockReturn20 / 12),
      rsi14: rsi > 70 ? clampScore((70 - rsi) / 20) : rsi < 30 ? clampScore((50 - rsi) / 20) : clampScore((rsi - 50) / 28),
      stochastic14: stochastic > 85 ? clampScore((85 - stochastic) / 20) : stochastic < 20 ? clampScore((45 - stochastic) / 25) : clampScore((stochastic - 50) / 45),
      bollinger20: clampScore(-bollingerPosition * 0.7),
      atr14: clampScore((0.035 - atrPct) / 0.035),
      volumeRatio: clampScore((volumeRatio - 1) * (dayReturn >= 0 ? 0.75 : -0.75)),
      obvTrend: clampScore(values.obvTrend / 55),
      breakout20: candle.close >= high20 * 0.995 ? 1 : candle.close <= low20 * 1.005 ? -1 : clampScore((values.breakout20 - 50) / 38),
      gap: clampScore(gapReturn / 3),
      relativeSpy20: clampScore(values.relativeSpy20 / 10),
      goldenCross50_200: clampScore(values.goldenCross50_200 / 8),
      adxTrend: clampScore(values.adxTrend / 45),
      cci20: clampScore(cci / 160),
      williamsR14: clampScore((williamsR + 50) / 35),
      mfi14: mfi > 82 ? clampScore((82 - mfi) / 22) : mfi < 25 ? clampScore((45 - mfi) / 24) : clampScore((mfi - 50) / 30),
      chaikinMoneyFlow20: clampScore(cmf * 3),
      accumulationDistributionTrend: clampScore(adTrend / 55),
      keltner20: clampScore(keltnerPosition > 1.8 ? 0.4 - (keltnerPosition - 1.8) * 0.35 : keltnerPosition / 1.4),
      donchian55: candle.close >= high55 * 0.995 ? 1 : candle.close <= low55 * 1.005 ? -1 : clampScore((donchianPosition - 50) / 38),
      squeeze20: clampScore(((12 - bollingerBandwidth) / 12) * (stockReturn20 >= 0 ? 0.9 : -0.9)),
      choppiness14: clampScore((55 - choppiness) / 25),
      downsideVolatility20: clampScore((22 - downsideVolatility) / 22),
      betaSpy60: clampScore((1.45 - betaSpy60) / 1.25),
      correlationSpy60: clampScore(correlationSpy60 * (marketReturn20 >= 0 ? 1 : -1)),
      dollarVolumeTrend: clampScore((dollarVolumeTrend - 1) * (dayReturn >= 0 ? 0.75 : -0.75)),
      supportDistance20: clampScore((supportDistance20 - 2) / 12),
      resistanceDistance20: clampScore((8 - resistanceDistance20) / 8),
      high52wDistance: clampScore((high52wDistance + 18) / 18),
      low52wRebound: clampScore((low52wRebound - 8) / 25),
    };

    return {
      date: candle.date,
      scores,
      values,
    };
  });
}

function buildCachedTechnicalSignals(dataset: MarketDataset): TechnicalSignalCache {
  const cacheKey = technicalCacheKey(dataset);
  const cached = technicalSignalMemoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const marketStock = dataset.symbols.find((stock) => stock.symbol === "SPY");
  const symbols = Object.fromEntries(
    dataset.symbols.map((stock) => [stock.symbol, computeTechnicalSignalSnapshots(stock, marketStock)]),
  ) as Record<string, TechnicalSignalSnapshot[]>;
  const cache = {
    cacheKey,
    generatedAt: new Date().toISOString(),
    symbols,
  };
  technicalSignalMemoryCache.set(cacheKey, cache);
  return cache;
}

function technicalSnapshotFor(cache: TechnicalSignalCache | null | undefined, symbol: string, date?: string) {
  const snapshots = cache?.symbols[symbol] ?? [];
  if (!date) {
    return snapshots[snapshots.length - 1];
  }
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshots[index].date <= date) {
      return snapshots[index];
    }
  }
  return snapshots[0];
}

function technicalAction(score: number): RecommendationAction {
  if (score >= 0.45) {
    return "Strong Buy";
  }
  if (score >= 0.16) {
    return "Buy";
  }
  if (score <= -0.25) {
    return "Sell";
  }
  return "Hold";
}

function weightedTechnicalSignal(snapshot: TechnicalSignalSnapshot | undefined, weights: SignalWeights): WeightedTechnicalSignal | null {
  if (!snapshot) {
    return null;
  }
  const contributions = TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => {
    const score = snapshot.scores[definition.key] ?? 0;
    const weight = weights[definition.key] ?? 0;
    return {
      key: definition.key,
      label: definition.label,
      group: definition.group,
      score,
      weight,
      contribution: score * weight,
      value: snapshot.values[definition.key] ?? 0,
    };
  });
  const weightTotal = contributions.reduce((sum, item) => sum + Math.abs(item.weight), 0);
  const score = weightTotal ? clampScore(contributions.reduce((sum, item) => sum + item.contribution, 0) / weightTotal) : 0;
  return {
    score,
    action: technicalAction(score),
    confidence: Math.round(Math.min(96, Math.max(34, 45 + Math.abs(score) * 55))),
    contributions,
  };
}

async function loadVolumeStateRiskSignals(): Promise<VolumeStateRiskSignal[]> {
  const response = await fetch("/data/volume-state-risk.json");
  if (!response.ok) {
    return [];
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return [];
  }
  try {
    const payload = (await response.json()) as { rows?: VolumeStateRiskSignal[] };
    return payload.rows ?? [];
  } catch {
    return [];
  }
}

async function loadIntradayCandles(symbol: string, cacheVersion = 0): Promise<IntradayCachePayload | null> {
  const suffix = cacheVersion ? `?v=${cacheVersion}` : "";
  const response = await fetch(`/data/intraday/${symbol}.json${suffix}`);
  if (!response.ok) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return null;
  }
  try {
    return (await response.json()) as IntradayCachePayload;
  } catch {
    return null;
  }
}

function latestVolumeStateSignal(signals: VolumeStateRiskSignal[], date: string): VolumeStateRiskSignal | null {
  let latest: VolumeStateRiskSignal | null = null;
  for (const signal of signals) {
    if (signal.date <= date && (!latest || signal.date > latest.date)) {
      latest = signal;
    }
  }
  return latest;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stockVolumeFactor(rows: ChartCandle[]): StockVolumeFactor {
  const latest = rows.slice(-30);
  const last5 = latest.slice(-5);
  const previous5 = latest.slice(-10, -5);
  const last10 = latest.slice(-10);
  const last20 = latest.slice(-20);
  const avg5 = average(last5.map((row) => row.volume));
  const avgPrevious5 = average(previous5.map((row) => row.volume));
  const avg20 = average(last20.map((row) => row.volume));
  const ratio5v20 = avg20 ? avg5 / avg20 : 1;
  const acceleration5d = avgPrevious5 ? avg5 / avgPrevious5 - 1 : 0;
  const total10 = last10.reduce((sum, row) => sum + row.volume, 0);
  const down10 = last10.filter((row) => row.close < row.open).reduce((sum, row) => sum + row.volume, 0);
  const downVolumeShare10d = total10 ? down10 / total10 : 0;
  const abnormalVolumeDays10d = avg20 ? last10.filter((row) => row.volume > avg20 * 1.5).length : 0;
  const pressureScore =
    Math.max(0, ratio5v20 - 1) * 0.32 +
    Math.max(0, acceleration5d) * 0.28 +
    Math.max(0, downVolumeShare10d - 0.5) * 0.75 +
    abnormalVolumeDays10d * 0.08;

  return {
    tone: riskFromScore(Math.min(1, pressureScore)),
    ratio5v20,
    acceleration5d,
    downVolumeShare10d,
    abnormalVolumeDays10d,
  };
}

function visibleGapUpCount(stock: StockSymbol, lookbackDays: number, visibleDays: number) {
  return withChartStates(stock.candles, lookbackDays).slice(-visibleDays).filter((row) => row.gapUp).length;
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function latestClose(stock: StockSymbol) {
  return stock.candles[stock.candles.length - 1]?.close ?? stock.price;
}

function trailingTwelveMonthHigh(stock: StockSymbol) {
  const latestCandle = stock.candles[stock.candles.length - 1];
  if (!latestCandle) {
    return { value: stock.price, belowHighPct: 0 };
  }
  const cutoff = new Date(`${latestCandle.date}T00:00:00`);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const trailingCandles = stock.candles.filter((candle) => candle.date >= cutoffKey);
  const source = trailingCandles.length ? trailingCandles : stock.candles.slice(-252);
  const value = source.reduce((high, candle) => Math.max(high, candle.high || candle.close), 0);
  const current = latestClose(stock);
  const belowHighPct = value ? Math.max(0, (1 - current / value) * 100) : 0;
  return {
    value,
    belowHighPct,
  };
}

function closeOnOrBefore(stock: StockSymbol, date: string) {
  let close = stock.candles[0]?.close ?? stock.price;
  for (const candle of stock.candles) {
    if (candle.date > date) {
      break;
    }
    close = candle.close;
  }
  return close;
}

function closeOnOrAfter(stock: StockSymbol, date: string) {
  const candle = stock.candles.find((row) => row.date >= date);
  return candle?.close ?? closeOnOrBefore(stock, date);
}

function candleOnOrAfter(stock: StockSymbol, date: string) {
  return stock.candles.find((row) => row.date >= date);
}

function candleIndexOnOrBefore(stock: StockSymbol, date: string) {
  for (let index = stock.candles.length - 1; index >= 0; index -= 1) {
    if (stock.candles[index].date <= date) {
      return index;
    }
  }
  return -1;
}

function historicalStockAt(stock: StockSymbol, candleIndex: number, lookbackDays: number): StockSymbol | null {
  if (candleIndex < 1) {
    return null;
  }
  const candles = stock.candles.slice(0, candleIndex + 1);
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const state = classifyMarketState(candles, lookbackDays);
  return {
    ...stock,
    ...state,
    price: latest.close,
    change: previous?.close ? (latest.close / previous.close - 1) * 100 : 0,
    risk: rollingRisk(candles, candles.length - 1),
    candles,
  };
}

function maxDrawdownPct(points: StrategyBacktestPoint[]) {
  let peak = points[0]?.value ?? 0;
  let drawdown = 0;
  points.forEach((point) => {
    peak = Math.max(peak, point.value);
    if (peak > 0) {
      drawdown = Math.min(drawdown, (point.value / peak - 1) * 100);
    }
  });
  return Math.abs(drawdown);
}

function simulateStrategy(
  strategy: TradingStrategy,
  stocks: StockSymbol[],
  volumeSignals: VolumeStateRiskSignal[],
  technicalSignals: TechnicalSignalCache | null,
  lookbackDays: number,
): StrategyBacktestResult {
  const startingCash = 100_000;
  const maxPositions = 5;
  const spy = stocks.find((stock) => stock.symbol === "SPY") ?? stocks[0];
  const dates = (spy?.candles ?? []).slice(-Math.max(2, lookbackDays + 1)).map((candle) => candle.date);
  const tradableStocks = stocks.filter((stock) => stock.symbol !== "SPY" && stock.candles.length > 20);
  let cash = startingCash;
  let buys = 0;
  let sells = 0;
  let wins = 0;
  let losses = 0;
  const positions = new Map<string, { shares: number; averageCost: number }>();
  const points: StrategyBacktestPoint[] = [];
  const spyStart = spy ? closeOnOrBefore(spy, dates[0] ?? spy.candles[0]?.date ?? "") : 0;

  if (dates.length < 2 || !tradableStocks.length) {
    return {
      strategyId: strategy.id,
      name: strategy.name,
      endingValue: startingCash,
      returnPct: 0,
      spyReturnPct: 0,
      alphaPct: 0,
      maxDrawdownPct: 0,
      winRate: 0,
      trades: 0,
      buys: 0,
      sells: 0,
      openPositions: 0,
      points: [],
    };
  }

  for (let dayIndex = 1; dayIndex < dates.length; dayIndex += 1) {
    const signalDate = dates[dayIndex - 1];
    const tradeDate = dates[dayIndex];
    let tradesToday = 0;

    for (const [symbol, position] of [...positions.entries()]) {
      const stock = tradableStocks.find((item) => item.symbol === symbol);
      if (!stock) {
        continue;
      }
      const signalIndex = candleIndexOnOrBefore(stock, signalDate);
      const historical = historicalStockAt(stock, signalIndex, DEFAULT_STATE_LOOKBACK);
      const tradeCandle = candleOnOrAfter(stock, tradeDate);
      if (!historical || !tradeCandle?.open) {
        continue;
      }
      const recommendation = buildTradeRecommendation(
        historical,
        DEFAULT_STATE_LOOKBACK,
        volumeSignals,
        technicalSnapshotFor(technicalSignals, symbol, signalDate),
        strategy.weights,
      );
      const shouldSell = recommendation.action === "Sell" || recommendation.score <= -0.45 || historical.marketState === "Bear";
      if (shouldSell) {
        cash += position.shares * tradeCandle.open;
        const profitLoss = (tradeCandle.open - position.averageCost) * position.shares;
        if (profitLoss >= 0) {
          wins += 1;
        } else {
          losses += 1;
        }
        positions.delete(symbol);
        sells += 1;
        tradesToday += 1;
      }
    }

    const openSlots = Math.max(0, maxPositions - positions.size);
    if (openSlots > 0 && cash > 0) {
      const candidates = tradableStocks
        .map((stock) => {
          if (positions.has(stock.symbol)) {
            return null;
          }
          const signalIndex = candleIndexOnOrBefore(stock, signalDate);
          const historical = historicalStockAt(stock, signalIndex, DEFAULT_STATE_LOOKBACK);
          const tradeCandle = candleOnOrAfter(stock, tradeDate);
          if (!historical || !tradeCandle?.open || tradeCandle.open <= 0) {
            return null;
          }
          const recommendation = buildTradeRecommendation(
            historical,
            DEFAULT_STATE_LOOKBACK,
            volumeSignals,
            technicalSnapshotFor(technicalSignals, stock.symbol, signalDate),
            strategy.weights,
          );
          if (recommendation.action !== "Strong Buy" && recommendation.action !== "Buy") {
            return null;
          }
          if (historical.marketState === "Bear" || historical.risk === "High") {
            return null;
          }
          const quality =
            recommendation.score +
            recommendation.confidence / 100 +
            Math.max(0, historical.trendReturn) / 18 +
            (historical.marketState === "Bull" ? 0.25 : 0) +
            (historical.risk === "Low" ? 0.18 : 0);
          return { stock, recommendation, tradeCandle, quality };
        })
        .filter((candidate): candidate is { stock: StockSymbol; recommendation: TradeRecommendation; tradeCandle: Candle; quality: number } =>
          Boolean(candidate),
        )
        .sort((left, right) => right.quality - left.quality)
        .slice(0, openSlots);

      const deployableCash = cash * 0.92;
      candidates.forEach((candidate, index) => {
        const remainingCandidates = candidates.length - index;
        const allocation = remainingCandidates ? deployableCash / remainingCandidates : 0;
        const shares = Math.floor(allocation / candidate.tradeCandle.open);
        if (shares < 1 || shares * candidate.tradeCandle.open > cash) {
          return;
        }
        cash -= shares * candidate.tradeCandle.open;
        positions.set(candidate.stock.symbol, {
          shares,
          averageCost: candidate.tradeCandle.open,
        });
        buys += 1;
        tradesToday += 1;
      });
    }

    const holdings = [...positions.entries()].reduce((sum, [symbol, position]) => {
      const stock = tradableStocks.find((item) => item.symbol === symbol);
      return sum + (stock ? closeOnOrBefore(stock, tradeDate) * position.shares : 0);
    }, 0);
    const value = cash + holdings;
    const spyClose = spy ? closeOnOrBefore(spy, tradeDate) : 0;
    const spyValue = spyStart ? (spyClose / spyStart) * startingCash : startingCash;
    points.push({
      date: tradeDate,
      value: Number(value.toFixed(2)),
      cash: Number(cash.toFixed(2)),
      holdings: Number(holdings.toFixed(2)),
      spy: Number(spyValue.toFixed(2)),
      trades: tradesToday,
    });
  }

  const endingValue = points[points.length - 1]?.value ?? startingCash;
  const spyEnding = points[points.length - 1]?.spy ?? startingCash;
  const returnPct = (endingValue / startingCash - 1) * 100;
  const spyReturnPct = (spyEnding / startingCash - 1) * 100;
  const closedTrades = wins + losses;

  return {
    strategyId: strategy.id,
    name: strategy.name,
    endingValue: Number(endingValue.toFixed(2)),
    returnPct: Number(returnPct.toFixed(2)),
    spyReturnPct: Number(spyReturnPct.toFixed(2)),
    alphaPct: Number((returnPct - spyReturnPct).toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct(points).toFixed(2)),
    winRate: closedTrades ? Math.round((wins / closedTrades) * 100) : 0,
    trades: buys + sells,
    buys,
    sells,
    openPositions: positions.size,
    points,
  };
}

function numberFromAlpaca(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAlpacaCredentials(): AlpacaCredentials | null {
  const legacyPaper = localStorage.getItem("alpaca_paper") !== "false";
  const endpoint = (localStorage.getItem("alpaca_endpoint")?.trim() || (legacyPaper ? DEFAULT_ALPACA_ENDPOINT : LIVE_ALPACA_ENDPOINT)).replace(/\/+$/, "");
  const apiKey = localStorage.getItem("alpaca_api_key")?.trim() ?? "";
  const secret = localStorage.getItem("alpaca_secret_key")?.trim() ?? "";
  if (!apiKey || !secret) {
    return null;
  }
  return {
    endpoint,
    apiKey,
    secret,
    accountId: localStorage.getItem("alpaca_account_id")?.trim() || undefined,
  };
}

function alpacaUrl(credentials: AlpacaCredentials, path: string) {
  const base = credentials.endpoint.replace(/\/+$/, "");
  const normalizedPath = base.endsWith("/v2") && path.startsWith("/v2/") ? path.slice(3) : path;
  return `${base}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

async function alpacaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const credentials = getAlpacaCredentials();
  if (!credentials) {
    throw new Error("Configure Alpaca API key and secret in Settings first.");
  }
  const response = await fetch(alpacaUrl(credentials, path), {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "APCA-API-KEY-ID": credentials.apiKey,
      "APCA-API-SECRET-KEY": credentials.secret,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Alpaca request failed: ${response.status}`;
    try {
      const errorBody = (await response.json()) as { message?: string };
      message = errorBody.message ? `Alpaca request failed: ${errorBody.message}` : message;
    } catch {
      // Keep the status-only message when Alpaca returns a non-JSON body.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function loadAlpacaPortfolio(): Promise<AlpacaPortfolioData> {
  const [account, positions, history, orders, activities] = await Promise.all([
    alpacaRequest<AlpacaAccount>("/v2/account"),
    alpacaRequest<AlpacaPosition[]>("/v2/positions"),
    alpacaRequest<AlpacaPortfolioHistory>("/v2/account/portfolio/history?period=1A&timeframe=1D"),
    alpacaRequest<AlpacaOrder[]>("/v2/orders?status=all&limit=100&direction=desc"),
    alpacaRequest<AlpacaActivity[]>("/v2/account/activities?direction=desc&page_size=100"),
  ]);
  return { account, positions, history, orders, activities };
}

async function syncIntradayMinuteCache(symbols: string[], feed: MinuteSyncFeed): Promise<IntradaySyncResponse> {
  const credentials = getAlpacaCredentials();
  if (!credentials) {
    throw new Error("Configure Alpaca API key and secret in Settings first.");
  }
  const response = await fetch("/api/intraday-cache/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbols,
      feed,
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      lookbackDays: 3,
    }),
  });
  const payload = (await response.json()) as IntradaySyncResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Minute cache sync failed: ${response.status}`);
  }
  return payload;
}

async function submitAlpacaOrder(order: AlpacaOrderRequest) {
  return alpacaRequest<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

async function submitAlpacaMarketOrder(symbol: string, side: "buy" | "sell", qty: number) {
  return submitAlpacaOrder({
    symbol,
    qty: String(Math.max(1, Math.floor(qty))),
    side,
    type: "market",
    time_in_force: "day",
  });
}

function orderDate(order: AlpacaOrder) {
  return (order.filled_at ?? order.submitted_at ?? "").slice(0, 10);
}

function orderQuantity(order: AlpacaOrder) {
  return numberFromAlpaca(order.filled_qty) || numberFromAlpaca(order.qty);
}

function orderAveragePrice(order: AlpacaOrder, stock?: StockSymbol) {
  return numberFromAlpaca(order.filled_avg_price) || numberFromAlpaca(order.limit_price) || (stock ? latestClose(stock) : 0);
}

function orderValue(order: AlpacaOrder, stock?: StockSymbol) {
  return orderQuantity(order) * orderAveragePrice(order, stock);
}

function orderStatusClass(status: string | undefined) {
  if (status === "filled") {
    return "filled";
  }
  if (status && ["new", "accepted", "pending_new", "partially_filled"].includes(status)) {
    return "open";
  }
  if (status && ["canceled", "expired", "rejected"].includes(status)) {
    return "rejected";
  }
  return "neutral";
}

function parseOptionalJsonObject(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalJsonArray(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed as Array<Record<string, unknown>>;
}

function alpacaFieldLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function alpacaColumns(rows: Array<Record<string, unknown>>, preferredKeys: string[]) {
  const keys = new Set<string>();
  preferredKeys.forEach((key) => keys.add(key));
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => keys.add(key));
  });
  return Array.from(keys).filter((key) => rows.some((row) => row[key] !== undefined && row[key] !== null && row[key] !== ""));
}

function formatAlpacaDate(value: string | number) {
  const date = typeof value === "number" ? new Date(value < 1000000000000 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatAlpacaValue(key: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "--";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  const text = String(value);
  const lowerKey = key.toLowerCase();
  if ((lowerKey.includes("time") || lowerKey.includes("date") || lowerKey.endsWith("_at")) && (typeof value === "string" || typeof value === "number")) {
    return formatAlpacaDate(value);
  }
  const numericValue = Number(value);
  const looksMonetary =
    Number.isFinite(numericValue) &&
    /(amount|cash|equity|value|price|power|margin|pl|profit|loss|market|cost|fee|credit|debit)/.test(lowerKey);
  if (looksMonetary) {
    return currency.format(numericValue);
  }
  return text;
}

function alpacaHistoryRows(history: AlpacaPortfolioHistory | null) {
  const timestamps = history?.timestamp ?? [];
  const equity = history?.equity ?? [];
  const profitLoss = history?.profit_loss ?? [];
  return timestamps.map((timestamp, index) => ({
    date: new Date(timestamp < 1000000000000 ? timestamp * 1000 : timestamp).toLocaleDateString(),
    equity: Number(equity[index] ?? 0),
    profitLoss: Number(profitLoss[index] ?? 0),
  }));
}

function formatSignedCurrency(value: number) {
  const formatted = currency.format(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function AlpacaDataTable({
  rows,
  preferredKeys,
  emptyText,
}: {
  rows: Array<Record<string, unknown>>;
  preferredKeys: string[];
  emptyText: string;
}) {
  const columns = alpacaColumns(rows, preferredKeys);
  return (
    <div className="table-wrap alpaca-table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{alpacaFieldLabel(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="empty-table-cell">{emptyText}</td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={String(row.id ?? `${row.symbol ?? "row"}-${index}`)}>
              {columns.map((column) => (
                <td key={column}>{formatAlpacaValue(column, row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlpacaOrdersView({
  orders,
  stocks,
  credentialsConfigured,
}: {
  orders: AlpacaOrder[];
  stocks: StockSymbol[];
  credentialsConfigured: boolean;
}) {
  const filledOrders = orders.filter((order) => order.status === "filled");
  const openOrders = orders.filter((order) => ["new", "accepted", "pending_new", "partially_filled"].includes(String(order.status)));
  const rejectedOrders = orders.filter((order) => ["canceled", "expired", "rejected"].includes(String(order.status)));
  const notional = filledOrders.reduce((sum, order) => {
    const stock = stocks.find((item) => item.symbol === order.symbol);
    return sum + orderValue(order, stock);
  }, 0);

  return (
    <section className="panel alpaca-detail-panel">
      <div className="panel-head">
        <div>
          <h2>Orders</h2>
          <span className="table-sort-summary">latest 100 orders returned by Alpaca</span>
        </div>
      </div>
      <div className="alpaca-summary-grid">
        <Metric label="Total orders" value={`${orders.length}`} />
        <Metric label="Filled" value={`${filledOrders.length}`} tone="good" />
        <Metric label="Open" value={`${openOrders.length}`} />
        <Metric label="Canceled / rejected" value={`${rejectedOrders.length}`} tone={rejectedOrders.length ? "warn" : undefined} />
        <Metric label="Filled notional" value={currency.format(notional)} />
      </div>
      <div className="table-wrap orders-table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Order</th>
              <th>Quantity</th>
              <th>Avg / limit</th>
              <th>Value</th>
              <th>Status</th>
              <th>Alpaca fields</th>
            </tr>
          </thead>
          <tbody>
            {!orders.length && (
              <tr>
                <td colSpan={9} className="empty-table-cell">
                  {credentialsConfigured ? "No Alpaca orders returned." : "Connect Alpaca in Settings to load order history."}
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const stock = stocks.find((item) => item.symbol === order.symbol);
              const averagePrice = orderAveragePrice(order, stock);
              const limitPrice = numberFromAlpaca(order.limit_price);
              const status = String(order.status ?? "unknown");
              const rawFields = Object.entries(order)
                .filter(([, value]) => value !== undefined && value !== null && value !== "")
                .sort(([left], [right]) => left.localeCompare(right));
              return (
                <tr key={order.id}>
                  <td>
                    <span className="order-date-cell">
                      <strong>{order.submitted_at ? formatAlpacaDate(order.submitted_at).split(",")[0] : "--"}</strong>
                      <small>{order.filled_at ? `Filled ${formatAlpacaDate(order.filled_at).split(",").slice(-1)[0]?.trim()}` : "Not filled"}</small>
                    </span>
                  </td>
                  <td>
                    <span className="symbol-with-name order-symbol-cell">
                      <strong>{order.symbol}</strong>
                      {stock && <small>{stock.name}</small>}
                    </span>
                  </td>
                  <td><span className={`transaction-type ${order.side}`}>{order.side}</span></td>
                  <td>
                    <span className="order-type-cell">
                      <strong>{String(order.type ?? "--").replace(/_/g, " ")}</strong>
                      <small>{String(order.time_in_force ?? "--").toUpperCase()} · {String(order.order_class ?? "simple")}</small>
                    </span>
                  </td>
                  <td>
                    <span className="order-number-cell">
                      <strong>{orderQuantity(order).toFixed(4)}</strong>
                      <small>{numberFromAlpaca(order.filled_qty).toFixed(4)} filled</small>
                    </span>
                  </td>
                  <td>
                    <span className="order-number-cell">
                      <strong>{averagePrice ? currency.format(averagePrice) : "--"}</strong>
                      <small>{limitPrice ? `${currency.format(limitPrice)} limit` : "no limit"}</small>
                    </span>
                  </td>
                  <td>{currency.format(orderValue(order, stock))}</td>
                  <td><span className={`order-status-chip ${orderStatusClass(status)}`}>{status.replace(/_/g, " ")}</span></td>
                  <td>
                    <details className="order-raw-details">
                      <summary>View</summary>
                      <div>
                        {rawFields.map(([key, value]) => (
                          <span key={key}>
                            <b>{alpacaFieldLabel(key)}</b>
                            <em>{formatAlpacaValue(key, value)}</em>
                          </span>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AlpacaActivitiesView({
  activities,
  credentialsConfigured,
}: {
  activities: AlpacaActivity[];
  credentialsConfigured: boolean;
}) {
  const activityCounts = activities.reduce<Record<string, number>>((counts, activity) => {
    const type = String(activity.activity_type ?? activity.type ?? "unknown");
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  const netAmount = activities.reduce((sum, activity) => sum + numberFromAlpaca(activity.net_amount), 0);
  const fillCount = activityCounts.FILL ?? activityCounts.fill ?? 0;

  return (
    <section className="panel alpaca-detail-panel">
      <div className="panel-head">
        <div>
          <h2>Activities</h2>
          <span className="table-sort-summary">fills, cash movements, dividends, fees, and other Alpaca account activity</span>
        </div>
      </div>
      <div className="alpaca-summary-grid">
        <Metric label="Activities" value={`${activities.length}`} />
        <Metric label="Fills" value={`${fillCount}`} />
        <Metric label="Net amount" value={currency.format(netAmount)} tone={netAmount >= 0 ? "good" : "warn"} />
      </div>
      <div className="activity-chip-row">
        {Object.entries(activityCounts).map(([type, count]) => (
          <span key={type}>{type}: {count}</span>
        ))}
      </div>
      <AlpacaDataTable
        rows={activities}
        preferredKeys={["transaction_time", "date", "activity_type", "symbol", "side", "qty", "price", "net_amount", "type", "id"]}
        emptyText={credentialsConfigured ? "No Alpaca activities returned." : "Connect Alpaca in Settings to load account activities."}
      />
    </section>
  );
}

function AlpacaBalancesView({
  account,
  positions,
  history,
  credentialsConfigured,
}: {
  account: AlpacaAccount | null;
  positions: AlpacaPosition[];
  history: AlpacaPortfolioHistory | null;
  credentialsConfigured: boolean;
}) {
  const accountRows = account ? Object.entries(account).sort(([left], [right]) => left.localeCompare(right)) : [];
  const balanceHighlights = [
    "cash",
    "buying_power",
    "equity",
    "portfolio_value",
    "long_market_value",
    "short_market_value",
    "initial_margin",
    "maintenance_margin",
    "last_equity",
  ];
  const historyRows = alpacaHistoryRows(history);
  const latestHistory = historyRows.at(-1);
  const exposureTotal = positions.reduce((sum, position) => sum + Math.abs(numberFromAlpaca(position.market_value)), 0);
  const positionRows = positions.map((position) => position as Record<string, unknown>);

  return (
    <section className="panel alpaca-detail-panel">
      <div className="panel-head">
        <div>
          <h2>Balances</h2>
          <span className="table-sort-summary">account fields, buying power, margin, equity history, and position exposure</span>
        </div>
      </div>
      <div className="alpaca-summary-grid">
        {balanceHighlights.map((key) => (
          <Metric key={key} label={alpacaFieldLabel(key)} value={formatAlpacaValue(key, account?.[key])} />
        ))}
        <Metric label="History equity" value={latestHistory ? currency.format(latestHistory.equity) : "--"} />
        <Metric
          label="History P/L"
          value={latestHistory ? currency.format(latestHistory.profitLoss) : "--"}
          tone={latestHistory ? (latestHistory.profitLoss >= 0 ? "good" : "warn") : undefined}
        />
      </div>

      <div className="balances-layout">
        <div>
          <h3>Equity history</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={historyRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={54} />
              <Tooltip formatter={(value) => currency.format(Number(value))} />
              <Line type="monotone" dataKey="equity" stroke="#177e89" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="profitLoss" stroke="#6d5bd0" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h3>Position exposure</h3>
          <div className="exposure-list">
            {!positions.length && <span className="empty-table-cell">{credentialsConfigured ? "No open positions returned." : "Connect Alpaca in Settings to load balances."}</span>}
            {positions.map((position) => {
              const marketValue = Math.abs(numberFromAlpaca(position.market_value));
              const share = exposureTotal ? marketValue / exposureTotal : 0;
              return (
                <div key={position.symbol} className="exposure-row">
                  <div>
                    <strong>{position.symbol}</strong>
                    <span>{currency.format(marketValue)}</span>
                  </div>
                  <div className="exposure-bar" aria-label={`${position.symbol} exposure ${Math.round(share * 100)} percent`}>
                    <span style={{ width: `${Math.max(4, share * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="balances-tables">
        <div>
          <h3>All account fields</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {!accountRows.length && (
                  <tr>
                    <td colSpan={2} className="empty-table-cell">{credentialsConfigured ? "No account fields returned." : "Connect Alpaca in Settings to load account balances."}</td>
                  </tr>
                )}
                {accountRows.map(([key, value]) => (
                  <tr key={key}>
                    <th>{alpacaFieldLabel(key)}</th>
                    <td>{formatAlpacaValue(key, value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3>All position fields</h3>
          <AlpacaDataTable
            rows={positionRows}
            preferredKeys={["symbol", "asset_class", "qty", "market_value", "avg_entry_price", "current_price", "unrealized_pl", "unrealized_plpc"]}
            emptyText={credentialsConfigured ? "No Alpaca positions returned." : "Connect Alpaca in Settings to load positions."}
          />
        </div>
      </div>
    </section>
  );
}

function stockFromAlpacaPosition(position: AlpacaPosition, stocks: StockSymbol[], latestDate: string): StockSymbol {
  const cached = stocks.find((stock) => stock.symbol === position.symbol);
  if (cached) {
    return cached;
  }
  const price = numberFromAlpaca(position.current_price) || numberFromAlpaca(position.avg_entry_price);
  return {
    symbol: position.symbol,
    name: position.symbol,
    sector: position.asset_class ?? "Alpaca position",
    price,
    change: 0,
    weight: 0,
    volume: "--",
    risk: "Medium",
    marketState: "Sideways",
    trendReturn: 0,
    candles: [{ date: latestDate, open: price, high: price, low: price, close: price, volume: 0 }],
  };
}

function buildAlpacaHoldings(
  stocks: StockSymbol[],
  positions: AlpacaPosition[],
  orders: AlpacaOrder[],
  recommendations: Record<string, TradeRecommendation>,
  latestDate: string,
): PortfolioHolding[] {
  return positions
    .map((position) => {
      const stock = stockFromAlpacaPosition(position, stocks, latestDate);
      const shares = numberFromAlpaca(position.qty);
      if (shares <= 0.000001) {
        return null;
      }
      const buyDates = orders
        .filter((order) => order.symbol === position.symbol && order.side === "buy" && order.status === "filled")
        .map(orderDate)
        .filter(Boolean)
        .sort();
      const firstBuyDate = buyDates[0] ?? latestDate;
      const marketValue = numberFromAlpaca(position.market_value) || shares * latestClose(stock);
      const averageCost = numberFromAlpaca(position.avg_entry_price);
      return {
        symbol: position.symbol,
        shares,
        marketValue,
        averageCost,
        profitLoss: numberFromAlpaca(position.unrealized_pl) || marketValue - shares * averageCost,
        firstBuyDate,
        holdingDays: daysBetween(firstBuyDate, latestDate),
        stock,
        recommendation: recommendations[position.symbol] ?? buildTradeRecommendation(stock, DEFAULT_STATE_LOOKBACK, []),
      };
    })
    .filter((holding): holding is PortfolioHolding => Boolean(holding))
    .sort((left, right) => right.marketValue - left.marketValue);
}

function activityDate(activity: AlpacaActivity) {
  return String(activity.transaction_time ?? activity.date ?? "").slice(0, 10);
}

function normalizeFillSide(side: unknown): "buy" | "sell" | null {
  const normalized = String(side ?? "").toLowerCase();
  if (normalized === "buy" || normalized === "b") {
    return "buy";
  }
  if (normalized === "sell" || normalized === "sell_short" || normalized === "s") {
    return "sell";
  }
  return null;
}

function alpacaFillEvents(orders: AlpacaOrder[], activities: AlpacaActivity[]): AlpacaFillEvent[] {
  const events = new Map<string, AlpacaFillEvent>();
  orders.forEach((order) => {
    if (order.status !== "filled") {
      return;
    }
    const side = normalizeFillSide(order.side);
    const symbol = String(order.symbol ?? "").toUpperCase();
    const qty = orderQuantity(order);
    const price = orderAveragePrice(order);
    const date = orderDate(order);
    if (!side || !symbol || !date || qty <= 0 || price <= 0) {
      return;
    }
    events.set(`order-${order.id}`, {
      id: `order-${order.id}`,
      date,
      symbol,
      side,
      qty,
      price,
    });
  });

  activities.forEach((activity, index) => {
    const activityType = String(activity.activity_type ?? activity.type ?? "").toLowerCase();
    if (activityType && activityType !== "fill") {
      return;
    }
    const side = normalizeFillSide(activity.side);
    const symbol = String(activity.symbol ?? "").toUpperCase();
    const qty = numberFromAlpaca(activity.qty);
    const price = numberFromAlpaca(activity.price);
    const date = activityDate(activity);
    if (!side || !symbol || !date || qty <= 0 || price <= 0) {
      return;
    }
    const id = `activity-${activity.id ?? `${symbol}-${side}-${date}-${qty}-${price}-${index}`}`;
    if (![...events.values()].some((event) => event.symbol === symbol && event.side === side && event.date === date && Math.abs(event.qty - qty) < 0.0001 && Math.abs(event.price - price) < 0.01)) {
      events.set(id, { id, date, symbol, side, qty, price });
    }
  });

  return [...events.values()].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

function realizedProfitLossBySellDate(events: AlpacaFillEvent[]) {
  const lots = new Map<string, Array<{ qty: number; price: number }>>();
  const realized = new Map<string, number>();

  events.forEach((event) => {
    const symbolLots = lots.get(event.symbol) ?? [];
    if (event.side === "buy") {
      symbolLots.push({ qty: event.qty, price: event.price });
      lots.set(event.symbol, symbolLots);
      return;
    }

    let remaining = event.qty;
    let profitLoss = 0;
    while (remaining > 0.000001 && symbolLots.length) {
      const lot = symbolLots[0];
      const matchedQty = Math.min(remaining, lot.qty);
      profitLoss += (event.price - lot.price) * matchedQty;
      lot.qty -= matchedQty;
      remaining -= matchedQty;
      if (lot.qty <= 0.000001) {
        symbolLots.shift();
      }
    }
    lots.set(event.symbol, symbolLots);
    realized.set(event.date, (realized.get(event.date) ?? 0) + profitLoss);
  });

  return realized;
}

function firstFillDateForSymbol(events: AlpacaFillEvent[], symbol: string) {
  return events.find((event) => event.symbol === symbol && event.side === "buy")?.date;
}

function buildPortfolioProfitLossPeriods(
  stocks: StockSymbol[],
  positions: AlpacaPosition[],
  orders: AlpacaOrder[],
  activities: AlpacaActivity[],
  account: AlpacaAccount | null,
): PortfolioProfitLossPeriod[] {
  const events = alpacaFillEvents(orders, activities);
  const realizedByDate = realizedProfitLossBySellDate(events);
  const currentEquity = numberFromAlpaca(account?.portfolio_value) || numberFromAlpaca(account?.equity);
  const latestTime = Date.now();

  return PORTFOLIO_PL_WINDOWS.map((window) => {
    const cutoff = new Date(latestTime - window.days * 86_400_000).toISOString().slice(0, 10);
    const realized = [...realizedByDate.entries()]
      .filter(([date]) => date >= cutoff)
      .reduce((sum, [, value]) => sum + value, 0);
    const unrealizedChange = positions.reduce((sum, position) => {
      const symbol = String(position.symbol ?? "").toUpperCase();
      const stock = stocks.find((item) => item.symbol === symbol);
      const qty = numberFromAlpaca(position.qty);
      if (qty <= 0) {
        return sum;
      }
      const currentUnrealized =
        numberFromAlpaca(position.unrealized_pl) ||
        (numberFromAlpaca(position.current_price) - numberFromAlpaca(position.avg_entry_price)) * qty;
      if (!stock) {
        return sum + currentUnrealized;
      }
      const firstBuyDate = firstFillDateForSymbol(events, symbol);
      if (firstBuyDate && firstBuyDate >= cutoff) {
        return sum + currentUnrealized;
      }
      const baselinePrice = closeOnOrAfter(stock, cutoff);
      const baselineUnrealized = (baselinePrice - numberFromAlpaca(position.avg_entry_price)) * qty;
      return sum + currentUnrealized - baselineUnrealized;
    }, 0);
    const value = realized + unrealizedChange;

    return {
      ...window,
      value,
      percent: currentEquity ? (value / currentEquity) * 100 : null,
      complete: events.some((event) => event.date <= cutoff) || positions.length > 0,
    };
  });
}

function buildRecommendedPortfolioTrades(
  stocks: StockSymbol[],
  recommendations: Record<string, TradeRecommendation>,
  holdings: PortfolioHolding[],
  freeCash: number,
  tradeCount: number,
): RecommendedPortfolioTrade[] {
  const deployableCash = Math.max(0, freeCash * 0.95);
  if (deployableCash <= 0) {
    return [];
  }
  const maxTrades = Math.min(20, Math.max(1, Math.round(tradeCount)));

  const heldMarketValue = new Map(holdings.map((holding) => [holding.symbol, holding.marketValue]));
  const totalHeldValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const ranked = stocks
    .map((stock) => {
      const recommendation = recommendations[stock.symbol];
      const price = latestClose(stock);
      if (!recommendation || price <= 0 || recommendation.action === "Hold" || recommendation.action === "Sell") {
        return null;
      }
      if (stock.marketState === "Bear" || stock.risk === "High") {
        return null;
      }

      const currentPositionShare = totalHeldValue ? (heldMarketValue.get(stock.symbol) ?? 0) / totalHeldValue : 0;
      const concentrationPenalty = currentPositionShare > 0.18 ? 0.58 : currentPositionShare > 0.1 ? 0.76 : 1;
      const actionBoost = recommendation.action === "Strong Buy" ? 1.35 : 1;
      const quality =
        actionBoost *
        concentrationPenalty *
        (Math.max(0, recommendation.score) + recommendation.confidence / 100 + stateRank(stock.marketState) / 3 + riskRank(stock.risk) / 3);

      return {
        stock,
        recommendation,
        price,
        quality,
      };
    })
    .filter((candidate): candidate is { stock: StockSymbol; recommendation: TradeRecommendation; price: number; quality: number } =>
      Boolean(candidate),
    )
    .sort((left, right) => right.quality - left.quality);

  let remainingCash = deployableCash;
  const selected: Array<{ stock: StockSymbol; recommendation: TradeRecommendation; price: number; quality: number }> = [];
  for (const candidate of ranked) {
    if (selected.length >= maxTrades) {
      break;
    }
    if (candidate.price <= remainingCash) {
      selected.push(candidate);
      remainingCash -= candidate.price;
    }
  }

  const totalQuality = selected.reduce((sum, candidate) => sum + candidate.quality, 0);
  if (!totalQuality) {
    return [];
  }

  const minimumCost = selected.reduce((sum, candidate) => sum + candidate.price, 0);
  const extraCash = Math.max(0, deployableCash - minimumCost);

  return selected.map((candidate) => {
    const qualityWeight = candidate.quality / totalQuality;
    const extraShares = Math.floor((extraCash * qualityWeight) / candidate.price);
    const shares = 1 + extraShares;
    const estimatedCost = shares * candidate.price;
    return {
      symbol: candidate.stock.symbol,
      shares,
      estimatedCost: Number(estimatedCost.toFixed(2)),
      price: candidate.price,
      allocationWeight: estimatedCost / deployableCash,
      stock: candidate.stock,
      recommendation: candidate.recommendation,
    };
  });
}

function buildAlpacaPortfolioValueSeries(
  stocks: StockSymbol[],
  positions: AlpacaPosition[],
  account: AlpacaAccount | null,
  history: AlpacaPortfolioHistory | null,
  selectedSymbol: string,
) {
  const cash = numberFromAlpaca(account?.cash);
  const selectedPosition = positions.find((position) => position.symbol === selectedSymbol);
  const selectedShares = numberFromAlpaca(selectedPosition?.qty);
  const selectedStock = stocks.find((stock) => stock.symbol === selectedSymbol);
  const timestamps = history?.timestamp ?? [];
  const equity = history?.equity ?? [];
  if (!timestamps.length || !equity.length) {
    const total = numberFromAlpaca(account?.portfolio_value) || numberFromAlpaca(account?.equity) || cash;
    const selected = selectedPosition ? numberFromAlpaca(selectedPosition.market_value) : 0;
    return [{
      date: new Date().toISOString().slice(0, 10),
      total: Number(total.toFixed(2)),
      holdings: Number(Math.max(0, total - cash).toFixed(2)),
      cash: Number(cash.toFixed(2)),
      selected: Number(selected.toFixed(2)),
    }];
  }

  return timestamps.map((timestamp, index) => {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const total = numberFromAlpaca(equity[index]);
    const selected = selectedStock && selectedShares > 0 ? selectedShares * closeOnOrBefore(selectedStock, date) : 0;
    return {
      date,
      total: Number(total.toFixed(2)),
      holdings: Number(Math.max(0, total - cash).toFixed(2)),
      cash: Number(cash.toFixed(2)),
      selected: Number(selected.toFixed(2)),
    };
  });
}

function buildTradeRecommendation(
  stock: StockSymbol,
  lookbackDays: number,
  volumeSignals: VolumeStateRiskSignal[],
  technicalSnapshot?: TechnicalSignalSnapshot,
  signalWeights: SignalWeights = defaultSignalWeights(),
): TradeRecommendation {
  const rows = withChartStates(stock.candles, lookbackDays);
  const latest = rows[rows.length - 1];
  const marketSignal = latest ? latestVolumeStateSignal(volumeSignals, latest.date) : null;
  const volumeFactor = stockVolumeFactor(rows);
  const markov = markovModel(rows);
  const bullProb = markov.probabilities.Bull ?? 0;
  const bearProb = markov.probabilities.Bear ?? 0;
  const gapUps20 = rows.slice(-20).filter((row) => row.gapUp).length;
  const technical = weightedTechnicalSignal(technicalSnapshot, signalWeights);

  let score = 0;
  score += stock.marketState === "Bull" ? 1.15 : stock.marketState === "Bear" ? -1.35 : 0.1;
  score += clamp(stock.trendReturn / 8, -1.25, 1.25);
  score += stock.change >= 1 ? 0.35 : stock.change <= -2 ? -0.45 : stock.change < 0 ? -0.15 : 0.15;
  score += latest?.chartRisk === "Low" ? 0.25 : latest?.chartRisk === "High" ? -0.75 : -0.25;
  score += volumeFactor.tone === "Low" ? 0.25 : volumeFactor.tone === "High" ? -0.8 : -0.3;
  score += clamp((bullProb - bearProb) * 1.2, -0.8, 0.8);
  score += gapUps20 > 0 && stock.trendReturn > 0 ? Math.min(0.35, gapUps20 * 0.08) : 0;

  if (marketSignal) {
    score += marketSignal.volumeStateRiskScore >= 0.8 ? -1.0 : marketSignal.volumeStateRiskScore >= 0.55 ? -0.45 : 0.15;
    score += clamp(marketSignal.predictedSpyReturn5d * 12, -0.45, 0.45);
    score += marketSignal.riskOff || marketSignal.liquidationRisk ? -0.65 : 0;
    score += marketSignal.rotationRisk && stock.marketState === "Bull" ? 0.15 : 0;
  }
  if (technical) {
    score += technical.score * 1.65;
  }

  const action: RecommendationAction = score >= 2.15 ? "Strong Buy" : score >= 0.75 ? "Buy" : score <= -0.75 ? "Sell" : "Hold";
  const confidence = Math.round(clamp(Math.abs(score) / 3, 0.25, 0.95) * 100);
  const strongestTechnical = technical?.contributions
    .filter((item) => item.weight !== 0)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))[0];
  const positiveReason =
    strongestTechnical && strongestTechnical.contribution > 0.25
      ? strongestTechnical.label
      : stock.marketState === "Bull"
      ? "bull trend"
      : bullProb > bearProb
        ? "bullish state odds"
        : "stable setup";
  const negativeReason =
    strongestTechnical && strongestTechnical.contribution < -0.25
      ? strongestTechnical.label
      : stock.marketState === "Bear"
      ? "bear trend"
      : volumeFactor.tone === "High"
        ? "volume pressure"
        : marketSignal && marketSignal.volumeStateRiskScore >= 0.55
          ? "market volume risk"
          : "weak momentum";

  return {
    action,
    score: Number(score.toFixed(2)),
    confidence,
    reason: action === "Strong Buy" || action === "Buy" ? positiveReason : action === "Sell" ? negativeReason : "mixed signals",
  };
}

function buildWindowedRecommendations(
  stock: StockSymbol,
  volumeSignals: VolumeStateRiskSignal[],
  technicalSignals?: TechnicalSignalCache | null,
  signalWeights: SignalWeights = defaultSignalWeights(),
): WindowedRecommendations {
  const technicalSnapshot = technicalSnapshotFor(technicalSignals, stock.symbol);
  return Object.fromEntries(
    RECOMMENDATION_WINDOWS.map((days) => {
      const windowedStock = { ...stock, ...classifyMarketState(stock.candles, days) };
      return [days, buildTradeRecommendation(windowedStock, days, volumeSignals, technicalSnapshot, signalWeights)];
    }),
  ) as WindowedRecommendations;
}

function primaryRecommendation(recommendations?: WindowedRecommendations) {
  return recommendations?.[DEFAULT_STATE_LOOKBACK];
}

function buildMarketWindowRecommendations(allRecommendations: Record<string, WindowedRecommendations>): WindowedRecommendations {
  return Object.fromEntries(
    RECOMMENDATION_WINDOWS.map((days) => {
      const recommendations = Object.values(allRecommendations)
        .map((item) => item[days])
        .filter((item): item is TradeRecommendation => Boolean(item));
      const averageScore = recommendations.length
        ? recommendations.reduce((sum, item) => sum + recommendationScore(item.action), 0) / recommendations.length
        : 0;
      const action: RecommendationAction =
        averageScore >= 1.35 ? "Strong Buy" : averageScore >= 0.25 ? "Buy" : averageScore <= -0.25 ? "Sell" : "Hold";
      const buyCount = recommendations.filter((item) => item.action === "Strong Buy" || item.action === "Buy").length;
      const sellCount = recommendations.filter((item) => item.action === "Sell").length;
      return [
        days,
        {
          action,
          score: Number(averageScore.toFixed(2)),
          confidence: Math.round(clamp(Math.abs(averageScore) / 2, 0.25, 0.95) * 100),
          reason: `${buyCount} buy / ${sellCount} sell signals`,
        },
      ];
    }),
  ) as WindowedRecommendations;
}

function stateBands(rows: ChartCandle[]): StateBand[] {
  if (!rows.length) {
    return [];
  }

  const bands: StateBand[] = [];
  let current: StateBand = {
    start: rows[0].date,
    end: rows[0].date,
    state: rows[0].chartState,
    count: 1,
  };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.chartState !== current.state) {
      bands.push(current);
      current = { start: row.date, end: row.date, state: row.chartState, count: 1 };
    } else {
      current.end = row.date;
      current.count += 1;
    }
  }

  bands.push(current);
  return bands;
}

function riskBands(rows: ChartCandle[]): RiskBand[] {
  if (!rows.length) {
    return [];
  }

  const bands: RiskBand[] = [];
  let current: RiskBand = {
    start: rows[0].date,
    end: rows[0].date,
    risk: rows[0].chartRisk,
    count: 1,
  };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.chartRisk !== current.risk) {
      bands.push(current);
      current = { start: row.date, end: row.date, risk: row.chartRisk, count: 1 };
    } else {
      current.end = row.date;
      current.count += 1;
    }
  }

  bands.push(current);
  return bands;
}

function chartWindowRecommendation(candles: ChartCandle[], index: number, lookback: number) {
  const candle = candles[index];
  const previous = candles[Math.max(0, index - 1)];
  const baseline = candles[Math.max(0, index - Math.max(1, lookback))];
  const trendReturn = baseline?.close ? (candle.close / baseline.close - 1) * 100 : 0;
  const changeReturn = previous?.close ? (candle.close / previous.close - 1) * 100 : 0;
  const risk = rollingRisk(candles, index);
  let score = 0;
  score += clamp(trendReturn / 4, -1.6, 1.6);
  score += changeReturn >= 1 ? 0.25 : changeReturn <= -1.5 ? -0.35 : changeReturn < 0 ? -0.1 : 0.1;
  score += risk === "Low" ? 0.25 : risk === "High" ? -0.45 : -0.1;

  const action: RecommendationAction = score >= 1.6 ? "Strong Buy" : score >= 0.45 ? "Buy" : score <= -0.45 ? "Sell" : "Hold";
  return {
    action,
    risk,
    trendReturn: Number(trendReturn.toFixed(2)),
  };
}

function buildRecommendationStack(candles: ChartCandle[], visibleRows: ChartCandle[]): RecommendationStackRow[] {
  if (!candles.length || !visibleRows.length) {
    return [];
  }
  const firstVisibleIndex = Math.max(0, candles.findIndex((candle) => candle.date === visibleRows[0].date));
  return RECOMMENDATION_WINDOWS.map((days) => {
    const bands: RecommendationStackBand[] = [];
    for (let offset = 0; offset < visibleRows.length; offset += 1) {
      const sourceIndex = Math.min(candles.length - 1, firstVisibleIndex + offset);
      const row = candles[sourceIndex];
      const recommendation = chartWindowRecommendation(candles, sourceIndex, days);
      const current = bands[bands.length - 1];
      if (current && current.action === recommendation.action) {
        current.end = row.date;
        current.count += 1;
        current.trendReturn = recommendation.trendReturn;
        current.risk = recommendation.risk;
      } else {
        bands.push({
          start: row.date,
          end: row.date,
          action: recommendation.action,
          count: 1,
          trendReturn: recommendation.trendReturn,
          risk: recommendation.risk,
        });
      }
    }
    return {
      days,
      latestAction: bands[bands.length - 1]?.action ?? "Hold",
      bands,
    };
  });
}

function markovModel(rows: ChartCandle[]): MarkovModel {
  const counts = MARKET_STATES.reduce(
    (outer, from) => {
      outer[from] = MARKET_STATES.reduce(
        (inner, to) => {
          inner[to] = 1;
          return inner;
        },
        {} as Record<MarketState, number>,
      );
      return outer;
    },
    {} as Record<MarketState, Record<MarketState, number>>,
  );

  for (let index = 1; index < rows.length; index += 1) {
    const from = rows[index - 1].chartState;
    const to = rows[index].chartState;
    counts[from][to] += 1;
  }

  const matrix = MARKET_STATES.reduce(
    (outer, from) => {
      const total = MARKET_STATES.reduce((sum, to) => sum + counts[from][to], 0);
      outer[from] = MARKET_STATES.reduce(
        (inner, to) => {
          inner[to] = counts[from][to] / total;
          return inner;
        },
        {} as Record<MarketState, number>,
      );
      return outer;
    },
    {} as Record<MarketState, Record<MarketState, number>>,
  );
  const currentState = rows[rows.length - 1]?.chartState ?? "Sideways";

  return {
    currentState,
    probabilities: matrix[currentState],
    matrix,
    transitions: Math.max(0, rows.length - 1),
  };
}

function RegimeBackground({ bands }: { bands: StateBand[] }) {
  return (
    <div className="regime-background" aria-hidden="true">
      {bands.map((band) => (
        <span
          key={`${band.start}-${band.end}-${band.state}`}
          className={`regime-band ${stateClass(band.state)}`}
          style={{ flexGrow: band.count }}
        />
      ))}
    </div>
  );
}

function StateLegend() {
  return (
    <div className="state-legend" aria-label="Chart state legend">
      <span><i className="bull" /> Bull</span>
      <span><i className="sideways" /> Sideways</span>
      <span><i className="bear" /> Bear</span>
    </div>
  );
}

function RiskLegend() {
  return (
    <div className="risk-legend" aria-label="Chart risk legend">
      <span><i className="low" /> Low</span>
      <span><i className="medium" /> Medium</span>
      <span><i className="high" /> High</span>
    </div>
  );
}

function GapLegend() {
  return (
    <div className="gap-legend" aria-label="Gap-up legend">
      <span><i /> Gap up</span>
    </div>
  );
}

function GapMarkers({ rows }: { rows: ChartCandle[] }) {
  return (
    <div className="gap-marker-overlay" aria-label="Gap-up markers">
      {rows.map((row) => (
        <span key={`${row.date}-gap`} style={{ flexGrow: 1 }}>
          {row.gapUp && <i title={`Gap up ${row.gapReturn.toFixed(2)}% on ${row.date}`} />}
        </span>
      ))}
    </div>
  );
}

function RiskStrip({ bands }: { bands: RiskBand[] }) {
  return (
    <div className="risk-strip" aria-label="Rolling risk visualization">
      <span className="risk-strip-label">Rolling risk</span>
      <div className="risk-strip-track">
        {bands.map((band) => (
          <span
            key={`${band.start}-${band.end}-${band.risk}`}
            className={`risk-band ${riskClass(band.risk)}`}
            style={{ flexGrow: band.count }}
            title={`${band.risk} risk · ${band.start} to ${band.end}`}
          />
        ))}
      </div>
    </div>
  );
}

function RecommendationHeatmapBackground({ rows }: { rows: RecommendationStackRow[] }) {
  if (!rows.length) {
    return null;
  }
  return (
    <div className="recommendation-heatmap" style={{ gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }} aria-hidden="true">
      {rows.map((row) => (
        <div key={row.days} className="recommendation-heatmap-row">
          <span className={`recommendation-heatmap-label ${recommendationClass(row.latestAction)}`}>
            <b>{row.days}</b>
            {recommendationStackLabel(row.latestAction)}
          </span>
          <div className="recommendation-heatmap-track">
            {row.bands.map((band) => (
              <span
                key={`${row.days}-${band.start}-${band.end}-${band.action}`}
                className={`recommendation-heatmap-cell ${recommendationClass(band.action)}`}
                style={{ flexGrow: band.count }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StockSparkline({ stock, visibleTimeframe }: { stock: StockSymbol; visibleTimeframe: VisibleTimeframeKey }) {
  const days = timeframeToDays(visibleTimeframe);
  const candles = stock.candles.slice(-Math.max(2, days));
  if (candles.length < 2) {
    return <span className="sparkline-empty">--</span>;
  }
  const width = 118;
  const height = 34;
  const padding = 3;
  const closes = candles.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const points = closes
    .map((close, index) => {
      const x = padding + (index / Math.max(1, closes.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (close - min) / range) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const isUp = closes[closes.length - 1] >= closes[0];
  return (
    <svg className={`stock-sparkline ${isUp ? "up" : "down"}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${stock.symbol} ${visibleTimeframeLabel(visibleTimeframe)} trend`}>
      <polyline points={points} />
    </svg>
  );
}

type StockTooltipPayload = {
  dataKey?: string;
  name?: string;
  value?: number | string;
  payload?: ChartCandle & { return: number };
};

function formatTooltipDate(value: string | number | undefined) {
  if (value === undefined) {
    return "";
  }
  const raw = String(value);
  if (!raw.includes("T")) {
    return raw;
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return raw;
  }
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StockPointTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: StockTooltipPayload[];
  label?: string | number;
  mode: ChartMode;
}) {
  const row = payload?.find((item) => item.payload)?.payload;
  if (!active || !row) {
    return null;
  }

  const primary =
    mode === "volume"
      ? { label: "Volume", value: `${Math.round(row.volume).toLocaleString()} shares` }
      : mode === "returns"
        ? { label: "Return", value: `${row.return.toFixed(2)}%` }
        : { label: "Close", value: currency.format(row.close) };

  return (
    <div className="stock-tooltip">
      <div className="stock-tooltip-head">
        <strong>{formatTooltipDate(label ?? row.date)}</strong>
        <span>{primary.label}: {primary.value}</span>
      </div>
      <div className="stock-tooltip-badges">
        <span className={`state-pill ${stateClass(row.chartState)}`}>{row.chartState}</span>
        <span className={`risk ${riskClass(row.chartRisk)}`}>{row.chartRisk} risk</span>
      </div>
      <div className="stock-tooltip-grid">
        <span>Open</span>
        <b>{currency.format(row.open)}</b>
        <span>High</span>
        <b>{currency.format(row.high)}</b>
        <span>Low</span>
        <b>{currency.format(row.low)}</b>
        <span>Close</span>
        <b>{currency.format(row.close)}</b>
        <span>Gap</span>
        <b className={row.gapReturn >= 0 ? "positive" : "negative"}>{row.gapReturn.toFixed(2)}%</b>
      </div>
    </div>
  );
}

function MinuteValuesPanel({ rows }: { rows: Array<ChartCandle & { return: number }> }) {
  const visibleRows = rows.slice(-120);
  return (
    <div className="minute-values-panel" aria-label="Minute values">
      <div className="minute-values-head">
        <strong>Minute values</strong>
        <span>
          showing {visibleRows.length} of {rows.length} visible minute candles
        </span>
      </div>
      <div className="minute-values-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th>Return</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.date}>
                <td>{chartTickLabel(row.date)}</td>
                <td>{currency.format(row.open)}</td>
                <td>{currency.format(row.high)}</td>
                <td>{currency.format(row.low)}</td>
                <td>{currency.format(row.close)}</td>
                <td className={row.return >= 0 ? "positive" : "negative"}>{row.return.toFixed(2)}%</td>
                <td>{Math.round(row.volume).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarkovPanel({ model }: { model: MarkovModel }) {
  return (
    <div className="markov-panel" aria-label="Markov state transition probabilities">
      <div className="markov-head">
        <span>Markov next-state probability</span>
        <strong>{model.currentState} now</strong>
      </div>
      <div className="markov-bars">
        {MARKET_STATES.map((state) => {
          const probability = model.probabilities[state] ?? 0;
          return (
            <div key={state} className="markov-bar-row">
              <span className={`state-pill ${stateClass(state)}`}>{state}</span>
              <div className="markov-track">
                <i className={stateClass(state)} style={{ width: `${Math.round(probability * 100)}%` }} />
              </div>
              <strong>{Math.round(probability * 100)}%</strong>
            </div>
          );
        })}
      </div>
      <div className="markov-matrix">
        <span />
        {MARKET_STATES.map((state) => <b key={state}>{state}</b>)}
        {MARKET_STATES.map((from) => (
          <Fragment key={from}>
            <b>{from}</b>
            {MARKET_STATES.map((to) => (
              <span key={`${from}-${to}`}>{Math.round((model.matrix[from][to] ?? 0) * 100)}%</span>
            ))}
          </Fragment>
        ))}
      </div>
      <small>{model.transitions} observed state transitions with Laplace smoothing</small>
    </div>
  );
}

function VolumeRiskFactorPanel({
  signal,
  stockFactor,
  chartDate,
}: {
  signal: VolumeStateRiskSignal | null;
  stockFactor: StockVolumeFactor;
  chartDate: string;
}) {
  const tone = signal ? riskFromScore(signal.volumeStateRiskScore) : stockFactor.tone;
  const isStale = Boolean(signal && signal.date < chartDate);
  const score = signal?.volumeStateRiskScore ?? 0;

  return (
    <div className="volume-risk-panel" aria-label="Transformer volume-change risk factor">
      <div className="volume-risk-head">
        <div>
          <span>Volume-state transformer risk factor</span>
          <strong className={`risk ${riskClass(tone)}`}>{tone}</strong>
        </div>
        <small>
          {signal ? `model date ${signal.date}${isStale ? `, nearest before ${chartDate}` : ""}` : "model signal unavailable"}
        </small>
      </div>
      <div className="volume-risk-meter">
        <i style={{ width: `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%` }} />
      </div>
      <div className="volume-risk-grid">
        <span>
          <b>{signal ? `${Math.round(signal.riskOffProb * 100)}%` : "--"}</b>
          risk-off
        </span>
        <span>
          <b>{signal ? `${Math.round(signal.stateChangeProb * 100)}%` : "--"}</b>
          state change
        </span>
        <span>
          <b>{signal ? `${(signal.predictedSpyReturn5d * 100).toFixed(2)}%` : "--"}</b>
          SPY 5d forecast
        </span>
        <span>
          <b>{signal ? `${Math.round(signal.downDollarVolumeShare * 100)}%` : "--"}</b>
          down-volume share
        </span>
        <span>
          <b>{stockFactor.ratio5v20.toFixed(2)}x</b>
          stock 5d/20d volume
        </span>
        <span>
          <b>{`${Math.round(stockFactor.downVolumeShare10d * 100)}%`}</b>
          stock down-volume 10d
        </span>
      </div>
      <div className="volume-risk-flags">
        <span className={signal?.riskOff ? "active" : ""}>risk-off gate</span>
        <span className={signal?.liquidationRisk ? "active" : ""}>liquidation</span>
        <span className={signal?.rotationRisk ? "active" : ""}>rotation</span>
        <span className={signal?.leaderRisk ? "active" : ""}>leader risk</span>
        <span className={stockFactor.abnormalVolumeDays10d ? "active" : ""}>
          {stockFactor.abnormalVolumeDays10d} abnormal volume days
        </span>
      </div>
    </div>
  );
}

function RecommendationStrip({ recommendations }: { recommendations?: WindowedRecommendations }) {
  return (
    <div className="recommendation-strip" aria-label="Multi-window recommendations">
      {RECOMMENDATION_WINDOWS.map((days) => {
        const recommendation = recommendations?.[days];
        return (
          <span
            key={days}
            className={`recommendation-window ${recommendation ? recommendationClass(recommendation.action) : "hold"}`}
            title={
              recommendation
                ? `${days}d: ${recommendation.action} · ${recommendation.confidence}% confidence · ${recommendation.reason}`
                : `${days}d: unavailable`
            }
          >
            <b>{days}</b>
            {recommendation ? recommendationShortLabel(recommendation.action) : "--"}
          </span>
        );
      })}
    </div>
  );
}

function formatSignalValue(key: TechnicalSignalKey, value: number) {
  if (key === "volumeRatio" || key === "dollarVolumeTrend") {
    return `${value.toFixed(2)}x`;
  }
  if (key === "rsi14" || key === "stochastic14" || key === "breakout20" || key === "mfi14" || key === "donchian55" || key === "choppiness14") {
    return value.toFixed(1);
  }
  if (key === "bollinger20") {
    return `${value.toFixed(2)}z`;
  }
  if (key === "williamsR14" || key === "cci20" || key === "adxTrend") {
    return value.toFixed(1);
  }
  if (key === "keltner20") {
    return `${value.toFixed(2)}ch`;
  }
  if (key === "chaikinMoneyFlow20" || key === "correlationSpy60" || key === "betaSpy60") {
    return value.toFixed(2);
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function SignalMiniSparkline({ values }: { values: number[] }) {
  const width = 128;
  const height = 34;
  const rows = values.length ? values : [0];
  const points = rows
    .map((value, index) => {
      const x = rows.length === 1 ? width : (index / (rows.length - 1)) * width;
      const y = height / 2 - clampScore(value) * (height / 2 - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = rows[rows.length - 1] ?? 0;
  return (
    <svg className="signal-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} />
      <polyline points={points} className={latest >= 0 ? "positive" : "negative"} />
    </svg>
  );
}

function SignalInfoButton({
  label,
  description,
  decision,
}: {
  label: string;
  description: string;
  decision: string;
}) {
  return (
    <span className="signal-info">
      <button type="button" aria-label={`Explain ${label}`}>
        <Info size={13} />
      </button>
      <span className="signal-info-popover" role="tooltip">
        <strong>{label}</strong>
        <span>{description}</span>
        <em>{decision}</em>
      </span>
    </span>
  );
}

function TechnicalSignalsPanel({
  stock,
  signalCache,
  signalWeights,
}: {
  stock: StockSymbol;
  signalCache?: TechnicalSignalCache | null;
  signalWeights: SignalWeights;
}) {
  const snapshots = signalCache?.symbols[stock.symbol] ?? [];
  const latest = snapshots[snapshots.length - 1];
  const weighted = weightedTechnicalSignal(latest, signalWeights);
  if (!weighted) {
    return null;
  }
  const chartRows = snapshots.slice(-180).map((snapshot) => {
    const weightedSnapshot = weightedTechnicalSignal(snapshot, signalWeights);
    return {
      date: snapshot.date,
      score: Number((weightedSnapshot?.score ?? 0).toFixed(3)),
    };
  });
  const contributionRows = weighted.contributions
    .map((item) => ({
      ...item,
      history: snapshots.slice(-72).map((snapshot) => snapshot.scores[item.key] ?? 0),
    }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));
  const definitionsByKey = Object.fromEntries(TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => [definition.key, definition]));

  return (
    <section className="technical-signals-panel" aria-label={`${stock.symbol} technical trading signals`}>
      <div className="panel-head">
        <div>
          <h2>Technical signals</h2>
          <span className="table-sort-summary">cached indicators · weighted recommendation input · latest {latest.date}</span>
        </div>
        <span className={`recommendation ${recommendationClass(weighted.action)}`}>
          {weighted.action} · {weighted.confidence}%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={chartRows}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" minTickGap={34} />
          <YAxis domain={[-1, 1]} width={38} tickFormatter={(value) => Number(value).toFixed(1)} />
          <Tooltip formatter={(value) => Number(value).toFixed(2)} />
          <Line type="monotone" dataKey="score" stroke="#177e89" strokeWidth={2.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="technical-signal-grid">
        {contributionRows.map((signal) => (
          <article key={signal.key} className="technical-signal-row">
            <div>
              <div className="technical-signal-title">
                <strong>{signal.label}</strong>
                <SignalInfoButton
                  label={signal.label}
                  description={definitionsByKey[signal.key].description}
                  decision={definitionsByKey[signal.key].decision}
                />
              </div>
              <span>{signal.group} · weight {signal.weight.toFixed(2)} · value {formatSignalValue(signal.key, signal.value)}</span>
            </div>
            <SignalMiniSparkline values={signal.history} />
            <b className={signal.score >= 0 ? "positive" : "negative"}>{signal.score >= 0 ? "+" : ""}{signal.score.toFixed(2)}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function VisibleTimeframeControl({
  value,
  onChange,
}: {
  value: VisibleTimeframeKey;
  onChange: (value: VisibleTimeframeKey) => void;
}) {
  return (
    <div className="lookback-control" aria-label="Visible chart timeframe">
      <label>
        <span>Visible timeframe</span>
        <select value={value} onChange={(event) => onChange(normalizeVisibleTimeframe(event.target.value))}>
          {VISIBLE_TIMEFRAME_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (name: string) => void }) {
  const [email, setEmail] = useState("viktor@example.com");
  const [password, setPassword] = useState("portfolio");

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="Login">
        <div className="brand-mark">
          <TrendingUp size={22} />
        </div>
        <h1>PortfolioPilot</h1>
        <p>Stock portfolio command center for research, allocation, and upcoming Alpaca execution.</p>
        <label>
          Email
          <span>
            <User size={16} />
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </span>
        </label>
        <label>
          Password
          <span>
            <Lock size={16} />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </span>
        </label>
        <button className="primary-action" onClick={() => onLogin(email.split("@")[0] || "Portfolio Manager")}>
          <ShieldCheck size={18} />
          Sign in
        </button>
      </section>
    </main>
  );
}

function AppShell({
  screen,
  setScreen,
  onLogout,
  children,
  user,
  syncState,
  syncMessage,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  onLogout: () => void;
  children: React.ReactNode;
  user: string;
  syncState: SyncState;
  syncMessage: string;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark small">
            <TrendingUp size={18} />
          </span>
          <strong>PortfolioPilot</strong>
        </div>
        <div className={`global-sync-indicator ${syncState}`} title={syncMessage || "Alpaca background sync"}>
          <span />
          <b>{syncState === "syncing" ? "Syncing Alpaca" : syncState === "error" ? "Sync issue" : "Alpaca sync"}</b>
        </div>
        <nav>
          <button className={screen === "stocks" ? "active" : ""} onClick={() => setScreen("stocks")}>
            <Table2 size={18} />
            Stocks
          </button>
          <button className={screen === "portfolio" ? "active" : ""} onClick={() => setScreen("portfolio")}>
            <Wallet size={18} />
            Portfolio
          </button>
          <button className={screen === "strategies" ? "active" : ""} onClick={() => setScreen("strategies")}>
            <SlidersHorizontal size={18} />
            Strategies
          </button>
          <button className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}>
            <Settings size={18} />
            Settings
          </button>
        </nav>
        <div className="sidebar-footer">
          <div>
            <span>Signed in</span>
            <strong>{user}</strong>
          </div>
          <button className="icon-button" onClick={onLogout} aria-label="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">{children}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function PortfolioProfitLossStrip({ periods }: { periods: PortfolioProfitLossPeriod[] }) {
  return (
    <section className="portfolio-pl-grid" aria-label="Portfolio profit and loss by period">
      {periods.map((period) => {
        const isPositive = (period.value ?? 0) >= 0;
        const percent = period.percent === null ? "--" : `${period.percent >= 0 ? "+" : ""}${period.percent.toFixed(2)}%`;
        return (
          <article key={period.label} className="portfolio-pl-card">
            <span>{period.label} P/L</span>
            <strong className={period.value === null ? undefined : isPositive ? "positive" : "negative"}>
              {period.value === null ? "--" : formatSignedCurrency(period.value)}
            </strong>
            <small>
              {percent}
              {!period.complete && period.value !== null ? " · partial history" : ""}
            </small>
          </article>
        );
      })}
    </section>
  );
}

function ChartToolbar({ mode, setMode }: { mode: ChartMode; setMode: (mode: ChartMode) => void }) {
  const modes: Array<{ id: ChartMode; icon: React.ReactNode; label: string }> = [
    { id: "price", icon: <LineChartIcon size={16} />, label: "Price" },
    { id: "candles", icon: <CandlestickChart size={16} />, label: "Candles" },
    { id: "volume", icon: <BarChart3 size={16} />, label: "Volume" },
    { id: "returns", icon: <PieChart size={16} />, label: "Returns" },
  ];

  return (
    <div className="segmented" role="tablist" aria-label="Chart type">
      {modes.map((item) => (
        <button key={item.id} className={mode === item.id ? "selected" : ""} onClick={() => setMode(item.id)} title={item.label}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function Candles({ candles }: { candles: ChartCandle[] }) {
  const width = 820;
  const height = 310;
  const left = 52;
  const right = 24;
  const topPad = 18;
  const bottom = 54;
  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const plotWidth = width - left - right;
  const plotHeight = height - topPad - bottom;
  const scaleY = (value: number) => topPad + ((max - value) / (max - min || 1)) * plotHeight;
  const gap = plotWidth / candles.length;
  const tickRows = candles.filter((_, index) => index % Math.max(1, Math.ceil(candles.length / 6)) === 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="candles" role="img" aria-label="Candlestick chart">
      <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      <line x1={left} y1={topPad} x2={left} y2={height - bottom} />
      {candles.map((item, index) => {
        const x = left + index * gap + gap / 2;
        const up = item.close >= item.open;
        const top = scaleY(Math.max(item.open, item.close));
        const bottom = scaleY(Math.min(item.open, item.close));
        return (
          <g key={`${item.date}-${index}`} className={up ? "up" : "down"}>
            <title>
              {`${formatTooltipDate(item.date)}\nState: ${item.chartState}\nRisk: ${item.chartRisk}\nOpen: ${currency.format(item.open)}\nHigh: ${currency.format(item.high)}\nLow: ${currency.format(item.low)}\nClose: ${currency.format(item.close)}\nGap: ${item.gapReturn.toFixed(2)}%`}
            </title>
            {item.gapUp && (
              <path
                className="gap-up-marker"
                d={`M ${x} ${Math.max(topPad + 4, scaleY(item.high) - 10)} l -4 8 h 8 z`}
              />
            )}
            <line x1={x} y1={scaleY(item.high)} x2={x} y2={scaleY(item.low)} />
            <rect x={x - Math.max(3, gap * 0.28)} y={top} width={Math.max(6, gap * 0.56)} height={Math.max(2, bottom - top)} rx={1} />
          </g>
        );
      })}
      {tickRows.map((item) => {
        const index = candles.indexOf(item);
        const x = left + index * gap + gap / 2;
        return (
          <text key={`${item.date}-tick`} className="candle-x-tick" x={x} y={height - 18} textAnchor="middle">
            {chartTickLabel(item.date)}
          </text>
        );
      })}
    </svg>
  );
}

function StockChart({
  stock,
  mode,
  lookbackDays,
  visibleTimeframe,
  volumeSignals,
  cacheVersion = 0,
}: {
  stock: StockSymbol;
  mode: ChartMode;
  lookbackDays: number;
  visibleTimeframe: VisibleTimeframeKey;
  volumeSignals: VolumeStateRiskSignal[];
  cacheVersion?: number;
}) {
  const aggregation = autoChartAggregation(visibleTimeframe);
  const [intradayPayload, setIntradayPayload] = useState<IntradayCachePayload | null>(null);
  const [intradayStatus, setIntradayStatus] = useState<"idle" | "loading" | "ready" | "missing">("idle");

  useEffect(() => {
    let cancelled = false;
    setIntradayPayload(null);
    if (aggregation === "1d") {
      setIntradayStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setIntradayStatus("loading");
    loadIntradayCandles(stock.symbol, cacheVersion)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setIntradayPayload(payload);
        setIntradayStatus(payload?.rows?.length ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) {
          setIntradayStatus("missing");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aggregation, cacheVersion, stock.symbol]);

  const sourceCandles = aggregation === "1d" ? stock.candles : intradayPayload?.rows?.length ? intradayPayload.rows : stock.candles;
  const aggregatedCandles = useMemo(() => aggregateCandles(sourceCandles, aggregation), [aggregation, sourceCandles]);
  const allCandles = useMemo(() => withChartStates(aggregatedCandles, lookbackDays), [aggregatedCandles, lookbackDays]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pageOffset, setPageOffset] = useState(0);
  const effectiveVisibleTimeframe = visibleTimeframe;
  useEffect(() => {
    setZoomLevel(1);
    setPageOffset(0);
  }, [aggregation, stock.symbol, visibleTimeframe]);
  const windowCandles = useMemo(() => {
    if (!allCandles.length) {
      return [];
    }
    const latestTime = candleTime(allCandles[allCandles.length - 1]);
    const earliestTime = candleTime(allCandles[0]);
    const hasIntradayDates = allCandles.some((candle) => candle.date.includes("T"));
    if (hasIntradayDates && Number.isFinite(latestTime)) {
      const windowMs = timeframeToMilliseconds(effectiveVisibleTimeframe);
      const maxPageOffset = Number.isFinite(earliestTime) ? Math.max(0, Math.floor((latestTime - earliestTime) / windowMs)) : 0;
      const safePageOffset = Math.min(pageOffset, maxPageOffset);
      const endTime = latestTime - safePageOffset * windowMs;
      const startTime = endTime - windowMs;
      return allCandles.filter((candle) => {
        const time = candleTime(candle);
        return time > startTime && time <= endTime;
      });
    }
    const pageSize = timeframeToDays(effectiveVisibleTimeframe);
    const maxPageOffset = Math.max(0, Math.ceil(allCandles.length / pageSize) - 1);
    const safePageOffset = Math.min(pageOffset, maxPageOffset);
    const endIndex = Math.max(0, allCandles.length - safePageOffset * pageSize);
    const startIndex = Math.max(0, endIndex - pageSize);
    return allCandles.slice(startIndex, endIndex);
  }, [allCandles, effectiveVisibleTimeframe, pageOffset]);
  const zoomedVisibleCount = Math.max(2, Math.ceil(windowCandles.length / zoomLevel));
  const candles = useMemo(() => windowCandles.slice(-zoomedVisibleCount), [windowCandles, zoomedVisibleCount]);
  const rows = candles.map((item, index) => ({
    ...item,
    return: Number(((item.close / candles[Math.max(index - 1, 0)].close - 1) * 100).toFixed(2)),
  }));
  const bands = stateBands(rows);
  const riskTimeline = riskBands(rows);
  const recommendationTimeline = useMemo(() => buildRecommendationStack(allCandles, rows), [allCandles, rows]);
  const gapUpCount = rows.filter((row) => row.gapUp).length;
  const markov = markovModel(allCandles);
  const chartDate = rows[rows.length - 1]?.date ?? "";
  const volumeSignal = latestVolumeStateSignal(volumeSignals, chartDate);
  const selectedVolumeFactor = stockVolumeFactor(allCandles);
  const volumeRiskPanel = (
    <VolumeRiskFactorPanel signal={volumeSignal} stockFactor={selectedVolumeFactor} chartDate={chartDate} />
  );
  const hasIntradayDates = allCandles.some((candle) => candle.date.includes("T"));
  const pageWindowSize = hasIntradayDates
    ? timeframeToMilliseconds(effectiveVisibleTimeframe)
    : timeframeToDays(effectiveVisibleTimeframe);
  const chartLatestTime = allCandles.length ? candleTime(allCandles[allCandles.length - 1]) : 0;
  const chartEarliestTime = allCandles.length ? candleTime(allCandles[0]) : 0;
  const maxPageOffset = hasIntradayDates
    ? Math.max(0, Math.floor((chartLatestTime - chartEarliestTime) / Number(pageWindowSize || 1)))
    : Math.max(0, Math.ceil(allCandles.length / Number(pageWindowSize || 1)) - 1);
  const safePageOffset = Math.min(pageOffset, maxPageOffset);
  const canZoomIn = windowCandles.length > 4 && zoomedVisibleCount > 4;
  const canZoomOut = zoomLevel > 1;
  const canPageOlder = safePageOffset < maxPageOffset;
  const canPageNewer = safePageOffset > 0;
  const canResetChart = canZoomOut || canPageNewer;
  const pageLabel = safePageOffset === 0 ? "Latest page" : `${safePageOffset + 1} pages back`;
  function movePage(direction: -1 | 1) {
    setZoomLevel(1);
    setPageOffset((current) => Math.min(maxPageOffset, Math.max(0, current + direction)));
  }
  const zoomControls = (
    <div className="chart-zoom-controls" aria-label="Chart zoom controls">
      <span>{pageLabel} · {rows.length} of {windowCandles.length} points</span>
      <button className="icon-button" onClick={() => movePage(1)} disabled={!canPageOlder} aria-label="Show older chart page">
        <ChevronLeft size={16} />
      </button>
      <button className="icon-button" onClick={() => movePage(-1)} disabled={!canPageNewer} aria-label="Show newer chart page">
        <ChevronRight size={16} />
      </button>
      <button className="icon-button" onClick={() => setZoomLevel((current) => Math.min(16, current * 2))} disabled={!canZoomIn} aria-label="Zoom in chart">
        <ZoomIn size={16} />
      </button>
      <button className="icon-button" onClick={() => setZoomLevel((current) => Math.max(1, Math.floor(current / 2)))} disabled={!canZoomOut} aria-label="Zoom out chart">
        <ZoomOut size={16} />
      </button>
      <button
        className="text-button"
        onClick={() => {
          setZoomLevel(1);
          setPageOffset(0);
        }}
        disabled={!canResetChart}
      >
        Reset
      </button>
    </div>
  );
  const dataResolutionNote =
    aggregation === "1d"
      ? "Daily cache"
      : intradayStatus === "ready" && intradayPayload
        ? `Intraday cache · auto ${chartAggregationLabel(aggregation)} points · ${intradayPayload.start.slice(0, 16)} to ${intradayPayload.end.slice(0, 16)}`
        : intradayStatus === "loading"
          ? "Loading intraday cache"
          : `Intraday cache missing, showing daily cache instead of auto ${chartAggregationLabel(aggregation)} points`;
  const dataNote = (
    <div className="chart-data-note">
      {dataResolutionNote}
      <span>{visibleTimeframeLabel(visibleTimeframe)} window · auto resolution {chartAggregationLabel(aggregation)}</span>
    </div>
  );
  const minuteValuesPanel = aggregation === "1m" && intradayStatus === "ready" ? <MinuteValuesPanel rows={rows} /> : null;

  if (mode === "candles") {
    return (
      <>
        {dataNote}
        {zoomControls}
        <div className="regime-chart-frame candle-chart-frame">
          <RegimeBackground bands={bands} />
          <RecommendationHeatmapBackground rows={recommendationTimeline} />
          <Candles candles={candles} />
        </div>
        <div className="gap-summary">{gapUpCount} gap ups in visible window</div>
        <RiskStrip bands={riskTimeline} />
        {minuteValuesPanel}
        <MarkovPanel model={markov} />
        {volumeRiskPanel}
      </>
    );
  }

  if (mode === "volume") {
    return (
      <>
        {dataNote}
        {zoomControls}
        <div className="regime-chart-frame">
          <RegimeBackground bands={bands} />
          <RecommendationHeatmapBackground rows={recommendationTimeline} />
          <GapMarkers rows={rows} />
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={rows} margin={{ top: 18, right: 24, bottom: 24, left: 0 }}>
              <XAxis dataKey="date" minTickGap={28} height={30} tickFormatter={chartTickLabel} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}M`} width={52} />
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <Tooltip content={<StockPointTooltip mode="volume" />} />
              <Bar dataKey="volume" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {rows.map((item) => (
                  <Cell key={item.date} fill={item.close >= item.open ? "#16856f" : "#c2414b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <RiskStrip bands={riskTimeline} />
        {minuteValuesPanel}
        <MarkovPanel model={markov} />
        {volumeRiskPanel}
      </>
    );
  }

  if (mode === "returns") {
    return (
      <>
        {dataNote}
        {zoomControls}
        <div className="regime-chart-frame">
          <RegimeBackground bands={bands} />
          <RecommendationHeatmapBackground rows={recommendationTimeline} />
          <GapMarkers rows={rows} />
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={rows} margin={{ top: 18, right: 24, bottom: 24, left: 0 }}>
              <XAxis dataKey="date" minTickGap={28} height={30} tickFormatter={chartTickLabel} />
              <YAxis unit="%" width={52} />
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <Tooltip content={<StockPointTooltip mode="returns" />} />
              <Bar dataKey="return" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {rows.map((item) => (
                  <Cell key={item.date} fill={item.return >= 0 ? "#16856f" : "#c2414b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <RiskStrip bands={riskTimeline} />
        {minuteValuesPanel}
        <MarkovPanel model={markov} />
        {volumeRiskPanel}
      </>
    );
  }

  return (
    <>
      {dataNote}
      {zoomControls}
      <div className="regime-chart-frame">
        <RegimeBackground bands={bands} />
        <RecommendationHeatmapBackground rows={recommendationTimeline} />
        <GapMarkers rows={rows} />
        <ResponsiveContainer width="100%" height={310}>
          <AreaChart data={rows} margin={{ top: 18, right: 24, bottom: 24, left: 0 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#177e89" stopOpacity={0.34} />
                <stop offset="95%" stopColor="#177e89" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" minTickGap={28} height={30} tickFormatter={chartTickLabel} />
            <YAxis domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} width={52} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <Tooltip content={<StockPointTooltip mode="price" />} />
            <Area
              type="monotone"
              dataKey="close"
              stroke="#177e89"
              strokeWidth={2.4}
              fill="url(#priceFill)"
              dot={aggregation === "1m" ? { r: 2, fill: "#177e89", strokeWidth: 0 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <RiskStrip bands={riskTimeline} />
      {minuteValuesPanel}
      <MarkovPanel model={markov} />
      {volumeRiskPanel}
    </>
  );
}

function StocksScreen() {
  const [dataset, setDataset] = useState<MarketDataset | null>(null);
  const [volumeSignals, setVolumeSignals] = useState<VolumeStateRiskSignal[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("NVDA");
  const [mode, setMode] = useState<ChartMode>("price");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [minuteCacheVersion, setMinuteCacheVersion] = useState(0);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [visibleTimeframe, setVisibleTimeframe] = useState<VisibleTimeframeKey>("90d");
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>(
    () => (localStorage.getItem("stock_table_sort_key") as TableSortKey | null) ?? "recommendation",
  );
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>(
    () => (localStorage.getItem("stock_filter_recommendation") as RecommendationFilter | null) ?? "all",
  );
  const [stateFilter, setStateFilter] = useState<StateFilter>(
    () => (localStorage.getItem("stock_filter_state") as StateFilter | null) ?? "all",
  );
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(
    () => (localStorage.getItem("stock_filter_risk") as RiskFilter | null) ?? "all",
  );
  const [sectorFilter, setSectorFilter] = useState(() => localStorage.getItem("stock_filter_sector") ?? "all");
  const signalWeights = useMemo(() => loadSignalWeights(), []);
  const stocks = useMemo(() => applyStateLookback(dataset?.symbols ?? [], DEFAULT_STATE_LOOKBACK), [dataset]);
  const technicalSignals = useMemo(() => (dataset ? buildCachedTechnicalSignals(dataset) : null), [dataset]);
  const visibleTimeframeDays = timeframeToDays(visibleTimeframe);
  const windowedRecommendations = useMemo(
    () =>
      Object.fromEntries(
        stocks.map((stock) => [stock.symbol, buildWindowedRecommendations(stock, volumeSignals, technicalSignals, signalWeights)]),
      ) as Record<string, WindowedRecommendations>,
    [signalWeights, stocks, technicalSignals, volumeSignals],
  );
  const recommendations = useMemo(
    () =>
      Object.fromEntries(
        stocks.map((stock) => [
          stock.symbol,
          primaryRecommendation(windowedRecommendations[stock.symbol]) ?? buildTradeRecommendation(stock, DEFAULT_STATE_LOOKBACK, volumeSignals),
        ]),
      ) as Record<string, TradeRecommendation>,
    [stocks, volumeSignals, windowedRecommendations],
  );
  const gapUpCounts = useMemo(
    () =>
      Object.fromEntries(
        stocks.map((stock) => [stock.symbol, visibleGapUpCount(stock, DEFAULT_STATE_LOOKBACK, visibleTimeframeDays)]),
      ) as Record<string, number>,
    [stocks, visibleTimeframeDays],
  );
  const selected = stocks.find((stock) => stock.symbol === selectedSymbol) ?? stocks[0];
  const selectedRecommendations = selected ? windowedRecommendations[selected.symbol] : undefined;
  const selectedAggregation = autoChartAggregation(visibleTimeframe);
  const marketRecommendations = useMemo(
    () => buildMarketWindowRecommendations(windowedRecommendations),
    [windowedRecommendations],
  );
  const sectorOptions = useMemo(
    () => Array.from(new Set(stocks.map((stock) => stock.sector).filter(Boolean))).sort(),
    [stocks],
  );
  const filteredStocks = useMemo(
    () =>
      stocks.filter((stock) => {
        const recommendation = recommendations[stock.symbol];
        return (
          (recommendationFilter === "all" || recommendation?.action === recommendationFilter) &&
          (stateFilter === "all" || stock.marketState === stateFilter) &&
          (riskFilter === "all" || stock.risk === riskFilter) &&
          (sectorFilter === "all" || stock.sector === sectorFilter)
        );
      }),
    [recommendationFilter, recommendations, riskFilter, sectorFilter, stateFilter, stocks],
  );
  const visibleStocks = filteredStocks.filter((stock) =>
    `${stock.symbol} ${stock.name} ${stock.sector}`.toLowerCase().includes(query.toLowerCase()),
  );
  const sortedVisibleStocks = useMemo(() => {
    const sortable = visibleStocks;
    const sortValue = (stock: StockSymbol): number | string => {
      const recommendation = recommendations[stock.symbol];
      if (tableSortKey === "recommendation") {
        return recommendation ? recommendationRank(recommendation.action) * 100 + recommendation.score : 0;
      }
      if (tableSortKey === "confidence") {
        return recommendation?.confidence ?? 0;
      }
      if (tableSortKey === "gapUps") {
        return gapUpCounts[stock.symbol] ?? 0;
      }
      if (tableSortKey === "trend") {
        return stock.trendReturn;
      }
      if (tableSortKey === "change") {
        return stock.change;
      }
      if (tableSortKey === "weight") {
        return stock.weight;
      }
      if (tableSortKey === "volume") {
        return volumeNumber(stock.volume);
      }
      if (tableSortKey === "state") {
        return stateRank(stock.marketState);
      }
      if (tableSortKey === "risk") {
        return riskRank(stock.risk);
      }
      return stock.symbol;
    };

    return [...sortable].sort((left, right) => {
      const leftValue = sortValue(left);
      const rightValue = sortValue(right);
      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return String(leftValue).localeCompare(String(rightValue));
      }
      return rightValue - leftValue || left.symbol.localeCompare(right.symbol);
    });
  }, [gapUpCounts, recommendations, tableSortKey, visibleStocks]);
  const sortedTableStocks = sortedVisibleStocks;
  const topHoldingWeight = stocks.filter((stock) => stock.symbol !== "SPY").reduce((sum, stock) => sum + stock.weight, 0);
  const bullCount = stocks.filter((stock) => stock.marketState === "Bull").length;
  const sidewaysCount = stocks.filter((stock) => stock.marketState === "Sideways").length;
  const bearCount = stocks.filter((stock) => stock.marketState === "Bear").length;
  const stateTotals = [
    { state: "Bull" as MarketState, count: bullCount },
    { state: "Sideways" as MarketState, count: sidewaysCount },
    { state: "Bear" as MarketState, count: bearCount },
  ];
  const stateWindowTotals = useMemo(
    () =>
      RECOMMENDATION_WINDOWS.map((days) => {
        const totals = MARKET_STATES.map((state) => ({
          state,
          count: stocks.filter((stock) => classifyMarketState(stock.candles, days).marketState === state).length,
        }));
        const dominant = [...totals].sort((left, right) => right.count - left.count)[0] ?? totals[0];
        return { days, totals, dominant };
      }),
    [stocks],
  );
  const buyCount = visibleStocks.filter((stock) => {
    const recommendation = recommendations[stock.symbol];
    return recommendation?.action === "Strong Buy" || recommendation?.action === "Buy";
  }).length;

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadMarketDataset(), loadVolumeStateRiskSignals()])
      .then(([nextDataset, nextVolumeSignals]) => {
        if (cancelled) {
          return;
        }
        setDataset(nextDataset);
        setVolumeSignals(nextVolumeSignals);
        setSelectedSymbol(nextDataset.symbols.find((stock) => stock.symbol === "NVDA")?.symbol ?? nextDataset.symbols[0]?.symbol ?? "");
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.removeItem("market_visible_timeframe_days");
  }, []);

  useEffect(() => {
    localStorage.setItem("stock_table_sort_key", tableSortKey);
  }, [tableSortKey]);

  useEffect(() => {
    localStorage.setItem("stock_filter_recommendation", recommendationFilter);
    localStorage.setItem("stock_filter_state", stateFilter);
    localStorage.setItem("stock_filter_risk", riskFilter);
    localStorage.setItem("stock_filter_sector", sectorFilter);
  }, [recommendationFilter, riskFilter, sectorFilter, stateFilter]);

  function clearFilters() {
    setRecommendationFilter("all");
    setStateFilter("all");
    setRiskFilter("all");
    setSectorFilter("all");
    setQuery("");
  }

  useEffect(() => {
    const listener = () => setMinuteCacheVersion((version) => version + 1);
    window.addEventListener("alpaca-data-synced", listener);
    return () => window.removeEventListener("alpaca-data-synced", listener);
  }, []);

  if (error) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Market cache unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!selected) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Loading market cache</h1>
          <p>Reading exported Alpaca daily bars from the local cache.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page stocks-page">
      <header className="page-header">
        <div>
          <h1>Stocks</h1>
          <p>
            Real cached Alpaca daily bars · {dataset?.symbols.length ?? 0} symbols · {dataset?.startDate} to {dataset?.endDate}
          </p>
        </div>
        <div className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbols" />
        </div>
      </header>

      <section className="metrics-grid">
        <Metric label="Visible symbols" value={`${visibleStocks.length}/${stocks.length}`} />
        <Metric label="Top holdings weight" value={`${topHoldingWeight.toFixed(1)}%`} />
        <Metric label="Bull / Sideways / Bear" value={`${bullCount} / ${sidewaysCount} / ${bearCount}`} tone={bullCount >= bearCount ? "good" : "warn"} />
        <Metric label="Buy candidates" value={`${buyCount}`} tone={buyCount > 0 ? "good" : "warn"} />
      </section>

      <section className="state-summary" aria-label="All cached stock states">
        <div className="state-summary-head">
          <strong>All cached stock states</strong>
          <span>{stocks.length} symbols · multi-window chart state · recommendations show 1/7/14/21/60d</span>
        </div>
        <div className="state-summary-track">
          {stateTotals.map((item) => (
            <i
              key={item.state}
              className={stateClass(item.state)}
              style={{ flexGrow: item.count || 0.0001 }}
              title={`${item.state}: ${item.count} symbols`}
            />
          ))}
        </div>
        <div className="state-summary-cells">
          {stateTotals.map((item) => (
            <span key={item.state}>
              <b className={`state-pill ${stateClass(item.state)}`}>{item.state}</b>
              <strong>{item.count}</strong>
              <small>{stocks.length ? Math.round((item.count / stocks.length) * 100) : 0}%</small>
            </span>
          ))}
        </div>
        <div className="state-window-charts" aria-label="State distribution by window">
          {stateWindowTotals.map((window) => (
            <article key={window.days} className="state-window-chart">
              <div className="state-window-chart-head">
                <strong>{window.days}d</strong>
                <span>
                  {window.dominant.state} {stocks.length ? Math.round((window.dominant.count / stocks.length) * 100) : 0}%
                </span>
              </div>
              <div className="state-window-track">
                {window.totals.map((item) => (
                  <i
                    key={item.state}
                    className={stateClass(item.state)}
                    style={{ flexGrow: item.count || 0.0001 }}
                    title={`${window.days}d ${item.state}: ${item.count} symbols`}
                  />
                ))}
              </div>
              <div className="state-window-counts">
                {window.totals.map((item) => (
                  <span key={item.state} className={stateClass(item.state)}>
                    {item.state.slice(0, 1)} {item.count}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
        <div className="market-recommendation-strip">
          <strong>Market overall</strong>
          <RecommendationStrip recommendations={marketRecommendations} />
        </div>
      </section>

      <VisibleTimeframeControl value={visibleTimeframe} onChange={setVisibleTimeframe} />

      <section className="lower-grid">
        <div className="panel symbol-table-panel">
          <div className="panel-head">
            <h2>Symbol Table</h2>
            <span className="table-sort-summary">{sortedTableStocks.length} matching symbols</span>
          </div>
          <section className="stock-filter-bar table-controls" aria-label="Symbol table filters">
            <label>
              <span>Sort by</span>
              <select value={tableSortKey} onChange={(event) => setTableSortKey(event.target.value as TableSortKey)}>
                <option value="recommendation">Recommendation</option>
                <option value="confidence">Confidence</option>
                <option value="gapUps">Gap ups</option>
                <option value="trend">Trend return</option>
                <option value="change">Last-day change</option>
                <option value="volume">Volume</option>
                <option value="weight">Weight</option>
                <option value="state">Market state</option>
                <option value="risk">Risk</option>
                <option value="symbol">Symbol</option>
              </select>
            </label>
            <label>
              <span>Recommendation</span>
              <select value={recommendationFilter} onChange={(event) => setRecommendationFilter(event.target.value as RecommendationFilter)}>
                <option value="all">All</option>
                <option value="Strong Buy">Strong Buy</option>
                <option value="Buy">Buy</option>
                <option value="Hold">Hold</option>
                <option value="Sell">Sell</option>
              </select>
            </label>
            <label>
              <span>State</span>
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}>
                <option value="all">All</option>
                <option value="Bull">Bull</option>
                <option value="Sideways">Sideways</option>
                <option value="Bear">Bear</option>
              </select>
            </label>
            <label>
              <span>Risk</span>
              <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}>
                <option value="all">All</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </label>
            <label>
              <span>Sector</span>
              <select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}>
                <option value="all">All</option>
                {sectorOptions.map((sector) => (
                  <option key={sector} value={sector}>{sector}</option>
                ))}
              </select>
            </label>
            <button onClick={clearFilters}>Clear</button>
          </section>
          <div className="table-wrap symbol-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>{visibleTimeframeLabel(visibleTimeframe)} chart</th>
                  <th>Name</th>
                  <th>Sector</th>
                  <th>Weight</th>
                  <th>Volume</th>
                  <th>Gap ups</th>
                  <th>Trend</th>
                  <th>Change</th>
                  <th>12M high</th>
                  <th>State</th>
                  <th>Risk</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {!sortedTableStocks.length && (
                  <tr>
                    <td colSpan={13} className="empty-table-cell">No stocks match the active filters.</td>
                  </tr>
                )}
                {sortedTableStocks.map((stock) => {
                  const twelveMonthHigh = trailingTwelveMonthHigh(stock);
                  return (
                    <tr
                      key={stock.symbol}
                      className={selected.symbol === stock.symbol ? "selected-row" : ""}
                      onClick={() => {
                        setSelectedSymbol(stock.symbol);
                        setStockDialogOpen(true);
                      }}
                    >
                      <td><strong>{stock.symbol}</strong></td>
                      <td><StockSparkline stock={stock} visibleTimeframe={visibleTimeframe} /></td>
                      <td>{stock.name}</td>
                      <td>{stock.sector}</td>
                      <td>{stock.weight.toFixed(1)}%</td>
                      <td>{stock.volume}</td>
                      <td>{gapUpCounts[stock.symbol] ?? 0}</td>
                      <td className={stock.trendReturn >= 0 ? "positive" : "negative"}>
                        {stock.trendReturn >= 0 ? "+" : ""}{stock.trendReturn.toFixed(2)}%
                      </td>
                      <td className={stock.change >= 0 ? "positive" : "negative"}>
                        {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                      </td>
                      <td>
                        <span className="max-value-cell">
                          <strong>{currency.format(twelveMonthHigh.value)}</strong>
                          <small>({twelveMonthHigh.belowHighPct.toFixed(1)}% below high)</small>
                        </span>
                      </td>
                      <td><span className={`state-pill ${stateClass(stock.marketState)}`}>{stock.marketState}</span></td>
                      <td><span className={`risk ${stock.risk.toLowerCase()}`}>{stock.risk}</span></td>
                      <td>
                        <RecommendationStrip recommendations={windowedRecommendations[stock.symbol]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {stockDialogOpen && selected && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setStockDialogOpen(false)}>
          <section
            className="trade-dialog stock-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.symbol} stock detail`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-head">
              <div>
                <span className="eyebrow">{selected.sector}</span>
                <h2>{selected.symbol} · {selected.name} · {currency.format(selected.price)}</h2>
                <div className="state-row">
                  <span className={`state-pill ${stateClass(selected.marketState)}`}>{selected.marketState}</span>
                  <RecommendationStrip recommendations={selectedRecommendations} />
                  <span>{selected.trendReturn >= 0 ? "+" : ""}{selected.trendReturn.toFixed(2)}% over {DEFAULT_STATE_LOOKBACK} trading days</span>
                  <span>showing {visibleTimeframeLabel(visibleTimeframe)}</span>
                  <span>auto points {chartAggregationLabel(selectedAggregation)}</span>
                  <span className={`risk ${riskClass(selected.risk)}`}>{selected.risk} risk</span>
                  <span className="gap-pill">{gapUpCounts[selected.symbol] ?? 0} gap ups</span>
                </div>
              </div>
              <button className="icon-button" onClick={() => setStockDialogOpen(false)} aria-label="Close stock detail dialog">X</button>
            </div>
            <div className="stock-detail-controls">
              <VisibleTimeframeControl value={visibleTimeframe} onChange={setVisibleTimeframe} />
            </div>
            <div className="chart-legends">
              <StateLegend />
              <RiskLegend />
              <GapLegend />
            </div>
            <div className="stock-detail-toolbar">
              <ChartToolbar mode={mode} setMode={setMode} />
            </div>
            <StockChart
              stock={selected}
              mode={mode}
              lookbackDays={DEFAULT_STATE_LOOKBACK}
              visibleTimeframe={visibleTimeframe}
              volumeSignals={volumeSignals}
              cacheVersion={minuteCacheVersion}
            />
            <TechnicalSignalsPanel stock={selected} signalCache={technicalSignals} signalWeights={signalWeights} />
          </section>
        </div>
      )}
    </main>
  );
}

function PortfolioScreen() {
  const [dataset, setDataset] = useState<MarketDataset | null>(null);
  const [alpacaData, setAlpacaData] = useState<AlpacaPortfolioData | null>(null);
  const [volumeSignals, setVolumeSignals] = useState<VolumeStateRiskSignal[]>([]);
  const [error, setError] = useState("");
  const [alpacaError, setAlpacaError] = useState("");
  const [, setAlpacaLoading] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [bulkOrderSubmitting, setBulkOrderSubmitting] = useState(false);
  const [transactionType, setTransactionType] = useState<"buy" | "sell">("buy");
  const [transactionSymbol, setTransactionSymbol] = useState("NVDA");
  const [transactionShares, setTransactionShares] = useState(1);
  const [transactionSizingMode, setTransactionSizingMode] = useState<"qty" | "notional">("qty");
  const [transactionNotional, setTransactionNotional] = useState(100);
  const [transactionPrice, setTransactionPrice] = useState(0);
  const [transactionOrderType, setTransactionOrderType] = useState<AlpacaOrderRequest["type"]>("market");
  const [transactionTimeInForce, setTransactionTimeInForce] = useState<AlpacaOrderRequest["time_in_force"]>("day");
  const [transactionLimitPrice, setTransactionLimitPrice] = useState("");
  const [transactionStopPrice, setTransactionStopPrice] = useState("");
  const [transactionTrailMode, setTransactionTrailMode] = useState<"price" | "percent">("price");
  const [transactionTrailPrice, setTransactionTrailPrice] = useState("");
  const [transactionTrailPercent, setTransactionTrailPercent] = useState("");
  const [transactionExtendedHours, setTransactionExtendedHours] = useState(false);
  const [transactionClientOrderId, setTransactionClientOrderId] = useState("");
  const [transactionOrderClass, setTransactionOrderClass] = useState<NonNullable<AlpacaOrderRequest["order_class"]>>("simple");
  const [transactionTakeProfitLimitPrice, setTransactionTakeProfitLimitPrice] = useState("");
  const [transactionStopLossStopPrice, setTransactionStopLossStopPrice] = useState("");
  const [transactionStopLossLimitPrice, setTransactionStopLossLimitPrice] = useState("");
  const [transactionPositionIntent, setTransactionPositionIntent] = useState<"" | NonNullable<AlpacaOrderRequest["position_intent"]>>("");
  const [transactionLegsJson, setTransactionLegsJson] = useState("");
  const [transactionAdvancedInstructionsJson, setTransactionAdvancedInstructionsJson] = useState("");
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [bulkOrderDialogOpen, setBulkOrderDialogOpen] = useState(false);
  const [stockDetailSymbol, setStockDetailSymbol] = useState<string | null>(null);
  const [stockDetailMode, setStockDetailMode] = useState<ChartMode>("price");
  const [stockDetailVisibleTimeframe, setStockDetailVisibleTimeframe] = useState<VisibleTimeframeKey>("90d");
  const [selectedPortfolioSymbol, setSelectedPortfolioSymbol] = useState("NVDA");
  const [recommendedTradeCount, setRecommendedTradeCount] = useState(3);
  const [portfolioView, setPortfolioView] = useState<PortfolioView>("overview");
  const signalWeights = useMemo(() => loadSignalWeights(), []);
  const stocks = useMemo(() => applyStateLookback(dataset?.symbols ?? [], DEFAULT_STATE_LOOKBACK), [dataset]);
  const technicalSignals = useMemo(() => (dataset ? buildCachedTechnicalSignals(dataset) : null), [dataset]);
  const latestDate = dataset?.endDate ?? "";
  const windowedRecommendations = useMemo(
    () =>
      Object.fromEntries(
        stocks.map((stock) => [stock.symbol, buildWindowedRecommendations(stock, volumeSignals, technicalSignals, signalWeights)]),
      ) as Record<string, WindowedRecommendations>,
    [signalWeights, stocks, technicalSignals, volumeSignals],
  );
  const recommendations = useMemo(
    () =>
      Object.fromEntries(
        stocks.map((stock) => [
          stock.symbol,
          primaryRecommendation(windowedRecommendations[stock.symbol]) ?? buildTradeRecommendation(stock, DEFAULT_STATE_LOOKBACK, volumeSignals),
        ]),
      ) as Record<string, TradeRecommendation>,
    [stocks, volumeSignals, windowedRecommendations],
  );
  const holdings = useMemo(
    () => buildAlpacaHoldings(stocks, alpacaData?.positions ?? [], alpacaData?.orders ?? [], recommendations, latestDate),
    [alpacaData, latestDate, recommendations, stocks],
  );
  const selectedHolding = holdings.find((holding) => holding.symbol === selectedPortfolioSymbol) ?? holdings[0];
  const selectedSymbol = selectedHolding?.symbol ?? selectedPortfolioSymbol;
  const selectedPortfolioStock = stocks.find((stock) => stock.symbol === selectedSymbol) ?? selectedHolding?.stock;
  const portfolioSeries = useMemo(
    () => buildAlpacaPortfolioValueSeries(stocks, alpacaData?.positions ?? [], alpacaData?.account ?? null, alpacaData?.history ?? null, selectedSymbol),
    [alpacaData, selectedSymbol, stocks],
  );
  const currentCash = numberFromAlpaca(alpacaData?.account.cash);
  const holdingsValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const totalValue = numberFromAlpaca(alpacaData?.account.portfolio_value) || numberFromAlpaca(alpacaData?.account.equity) || currentCash + holdingsValue;
  const buyingPower = numberFromAlpaca(alpacaData?.account.buying_power);
  const orders = alpacaData?.orders ?? [];
  const activities = alpacaData?.activities ?? [];
  const portfolioProfitLossPeriods = useMemo(
    () => buildPortfolioProfitLossPeriods(stocks, alpacaData?.positions ?? [], orders, activities, alpacaData?.account ?? null),
    [activities, alpacaData, orders, stocks],
  );
  const credentialsConfigured = Boolean(getAlpacaCredentials());
  const recommendedTrades = useMemo(
    () => buildRecommendedPortfolioTrades(stocks, recommendations, holdings, currentCash, recommendedTradeCount),
    [currentCash, holdings, recommendations, recommendedTradeCount, stocks],
  );
  const recommendedTradesTotal = recommendedTrades.reduce((sum, trade) => sum + trade.estimatedCost, 0);
  const detailStock = stockDetailSymbol ? stocks.find((stock) => stock.symbol === stockDetailSymbol) : null;
  const detailStockWithLookback = detailStock
    ? { ...detailStock, ...classifyMarketState(detailStock.candles, DEFAULT_STATE_LOOKBACK) }
    : null;
  const detailRecommendations = detailStock ? windowedRecommendations[detailStock.symbol] : undefined;
  const detailAggregation = autoChartAggregation(stockDetailVisibleTimeframe);

  useEffect(() => {
    localStorage.removeItem("portfolio_transactions");
    localStorage.removeItem("portfolio_starting_cash");
  }, []);

  function refreshAlpacaPortfolio() {
    if (!getAlpacaCredentials()) {
      setAlpacaData(null);
      setAlpacaError("Configure Alpaca API key and secret in Settings to load live portfolio data.");
      return Promise.resolve();
    }
    setAlpacaLoading(true);
    setAlpacaError("");
    return loadAlpacaPortfolio()
      .then((nextPortfolio) => {
        setAlpacaData(nextPortfolio);
      })
      .catch((loadError: Error) => {
        setAlpacaData(null);
        setAlpacaError(loadError.message);
      })
      .finally(() => {
        setAlpacaLoading(false);
      });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadMarketDataset(), loadVolumeStateRiskSignals()])
      .then(([nextDataset, nextVolumeSignals]) => {
        if (cancelled) {
          return;
        }
        setDataset(nextDataset);
        setVolumeSignals(nextVolumeSignals);
        const defaultStock = nextDataset.symbols.find((stock) => stock.symbol === transactionSymbol) ?? nextDataset.symbols[0];
        setTransactionSymbol(defaultStock?.symbol ?? "");
        setSelectedPortfolioSymbol(defaultStock?.symbol ?? "");
        setTransactionPrice(defaultStock ? latestClose(defaultStock) : 0);
        refreshAlpacaPortfolio();
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<AlpacaSyncSummary>).detail;
      if (detail?.portfolio) {
        setAlpacaData(detail.portfolio);
        setAlpacaError("");
        return;
      }
      if (detail?.error) {
        setAlpacaError(detail.error);
        return;
      }
      if (getAlpacaCredentials()) {
        void refreshAlpacaPortfolio();
      }
    };
    window.addEventListener("alpaca-data-synced", listener);
    return () => window.removeEventListener("alpaca-data-synced", listener);
  }, []);

  useEffect(() => {
    const stock = stocks.find((item) => item.symbol === transactionSymbol);
    if (stock && !transactionPrice) {
      setTransactionPrice(Number(latestClose(stock).toFixed(2)));
    }
  }, [stocks, transactionPrice, transactionSymbol]);

  function buildOrderRequest(): AlpacaOrderRequest {
    const symbol = transactionSymbol.trim();
    const wholeShares = Math.floor(transactionShares);
    if (!symbol) {
      throw new Error("Select a symbol first.");
    }
    if (transactionSizingMode === "qty" && wholeShares < 1) {
      throw new Error("Share quantity must be at least 1.");
    }
    if (transactionSizingMode === "notional" && transactionNotional <= 0) {
      throw new Error("Notional amount must be greater than zero.");
    }
    const order: AlpacaOrderRequest = {
      symbol,
      side: transactionType,
      type: transactionOrderType,
      time_in_force: transactionTimeInForce,
    };
    if (transactionSizingMode === "qty") {
      order.qty = String(wholeShares);
    } else {
      order.notional = String(transactionNotional);
    }
    if (transactionLimitPrice.trim()) {
      order.limit_price = transactionLimitPrice.trim();
    }
    if (transactionStopPrice.trim()) {
      order.stop_price = transactionStopPrice.trim();
    }
    if (transactionOrderType === "trailing_stop") {
      if (transactionTrailMode === "price" && transactionTrailPrice.trim()) {
        order.trail_price = transactionTrailPrice.trim();
      }
      if (transactionTrailMode === "percent" && transactionTrailPercent.trim()) {
        order.trail_percent = transactionTrailPercent.trim();
      }
    }
    if (transactionExtendedHours) {
      order.extended_hours = true;
    }
    if (transactionClientOrderId.trim()) {
      order.client_order_id = transactionClientOrderId.trim();
    }
    if (transactionOrderClass !== "simple") {
      order.order_class = transactionOrderClass;
    }
    if (transactionTakeProfitLimitPrice.trim()) {
      order.take_profit = { limit_price: transactionTakeProfitLimitPrice.trim() };
    }
    if (transactionStopLossStopPrice.trim()) {
      order.stop_loss = { stop_price: transactionStopLossStopPrice.trim() };
      if (transactionStopLossLimitPrice.trim()) {
        order.stop_loss.limit_price = transactionStopLossLimitPrice.trim();
      }
    }
    if (transactionPositionIntent) {
      order.position_intent = transactionPositionIntent;
    }
    const legs = parseOptionalJsonArray(transactionLegsJson, "Legs");
    if (legs) {
      order.legs = legs;
    }
    const advancedInstructions = parseOptionalJsonObject(transactionAdvancedInstructionsJson, "Advanced instructions");
    if (advancedInstructions) {
      order.advanced_instructions = advancedInstructions;
    }
    return order;
  }

  async function submitOrder() {
    setOrderSubmitting(true);
    setAlpacaError("");
    try {
      await submitAlpacaOrder(buildOrderRequest());
      setSelectedPortfolioSymbol(transactionSymbol);
      setTradeDialogOpen(false);
      await refreshAlpacaPortfolio();
    } catch (submitError) {
      setAlpacaError(submitError instanceof Error ? submitError.message : "Alpaca order failed.");
    } finally {
      setOrderSubmitting(false);
    }
  }

  async function submitRecommendedOrders() {
    if (!recommendedTrades.length || !credentialsConfigured) {
      return;
    }
    setBulkOrderSubmitting(true);
    setAlpacaError("");
    const failedOrders: string[] = [];
    let placedCount = 0;
    try {
      for (const trade of recommendedTrades) {
        try {
          await submitAlpacaMarketOrder(trade.symbol, "buy", trade.shares);
          placedCount += 1;
        } catch (submitError) {
          const reason = submitError instanceof Error ? submitError.message : "unknown error";
          failedOrders.push(`${trade.symbol}: ${reason}`);
        }
      }
      setSelectedPortfolioSymbol(recommendedTrades[0]?.symbol ?? selectedPortfolioSymbol);
      setBulkOrderDialogOpen(false);
      await refreshAlpacaPortfolio();
      if (failedOrders.length) {
        setAlpacaError(`Placed ${placedCount} of ${recommendedTrades.length} orders. Failed: ${failedOrders.join("; ")}`);
      }
    } finally {
      setBulkOrderSubmitting(false);
    }
  }

  function openRecommendedTrade(trade: RecommendedPortfolioTrade) {
    setTransactionType("buy");
    setTransactionSymbol(trade.symbol);
    setTransactionSizingMode("qty");
    setTransactionShares(trade.shares);
    setTransactionOrderType("market");
    setTransactionTimeInForce("day");
    setTransactionOrderClass("simple");
    setTransactionPrice(Number(trade.price.toFixed(2)));
    setSelectedPortfolioSymbol(trade.symbol);
    setTradeDialogOpen(true);
  }

  if (error) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Portfolio unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!dataset) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Loading portfolio</h1>
          <p>Reading cached market prices and Alpaca portfolio data.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Portfolio</h1>
          <p>Live Alpaca account, positions, orders, and portfolio value through time.</p>
        </div>
      </header>

      {alpacaError && (
        <section className="alpaca-status-panel" aria-label="Alpaca portfolio status">
          <strong>Alpaca portfolio not connected</strong>
          <span>{alpacaError}</span>
        </section>
      )}

      <section className="metrics-grid">
        <Metric label="Total value" value={currency.format(totalValue)} tone={totalValue >= holdingsValue ? "good" : "warn"} />
        <Metric label="Holdings value" value={currency.format(holdingsValue)} />
        <Metric label="Cash" value={currency.format(currentCash)} tone={currentCash >= 0 ? "good" : "warn"} />
        <Metric label="Open holdings" value={`${holdings.length}`} />
      </section>

      <PortfolioProfitLossStrip periods={portfolioProfitLossPeriods} />

      <nav className="portfolio-subnav" aria-label="Portfolio sections">
        {[
          ["overview", "Overview"],
          ["orders", "Orders"],
          ["activities", "Activities"],
          ["balances", "Balances"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={portfolioView === id ? "active" : ""}
            onClick={() => setPortfolioView(id as PortfolioView)}
          >
            {label}
          </button>
        ))}
      </nav>

      {portfolioView === "overview" && (
        <>
      <section className="portfolio-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Cash</h2>
            <Wallet size={18} />
          </div>
          <div className="portfolio-account-grid">
            <span>
              <b>{currency.format(currentCash)}</b>
              cash
            </span>
            <span>
              <b>{currency.format(buyingPower)}</b>
              buying power
            </span>
            <span>
              <b>{alpacaData?.account.status ?? "--"}</b>
              account status
            </span>
          </div>
          <p className="portfolio-cash-note">
            Values are loaded from Alpaca Trading API, not the browser portfolio cache.
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Trades</h2>
            <SlidersHorizontal size={18} />
          </div>
          <div className="trade-action-card">
            <div>
              <strong>{orders.length} Alpaca orders</strong>
              <span>Place buy or sell market orders through the connected Alpaca account.</span>
            </div>
            <button className="primary-action compact" onClick={() => setTradeDialogOpen(true)} disabled={!credentialsConfigured}>
              + Place order
            </button>
          </div>
        </div>
      </section>

      {tradeDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setTradeDialogOpen(false)}>
          <section className="trade-dialog" role="dialog" aria-modal="true" aria-label="Place Alpaca order" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <h2>Place Alpaca market order</h2>
              <button className="icon-button" onClick={() => setTradeDialogOpen(false)} aria-label="Close order dialog">X</button>
            </div>
            <div className="transaction-form order-form-grid">
              <label>
                Side
                <select value={transactionType} onChange={(event) => setTransactionType(event.target.value as "buy" | "sell")}>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </label>
              <label>
                Symbol
                <select
                  value={transactionSymbol}
                  onChange={(event) => {
                    const symbol = event.target.value;
                    setTransactionSymbol(symbol);
                    const stock = stocks.find((item) => item.symbol === symbol);
                    setTransactionPrice(stock ? Number(latestClose(stock).toFixed(2)) : 0);
                  }}
                >
                  {stocks.map((stock) => (
                    <option key={stock.symbol} value={stock.symbol}>{stock.symbol} · {stock.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Order type
                <select value={transactionOrderType} onChange={(event) => setTransactionOrderType(event.target.value as AlpacaOrderRequest["type"])}>
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                  <option value="stop">Stop</option>
                  <option value="stop_limit">Stop limit</option>
                  <option value="trailing_stop">Trailing stop</option>
                </select>
              </label>
              <label>
                Time in force
                <select value={transactionTimeInForce} onChange={(event) => setTransactionTimeInForce(event.target.value as AlpacaOrderRequest["time_in_force"])}>
                  <option value="day">Day</option>
                  <option value="gtc">Good until canceled</option>
                  <option value="opg">Market/limit on open</option>
                  <option value="cls">Market/limit on close</option>
                  <option value="ioc">Immediate or cancel</option>
                  <option value="fok">Fill or kill</option>
                </select>
              </label>
              <label>
                Size type
                <select value={transactionSizingMode} onChange={(event) => setTransactionSizingMode(event.target.value as "qty" | "notional")}>
                  <option value="qty">Shares</option>
                  <option value="notional">Notional</option>
                </select>
              </label>
              <label>
                Shares
                <input
                  min={1}
                  step="1"
                  type="number"
                  value={transactionShares}
                  disabled={transactionSizingMode !== "qty"}
                  onChange={(event) => setTransactionShares(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                />
              </label>
              <label>
                Notional
                <input
                  min={0}
                  step="1"
                  type="number"
                  value={transactionNotional}
                  disabled={transactionSizingMode !== "notional"}
                  onChange={(event) => setTransactionNotional(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
              <label>
                Reference price
                <input min={0} step="0.01" type="number" value={transactionPrice} disabled />
              </label>
              <label>
                Limit price
                <input min={0} step="0.01" type="number" value={transactionLimitPrice} onChange={(event) => setTransactionLimitPrice(event.target.value)} />
              </label>
              <label>
                Stop price
                <input min={0} step="0.01" type="number" value={transactionStopPrice} onChange={(event) => setTransactionStopPrice(event.target.value)} />
              </label>
              <label>
                Trail type
                <select value={transactionTrailMode} onChange={(event) => setTransactionTrailMode(event.target.value as "price" | "percent")} disabled={transactionOrderType !== "trailing_stop"}>
                  <option value="price">Trail price</option>
                  <option value="percent">Trail percent</option>
                </select>
              </label>
              <label>
                Trail price
                <input min={0} step="0.01" type="number" value={transactionTrailPrice} disabled={transactionOrderType !== "trailing_stop" || transactionTrailMode !== "price"} onChange={(event) => setTransactionTrailPrice(event.target.value)} />
              </label>
              <label>
                Trail percent
                <input min={0} step="0.01" type="number" value={transactionTrailPercent} disabled={transactionOrderType !== "trailing_stop" || transactionTrailMode !== "percent"} onChange={(event) => setTransactionTrailPercent(event.target.value)} />
              </label>
              <label>
                Order class
                <select value={transactionOrderClass} onChange={(event) => setTransactionOrderClass(event.target.value as NonNullable<AlpacaOrderRequest["order_class"]>)}>
                  <option value="simple">Simple</option>
                  <option value="bracket">Bracket</option>
                  <option value="oco">OCO</option>
                  <option value="oto">OTO</option>
                  <option value="mleg">Multi-leg options</option>
                </select>
              </label>
              <label>
                Client order ID
                <input value={transactionClientOrderId} onChange={(event) => setTransactionClientOrderId(event.target.value)} placeholder="optional custom id" />
              </label>
              <label>
                Position intent
                <select value={transactionPositionIntent} onChange={(event) => setTransactionPositionIntent(event.target.value as "" | NonNullable<AlpacaOrderRequest["position_intent"]>)}>
                  <option value="">None</option>
                  <option value="buy_to_open">Buy to open</option>
                  <option value="buy_to_close">Buy to close</option>
                  <option value="sell_to_open">Sell to open</option>
                  <option value="sell_to_close">Sell to close</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={transactionExtendedHours} onChange={(event) => setTransactionExtendedHours(event.target.checked)} />
                <span>Extended hours</span>
              </label>
            </div>
            <div className="order-form-section">
              <h3>Advanced order legs</h3>
              <div className="transaction-form order-form-grid">
                <label>
                  Take profit limit
                  <input min={0} step="0.01" type="number" value={transactionTakeProfitLimitPrice} onChange={(event) => setTransactionTakeProfitLimitPrice(event.target.value)} />
                </label>
                <label>
                  Stop loss stop
                  <input min={0} step="0.01" type="number" value={transactionStopLossStopPrice} onChange={(event) => setTransactionStopLossStopPrice(event.target.value)} />
                </label>
                <label>
                  Stop loss limit
                  <input min={0} step="0.01" type="number" value={transactionStopLossLimitPrice} onChange={(event) => setTransactionStopLossLimitPrice(event.target.value)} />
                </label>
              </div>
            </div>
            <div className="order-form-section">
              <h3>Raw API extensions</h3>
              <div className="transaction-form order-json-grid">
                <label>
                  Multi-leg options legs JSON
                  <textarea value={transactionLegsJson} onChange={(event) => setTransactionLegsJson(event.target.value)} placeholder='[{"symbol":"AAPL260117C00200000","ratio_qty":"1","side":"buy","position_intent":"buy_to_open"}]' />
                </label>
                <label>
                  Advanced instructions JSON
                  <textarea value={transactionAdvancedInstructionsJson} onChange={(event) => setTransactionAdvancedInstructionsJson(event.target.value)} placeholder='{"strategy":"vwap"}' />
                </label>
              </div>
            </div>
            <p className="portfolio-cash-note">
              Alpaca validates combinations by asset type. For example, extended hours requires a limit order with day or GTC, and bracket/OCO/OTO orders use take-profit and stop-loss fields.
            </p>
            <div className="dialog-actions">
              <button className="text-button" onClick={() => setTradeDialogOpen(false)}>Cancel</button>
              <button className="primary-action compact" onClick={submitOrder} disabled={orderSubmitting || !credentialsConfigured}>
                {orderSubmitting ? "Submitting" : "Submit order"}
              </button>
            </div>
          </section>
        </div>
      )}

      {detailStockWithLookback && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setStockDetailSymbol(null)}>
          <section
            className="trade-dialog stock-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${detailStockWithLookback.symbol} stock detail`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-head">
              <div>
                <span className="eyebrow">{detailStockWithLookback.sector}</span>
                <h2>{detailStockWithLookback.symbol} · {detailStockWithLookback.name} · {currency.format(detailStockWithLookback.price)}</h2>
                <div className="state-row">
                  <span className={`state-pill ${stateClass(detailStockWithLookback.marketState)}`}>{detailStockWithLookback.marketState}</span>
                  <RecommendationStrip recommendations={detailRecommendations} />
                  <span>{detailStockWithLookback.trendReturn >= 0 ? "+" : ""}{detailStockWithLookback.trendReturn.toFixed(2)}% over {DEFAULT_STATE_LOOKBACK} trading days</span>
                  <span>showing {visibleTimeframeLabel(stockDetailVisibleTimeframe)}</span>
                  <span>auto points {chartAggregationLabel(detailAggregation)}</span>
                  <span className={`risk ${riskClass(detailStockWithLookback.risk)}`}>{detailStockWithLookback.risk} risk</span>
                </div>
              </div>
              <button className="icon-button" onClick={() => setStockDetailSymbol(null)} aria-label="Close stock detail dialog">X</button>
            </div>
            <div className="stock-detail-controls">
              <VisibleTimeframeControl value={stockDetailVisibleTimeframe} onChange={setStockDetailVisibleTimeframe} />
            </div>
            <div className="chart-legends">
              <StateLegend />
              <RiskLegend />
              <GapLegend />
            </div>
            <div className="stock-detail-toolbar">
              <ChartToolbar mode={stockDetailMode} setMode={setStockDetailMode} />
            </div>
            <StockChart
              stock={detailStockWithLookback}
              mode={stockDetailMode}
              lookbackDays={DEFAULT_STATE_LOOKBACK}
              visibleTimeframe={stockDetailVisibleTimeframe}
              volumeSignals={volumeSignals}
            />
            <TechnicalSignalsPanel stock={detailStockWithLookback} signalCache={technicalSignals} signalWeights={signalWeights} />
          </section>
        </div>
      )}

      <section className="portfolio-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Portfolio value</h2>
            <span className="table-sort-summary">cash + open holdings</span>
          </div>
          <ResponsiveContainer width="100%" height={270}>
            <LineChart data={portfolioSeries}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={54} />
              <Tooltip formatter={(value) => currency.format(Number(value))} />
              <Line type="monotone" dataKey="total" stroke="#177e89" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="holdings" stroke="#6d5bd0" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="cash" stroke="#5d6470" strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>{selectedSymbol}{selectedPortfolioStock ? ` · ${selectedPortfolioStock.name}` : ""} value in portfolio</h2>
            <span className="table-sort-summary">click a holding below</span>
          </div>
          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={portfolioSeries}>
              <defs>
                <linearGradient id="holdingValueFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#177e89" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#177e89" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={54} />
              <Tooltip formatter={(value) => currency.format(Number(value))} />
              <Area type="monotone" dataKey="selected" stroke="#177e89" strokeWidth={2.4} fill="url(#holdingValueFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Current holdings</h2>
          <span className="table-sort-summary">state, risk, holding time · recommendations show 1/7/14/21/60d</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Detail</th>
                <th>Shares</th>
                <th>Market value</th>
                <th>Avg cost</th>
                <th>P/L</th>
                <th>Holding</th>
                <th>State</th>
                <th>Risk</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {!holdings.length && (
                <tr>
                  <td colSpan={10} className="empty-table-cell">
                    {credentialsConfigured ? "No open Alpaca positions returned." : "Connect Alpaca in Settings to load current holdings."}
                  </td>
                </tr>
              )}
              {holdings.map((holding) => (
                <tr
                  key={holding.symbol}
                  className={selectedSymbol === holding.symbol ? "selected-row" : ""}
                  onClick={() => setSelectedPortfolioSymbol(holding.symbol)}
                >
                  <td>
                    <span className="symbol-with-name">
                      <strong>{holding.symbol}</strong>
                      <small>{holding.stock.name}</small>
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-button detail-stock-button"
                      title={`Open ${holding.symbol} stock detail`}
                      aria-label={`Open ${holding.symbol} stock detail`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setStockDetailSymbol(holding.symbol);
                      }}
                    >
                      <LineChartIcon size={16} />
                    </button>
                  </td>
                  <td>{holding.shares.toFixed(4)}</td>
                  <td>{currency.format(holding.marketValue)}</td>
                  <td>{currency.format(holding.averageCost)}</td>
                  <td className={holding.profitLoss >= 0 ? "positive" : "negative"}>
                    {currency.format(holding.profitLoss)}
                  </td>
                  <td>{holding.holdingDays} days</td>
                  <td><span className={`state-pill ${stateClass(holding.stock.marketState)}`}>{holding.stock.marketState}</span></td>
                  <td><span className={`risk ${riskClass(holding.stock.risk)}`}>{holding.stock.risk}</span></td>
                  <td>
                    <RecommendationStrip recommendations={windowedRecommendations[holding.symbol]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel recommended-trades-panel">
        <div className="panel-head">
          <div>
            <h2>Recommended trades</h2>
            <span className="table-sort-summary">
              buy suggestions from {currency.format(Math.max(0, currentCash))} free cash · ranked by 21d, showing 1/7/14/21/60d
            </span>
          </div>
          <div className="recommended-trades-controls">
            <label>
              Trades
              <select value={recommendedTradeCount} onChange={(event) => setRecommendedTradeCount(Number(event.target.value))}>
                {Array.from({ length: 20 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-action compact"
              onClick={() => setBulkOrderDialogOpen(true)}
              disabled={!credentialsConfigured || !recommendedTrades.length || bulkOrderSubmitting}
            >
              <ShoppingCart size={16} />
              Place all orders
            </button>
          </div>
        </div>
        {recommendedTrades.length > 0 && (
          <div className="recommended-trades-summary">
            <span>
              Showing {recommendedTrades.length} of {recommendedTradeCount} requested trade{recommendedTradeCount === 1 ? "" : "s"}.
            </span>
            <span>
              Budget is split across the {recommendedTrades.length} available candidate{recommendedTrades.length === 1 ? "" : "s"}.
            </span>
          </div>
        )}
        {recommendedTrades.length ? (
          <div className="recommended-trades-grid">
            {recommendedTrades.map((trade) => (
              <article key={trade.symbol} className="recommended-trade">
                <div className="recommended-trade-head">
                  <div>
                    <strong>{trade.symbol}</strong>
                    <span>{trade.stock.name}</span>
                    <small>{trade.stock.sector}</small>
                  </div>
                  <span className={`recommendation ${recommendationClass(trade.recommendation.action)}`}>
                    {trade.recommendation.action}
                  </span>
                </div>
                <RecommendationStrip recommendations={windowedRecommendations[trade.symbol]} />
                <div className="recommended-trade-metrics">
                  <span>
                    <b>{trade.shares}</b>
                    shares
                  </span>
                  <span>
                    <b>{currency.format(trade.estimatedCost)}</b>
                    est. cost
                  </span>
                  <span>
                    <b>{Math.round(trade.allocationWeight * 100)}%</b>
                    cash split
                  </span>
                </div>
                <div className="recommended-trade-state">
                  <span className={`state-pill ${stateClass(trade.stock.marketState)}`}>{trade.stock.marketState}</span>
                  <span className={`risk ${riskClass(trade.stock.risk)}`}>{trade.stock.risk} risk</span>
                  <span>{trade.recommendation.confidence}% confidence</span>
                </div>
                <div className="recommended-trade-footer">
                  <span>{trade.recommendation.reason} · {currency.format(trade.price)} latest close</span>
                  <div className="recommended-trade-actions">
                    <button
                      className="icon-button detail-stock-button"
                      title={`Open ${trade.symbol} stock detail`}
                      aria-label={`Open ${trade.symbol} stock detail`}
                      onClick={() => setStockDetailSymbol(trade.symbol)}
                    >
                      <LineChartIcon size={16} />
                    </button>
                    <button className="text-button" onClick={() => openRecommendedTrade(trade)}>Use trade</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-recommendations">
            <strong>{currentCash > 0 ? "No qualifying buy candidates right now" : "No free cash to allocate"}</strong>
            <span>
              {currentCash > 0
                ? "Trend, risk, and recommendation filters do not currently produce a clean buy candidate."
                : "Alpaca cash is unavailable or there is no free cash to allocate."}
            </span>
          </div>
        )}
      </section>

      {bulkOrderDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setBulkOrderDialogOpen(false)}>
          <section className="trade-dialog" role="dialog" aria-modal="true" aria-label="Place all recommended orders" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head">
              <div>
                <h2>Place all recommended orders</h2>
                <span className="table-sort-summary">
                  {recommendedTrades.length} market buy orders · estimated {currency.format(recommendedTradesTotal)}
                </span>
              </div>
              <button className="icon-button" onClick={() => setBulkOrderDialogOpen(false)} aria-label="Close bulk order dialog">X</button>
            </div>
            <p className="portfolio-cash-note">
              This will submit separate day market buy orders to Alpaca. Final fills can differ from latest cached prices.
            </p>
            <div className="table-wrap bulk-order-review">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Shares</th>
                    <th>Reference price</th>
                    <th>Estimated cost</th>
                    <th>Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendedTrades.map((trade) => (
                    <tr key={trade.symbol}>
                      <td>
                        <span className="symbol-with-name">
                          <strong>{trade.symbol}</strong>
                          <small>{trade.stock.name}</small>
                        </span>
                      </td>
                      <td>{trade.shares}</td>
                      <td>{currency.format(trade.price)}</td>
                      <td>{currency.format(trade.estimatedCost)}</td>
                      <td>
                        <span className={`recommendation ${recommendationClass(trade.recommendation.action)}`}>
                          {trade.recommendation.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bulk-order-total">
              <strong>Total estimated order value</strong>
              <span>{currency.format(recommendedTradesTotal)}</span>
            </div>
            <div className="dialog-actions">
              <button className="text-button" onClick={() => setBulkOrderDialogOpen(false)} disabled={bulkOrderSubmitting}>Cancel</button>
              <button className="primary-action compact" onClick={submitRecommendedOrders} disabled={bulkOrderSubmitting || !credentialsConfigured || !recommendedTrades.length}>
                {bulkOrderSubmitting ? "Submitting orders" : "Submit all orders"}
              </button>
            </div>
          </section>
        </div>
      )}

        </>
      )}

      {portfolioView === "orders" && <AlpacaOrdersView orders={orders} stocks={stocks} credentialsConfigured={credentialsConfigured} />}
      {portfolioView === "activities" && <AlpacaActivitiesView activities={activities} credentialsConfigured={credentialsConfigured} />}
      {portfolioView === "balances" && (
        <AlpacaBalancesView
          account={alpacaData?.account ?? null}
          positions={alpacaData?.positions ?? []}
          history={alpacaData?.history ?? null}
          credentialsConfigured={credentialsConfigured}
        />
      )}
    </main>
  );
}

function StrategiesScreen() {
  const [dataset, setDataset] = useState<MarketDataset | null>(null);
  const [volumeSignals, setVolumeSignals] = useState<VolumeStateRiskSignal[]>([]);
  const [error, setError] = useState("");
  const [strategies, setStrategies] = useState<TradingStrategy[]>(() => loadStrategies());
  const [selectedStrategyId, setSelectedStrategyId] = useState(() => loadStrategies()[0]?.id ?? "default-balanced");
  const [backtestWindow, setBacktestWindow] = useState(90);
  const [strategyUniverse, setStrategyUniverse] = useState<StrategyUniverseMode>(
    () => (localStorage.getItem("strategy_universe_mode") as StrategyUniverseMode | null) ?? "all",
  );
  const [newStrategyName, setNewStrategyName] = useState("");
  const [appliedStrategy, setAppliedStrategy] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadMarketDataset(), loadVolumeStateRiskSignals()])
      .then(([nextDataset, nextVolumeSignals]) => {
        if (cancelled) {
          return;
        }
        setDataset(nextDataset);
        setVolumeSignals(nextVolumeSignals);
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveStrategies(strategies);
    if (!strategies.some((strategy) => strategy.id === selectedStrategyId)) {
      setSelectedStrategyId(strategies[0]?.id ?? "");
    }
  }, [selectedStrategyId, strategies]);

  const stocks = useMemo(() => applyStateLookback(dataset?.symbols ?? [], DEFAULT_STATE_LOOKBACK), [dataset]);
  const simulationStocks = useMemo(() => strategyUniverseStocks(stocks, strategyUniverse), [stocks, strategyUniverse]);
  const technicalSignals = useMemo(() => (dataset ? buildCachedTechnicalSignals(dataset) : null), [dataset]);
  const results = useMemo(
    () =>
      strategies.map((strategy) =>
        simulateStrategy(strategy, simulationStocks, volumeSignals, technicalSignals, backtestWindow),
      ),
    [backtestWindow, simulationStocks, strategies, technicalSignals, volumeSignals],
  );
  const sortedResults = useMemo(
    () => [...results].sort((left, right) => right.alphaPct - left.alphaPct || right.returnPct - left.returnPct),
    [results],
  );
  const selectedStrategy = strategies.find((strategy) => strategy.id === selectedStrategyId) ?? strategies[0];
  const selectedResult = results.find((result) => result.strategyId === selectedStrategy?.id) ?? results[0];
  const winningResult = sortedResults[0];
  const comparisonResults = sortedResults.slice(0, 5);
  const comparisonRows = useMemo(() => {
    const source = comparisonResults[0]?.points ?? [];
    return source.map((point, index) => {
      const row: Record<string, string | number> = { date: point.date, SPY: point.spy };
      comparisonResults.forEach((result) => {
        row[result.strategyId] = result.points[index]?.value ?? 0;
      });
      return row;
    });
  }, [comparisonResults]);
  const chartColors = ["#177e89", "#6d5bd0", "#c88a00", "#c2414b", "#5d6470"];

  useEffect(() => {
    if (!["all", "top10-volume", "top20-volume"].includes(strategyUniverse)) {
      setStrategyUniverse("all");
      return;
    }
    localStorage.setItem("strategy_universe_mode", strategyUniverse);
  }, [strategyUniverse]);

  function updateStrategyWeights(key: TechnicalSignalKey, value: number) {
    if (!selectedStrategy) {
      return;
    }
    const now = new Date().toISOString();
    setStrategies((current) =>
      current.map((strategy) =>
        strategy.id === selectedStrategy.id
          ? {
              ...strategy,
              weights: { ...strategy.weights, [key]: Number.isFinite(value) ? value : 0 },
              updatedAt: now,
            }
          : strategy,
      ),
    );
  }

  function addStrategyFromActiveWeights() {
    const now = new Date().toISOString();
    const name = newStrategyName.trim() || `Custom strategy ${strategies.length + 1}`;
    const strategy: TradingStrategy = {
      id: `custom-${Date.now()}`,
      name,
      description: "Custom strategy created from the currently active Settings weights.",
      weights: loadSignalWeights(),
      createdAt: now,
      updatedAt: now,
    };
    setStrategies((current) => [...current, strategy]);
    setSelectedStrategyId(strategy.id);
    setNewStrategyName("");
  }

  function duplicateSelectedStrategy() {
    if (!selectedStrategy) {
      return;
    }
    const now = new Date().toISOString();
    const copy: TradingStrategy = {
      ...selectedStrategy,
      id: `custom-${Date.now()}`,
      name: `${selectedStrategy.name} copy`,
      description: `Editable copy of ${selectedStrategy.name}.`,
      weights: normalizeSignalWeights(selectedStrategy.weights),
      createdAt: now,
      updatedAt: now,
    };
    setStrategies((current) => [...current, copy]);
    setSelectedStrategyId(copy.id);
  }

  function deleteSelectedStrategy() {
    if (!selectedStrategy || strategies.length <= 1) {
      return;
    }
    setStrategies((current) => current.filter((strategy) => strategy.id !== selectedStrategy.id));
  }

  function resetStrategyLibrary() {
    const nextStrategies = starterStrategies();
    setStrategies(nextStrategies);
    setSelectedStrategyId(nextStrategies[0]?.id ?? "");
  }

  function applySelectedStrategy() {
    if (!selectedStrategy) {
      return;
    }
    saveSignalWeights(selectedStrategy.weights);
    setAppliedStrategy(selectedStrategy.name);
    window.setTimeout(() => setAppliedStrategy(""), 2400);
  }

  if (error) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Strategy lab unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!dataset || !selectedStrategy || !selectedResult) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>Loading strategies</h1>
          <p>Reading cached market prices and preparing strategy simulations.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page strategies-page">
      <header className="page-header">
        <div>
          <h1>Strategies</h1>
          <p>
            Compare signal-weight combinations against cached symbols · decisions use prior-day data and trade the next open.
          </p>
        </div>
        <div className="strategy-header-controls">
          <label className="compact-select">
            Universe
            <select value={strategyUniverse} onChange={(event) => setStrategyUniverse(event.target.value as StrategyUniverseMode)}>
              <option value="all">All cached symbols</option>
              <option value="top10-volume">Top 10 by volume</option>
              <option value="top20-volume">Top 20 by volume</option>
            </select>
          </label>
          <label className="compact-select">
            Window
            <select value={backtestWindow} onChange={(event) => setBacktestWindow(Number(event.target.value))}>
              {[30, 60, 90, 180, 365].map((days) => (
                <option key={days} value={days}>Last {days} days</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="metrics-grid">
        <Metric label="Best strategy" value={winningResult?.name ?? "--"} tone={(winningResult?.alphaPct ?? 0) >= 0 ? "good" : "warn"} />
        <Metric label="Best return" value={`${winningResult?.returnPct.toFixed(2) ?? "0.00"}%`} tone={(winningResult?.returnPct ?? 0) >= 0 ? "good" : "warn"} />
        <Metric label="Best alpha vs SPY" value={`${winningResult?.alphaPct >= 0 ? "+" : ""}${winningResult?.alphaPct.toFixed(2) ?? "0.00"}%`} tone={(winningResult?.alphaPct ?? 0) >= 0 ? "good" : "warn"} />
        <Metric
          label="Simulated universe"
          value={`${strategyUniverseLabel(strategyUniverse)} · ${simulationStocks.filter((stock) => stock.symbol !== "SPY").length}`}
        />
      </section>

      <section className="strategy-layout">
        <div className="panel strategy-list-panel">
          <div className="panel-head">
            <div>
              <h2>Strategy library</h2>
              <span className="table-sort-summary">each strategy is a full signal-weight profile</span>
            </div>
          </div>
          <div className="strategy-create-row">
            <input value={newStrategyName} onChange={(event) => setNewStrategyName(event.target.value)} placeholder="New strategy name" />
            <button className="primary-action compact" onClick={addStrategyFromActiveWeights}>+ Add</button>
          </div>
          <div className="strategy-list">
            {strategies.map((strategy) => {
              const result = results.find((item) => item.strategyId === strategy.id);
              return (
                <button
                  key={strategy.id}
                  className={strategy.id === selectedStrategy.id ? "strategy-list-item active" : "strategy-list-item"}
                  onClick={() => setSelectedStrategyId(strategy.id)}
                >
                  <span>
                    <strong>{strategy.name}</strong>
                    <small>{strategy.description}</small>
                  </span>
                  <b className={(result?.alphaPct ?? 0) >= 0 ? "positive" : "negative"}>
                    {result ? `${result.alphaPct >= 0 ? "+" : ""}${result.alphaPct.toFixed(2)}% alpha` : "--"}
                  </b>
                </button>
              );
            })}
          </div>
          <div className="strategy-actions">
            <button className="text-button" onClick={duplicateSelectedStrategy}>Duplicate</button>
            <button className="text-button" onClick={deleteSelectedStrategy} disabled={strategies.length <= 1}>Delete</button>
            <button className="text-button" onClick={resetStrategyLibrary}>Reset starters</button>
          </div>
        </div>

        <div className="panel strategy-results-panel">
          <div className="panel-head">
            <div>
              <h2>Strategy comparison</h2>
              <span className="table-sort-summary">top 5 by alpha vs SPY over selected window · {strategyUniverseLabel(strategyUniverse)}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={comparisonRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={54} />
              <Tooltip formatter={(value) => currency.format(Number(value))} />
              <Line type="monotone" dataKey="SPY" stroke="#20242b" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
              {comparisonResults.map((result, index) => (
                <Line
                  key={result.strategyId}
                  type="monotone"
                  dataKey={result.strategyId}
                  name={result.name}
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={2.4}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="table-wrap strategy-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Return</th>
                  <th>SPY</th>
                  <th>Alpha</th>
                  <th>Max drawdown</th>
                  <th>Win rate</th>
                  <th>Trades</th>
                  <th>Open positions</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((result) => (
                  <tr
                    key={result.strategyId}
                    className={result.strategyId === selectedStrategy.id ? "selected-row" : ""}
                    onClick={() => setSelectedStrategyId(result.strategyId)}
                  >
                    <td><strong>{result.name}</strong></td>
                    <td className={result.returnPct >= 0 ? "positive" : "negative"}>{result.returnPct >= 0 ? "+" : ""}{result.returnPct.toFixed(2)}%</td>
                    <td className={result.spyReturnPct >= 0 ? "positive" : "negative"}>{result.spyReturnPct >= 0 ? "+" : ""}{result.spyReturnPct.toFixed(2)}%</td>
                    <td className={result.alphaPct >= 0 ? "positive" : "negative"}>{result.alphaPct >= 0 ? "+" : ""}{result.alphaPct.toFixed(2)}%</td>
                    <td>{result.maxDrawdownPct.toFixed(2)}%</td>
                    <td>{result.winRate}%</td>
                    <td>{result.trades} <small>({result.buys} buy / {result.sells} sell)</small></td>
                    <td>{result.openPositions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="strategy-layout strategy-detail-layout">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{selectedStrategy.name}</h2>
              <span className="table-sort-summary">{selectedStrategy.description}</span>
            </div>
            <button className="primary-action compact" onClick={applySelectedStrategy}>
              <Save size={18} />
              Use in settings
            </button>
          </div>
          {appliedStrategy && <p className="saved-state">{appliedStrategy} is now the active recommendation strategy.</p>}
          <div className="strategy-result-cards">
            <Metric label="Ending value" value={currency.format(selectedResult.endingValue)} tone={selectedResult.returnPct >= 0 ? "good" : "warn"} />
            <Metric label="Strategy return" value={`${selectedResult.returnPct >= 0 ? "+" : ""}${selectedResult.returnPct.toFixed(2)}%`} tone={selectedResult.returnPct >= 0 ? "good" : "warn"} />
            <Metric label="Alpha vs SPY" value={`${selectedResult.alphaPct >= 0 ? "+" : ""}${selectedResult.alphaPct.toFixed(2)}%`} tone={selectedResult.alphaPct >= 0 ? "good" : "warn"} />
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={selectedResult.points}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" minTickGap={28} />
              <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={54} />
              <Tooltip formatter={(value) => currency.format(Number(value))} />
              <Line type="monotone" dataKey="value" name={selectedStrategy.name} stroke="#177e89" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="spy" name="SPY" stroke="#5d6470" strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel strategy-weight-panel">
          <div className="panel-head">
            <div>
              <h2>Signal weights</h2>
              <span className="table-sort-summary">edit this strategy, then compare the simulated result</span>
            </div>
          </div>
          <div className="table-wrap strategy-weight-table-wrap">
            <table className="signal-weight-table">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Weight</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => (
                  <tr key={definition.key}>
                    <td>
                      <strong>{definition.label}</strong>
                      <small>{definition.decision}</small>
                    </td>
                    <td>
                      <input
                        aria-label={`${definition.label} strategy weight`}
                        type="number"
                        min="-5"
                        max="5"
                        step="0.05"
                        value={selectedStrategy.weights[definition.key]}
                        onChange={(event) => updateStrategyWeights(definition.key, Number(event.target.value))}
                      />
                    </td>
                    <td><span className="signal-type-pill">{definition.group}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingsScreen({
  onSyncAlpacaData,
  syncState,
  syncMessage,
}: {
  onSyncAlpacaData: () => Promise<AlpacaSyncSummary>;
  syncState: SyncState;
  syncMessage: string;
}) {
  const [endpoint, setEndpoint] = useState(
    () =>
      localStorage.getItem("alpaca_endpoint") ??
      (localStorage.getItem("alpaca_paper") === "false" ? LIVE_ALPACA_ENDPOINT : DEFAULT_ALPACA_ENDPOINT),
  );
  const [accountId, setAccountId] = useState(() => localStorage.getItem("alpaca_account_id") ?? "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("alpaca_api_key") ?? "");
  const [secret, setSecret] = useState(() => localStorage.getItem("alpaca_secret_key") ?? "");
  const [saved, setSaved] = useState(false);
  const [signalWeights, setSignalWeights] = useState<SignalWeights>(() => loadSignalWeights());
  const requiredFieldsFilled = Boolean(endpoint.trim() && apiKey.trim() && secret.trim());

  function saveSettings() {
    localStorage.setItem("alpaca_endpoint", endpoint.trim().replace(/\/+$/, "") || DEFAULT_ALPACA_ENDPOINT);
    localStorage.setItem("alpaca_account_id", accountId.trim());
    localStorage.setItem("alpaca_api_key", apiKey);
    localStorage.setItem("alpaca_secret_key", secret);
    localStorage.removeItem("alpaca_paper");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function saveAndSync() {
    saveSettings();
    await onSyncAlpacaData();
  }

  function saveWeights() {
    saveSignalWeights(signalWeights);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  function resetWeights() {
    const defaults = defaultSignalWeights();
    setSignalWeights(defaults);
    saveSignalWeights(defaults);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Configure brokerage connectivity and account preferences.</p>
        </div>
      </header>

      <section className="settings-panel">
        <div className="panel-head">
          <h2>Alpaca API</h2>
          <KeyRound size={19} />
        </div>
        <div className="form-grid">
          <label className="endpoint-field">
            Endpoint
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://paper-api.alpaca.markets/v2"
            />
          </label>
          <label>
            Account ID
            <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="PA..." />
          </label>
          <label>
            API key
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="PK..." />
          </label>
          <label>
            Secret key
            <input value={secret} onChange={(event) => setSecret(event.target.value)} type="password" placeholder="••••••••" />
          </label>
        </div>
        <p className="settings-note">
          Use Alpaca Trading API base endpoint, for example {DEFAULT_ALPACA_ENDPOINT} for paper or {LIVE_ALPACA_ENDPOINT} for live.
        </p>
        <button className="primary-action compact" onClick={saveSettings}>
          <Save size={18} />
          Save settings
        </button>
        {requiredFieldsFilled && (
          <button className="primary-action compact sync-settings-action" onClick={saveAndSync} disabled={syncState === "syncing"}>
            <RefreshCw size={18} />
            {syncState === "syncing" ? "Syncing Alpaca data" : "Sync Alpaca data now"}
          </button>
        )}
        {syncMessage && <p className={`settings-note sync-note ${syncState}`}>{syncMessage}</p>}
        {saved && <p className="saved-state">Settings saved locally.</p>}
      </section>

      <section className="settings-panel signal-settings-panel">
        <div className="panel-head">
          <div>
            <h2>Signal weights</h2>
            <span className="table-sort-summary">negative weights invert a signal; zero disables it</span>
          </div>
          <SlidersHorizontal size={19} />
        </div>
        <div className="table-wrap signal-weight-table-wrap">
          <table className="signal-weight-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Weight</th>
                <th>Description</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {TECHNICAL_SIGNAL_DEFINITIONS.map((definition) => (
                <tr key={definition.key}>
                  <td>
                    <strong>{definition.label}</strong>
                    <small>{definition.decision}</small>
                  </td>
                  <td>
                    <input
                      aria-label={`${definition.label} weight`}
                      type="number"
                      min="-5"
                      max="5"
                      step="0.05"
                      value={signalWeights[definition.key]}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        setSignalWeights((current) => ({
                          ...current,
                          [definition.key]: Number.isFinite(nextValue) ? nextValue : 0,
                        }));
                      }}
                    />
                  </td>
                  <td>{definition.description}</td>
                  <td><span className="signal-type-pill">{definition.group}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="settings-actions">
          <button className="primary-action compact" onClick={saveWeights}>
            <Save size={18} />
            Save weights
          </button>
          <button className="text-button" onClick={resetWeights}>Reset defaults</button>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [user, setUser] = useState(() => localStorage.getItem("portfolio_user") ?? "");
  const [screen, setScreen] = useState<Screen>("stocks");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("Configure Alpaca in Settings to enable background sync.");
  const syncRunningRef = useRef(false);

  async function runAlpacaDataSync(): Promise<AlpacaSyncSummary> {
    if (syncRunningRef.current) {
      return { error: "Alpaca sync is already running." };
    }
    if (!getAlpacaCredentials()) {
      setSyncState("idle");
      setSyncMessage("Configure Alpaca in Settings to enable background sync.");
      return { error: "Missing Alpaca credentials." };
    }

    syncRunningRef.current = true;
    setSyncState("syncing");
    setSyncMessage("Syncing Alpaca portfolio and minute tick cache...");

    try {
      const dataset = await loadMarketDataset();
      const symbols = dataset.symbols.map((stock) => stock.symbol).filter(Boolean);
      const [portfolioResult, intradayResult] = await Promise.allSettled([
        loadAlpacaPortfolio(),
        syncIntradayMinuteCache(symbols, "iex"),
      ]);
      const errors: string[] = [];
      const summary: AlpacaSyncSummary = {};

      if (portfolioResult.status === "fulfilled") {
        summary.portfolioSynced = true;
        summary.portfolio = portfolioResult.value;
      } else {
        errors.push(portfolioResult.reason instanceof Error ? portfolioResult.reason.message : String(portfolioResult.reason));
      }

      if (intradayResult.status === "fulfilled") {
        summary.barsAdded = intradayResult.value.barsAdded ?? 0;
        summary.symbolsSynced = intradayResult.value.symbolsSynced ?? 0;
      } else {
        errors.push(intradayResult.reason instanceof Error ? intradayResult.reason.message : String(intradayResult.reason));
      }

      if (errors.length) {
        summary.error = errors.join(" · ");
        setSyncState("error");
        setSyncMessage(summary.error);
      } else {
        setSyncState("success");
        setSyncMessage(
          `Synced portfolio and ${summary.symbolsSynced ?? 0} symbols, ${summary.barsAdded ?? 0} new minute bars.`,
        );
      }

      window.dispatchEvent(new CustomEvent<AlpacaSyncSummary>("alpaca-data-synced", { detail: summary }));
      return summary;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      const summary = { error: message };
      setSyncState("error");
      setSyncMessage(message);
      window.dispatchEvent(new CustomEvent<AlpacaSyncSummary>("alpaca-data-synced", { detail: summary }));
      return summary;
    } finally {
      syncRunningRef.current = false;
    }
  }

  useEffect(() => {
    if (!user) {
      return undefined;
    }
    void runAlpacaDataSync();
    const interval = window.setInterval(() => {
      void runAlpacaDataSync();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [user]);

  if (!user) {
    return (
      <LoginScreen
        onLogin={(name) => {
          localStorage.setItem("portfolio_user", name);
          setUser(name);
        }}
      />
    );
  }

  return (
    <AppShell
      screen={screen}
      setScreen={setScreen}
      user={user}
      syncState={syncState}
      syncMessage={syncMessage}
      onLogout={() => {
        localStorage.removeItem("portfolio_user");
        setUser("");
      }}
    >
      {screen === "stocks" && <StocksScreen />}
      {screen === "portfolio" && <PortfolioScreen />}
      {screen === "strategies" && <StrategiesScreen />}
      {screen === "settings" && (
        <SettingsScreen
          onSyncAlpacaData={runAlpacaDataSync}
          syncState={syncState}
          syncMessage={syncMessage}
        />
      )}
    </AppShell>
  );
}
