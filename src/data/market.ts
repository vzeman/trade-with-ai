export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockSymbol = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  weight: number;
  volume: string;
  risk: "Low" | "Medium" | "High";
  marketState: "Bull" | "Bear" | "Sideways";
  trendReturn: number;
  candles: Candle[];
};

export type MarketState = StockSymbol["marketState"];

export type MarketDataset = {
  generatedAt: string;
  source: string;
  startDate: string;
  endDate: string;
  symbols: StockSymbol[];
};

export async function loadMarketDataset(): Promise<MarketDataset> {
  const response = await fetch("/data/market-cache.json");
  if (!response.ok) {
    throw new Error("Market cache is missing. Add market-cache.json to public/data for local dev, or data for Docker.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("Market cache is missing or not JSON. Add market-cache.json to public/data for local dev, or data for Docker.");
  }
  try {
    return (await response.json()) as MarketDataset;
  } catch {
    throw new Error("Market cache JSON is invalid. Regenerate public/data/market-cache.json.");
  }
}

export function classifyMarketState(candles: Candle[], lookbackDays: number): { marketState: MarketState; trendReturn: number } {
  if (candles.length < 2) {
    return { marketState: "Sideways", trendReturn: 0 };
  }

  const latest = candles[candles.length - 1];
  const startIndex = Math.max(0, candles.length - 1 - Math.max(1, Math.round(lookbackDays)));
  const baseline = candles[startIndex];
  const trendReturn = baseline.close ? (latest.close / baseline.close - 1) * 100 : 0;

  if (trendReturn >= 5) {
    return { marketState: "Bull", trendReturn: Number(trendReturn.toFixed(2)) };
  }
  if (trendReturn <= -5) {
    return { marketState: "Bear", trendReturn: Number(trendReturn.toFixed(2)) };
  }
  return { marketState: "Sideways", trendReturn: Number(trendReturn.toFixed(2)) };
}

export function applyStateLookback(stocks: StockSymbol[], lookbackDays: number): StockSymbol[] {
  return stocks.map((stock) => ({
    ...stock,
    ...classifyMarketState(stock.candles, lookbackDays),
  }));
}

export function buildPortfolioSeries(stocks: StockSymbol[]) {
  const spy = stocks.find((stock) => stock.symbol === "SPY");
  const leaders = stocks.filter((stock) => stock.symbol !== "SPY").slice(0, 10);
  const source = spy?.candles.length ? spy.candles : leaders[0]?.candles ?? [];
  const stride = Math.max(1, Math.floor(source.length / 12));
  const points = source.filter((_, index) => index % stride === 0).slice(-12);
  const spyStart = spy?.candles[0]?.close || points[0]?.close || 1;

  return points.map((point, index) => {
    const matchingLeaders = leaders
      .map((stock) => stock.candles.find((candle) => candle.date === point.date))
      .filter((candle): candle is Candle => Boolean(candle));
    const leaderBase = leaders
      .map((stock) => stock.candles[0]?.close)
      .filter((value): value is number => Boolean(value));
    const model =
      matchingLeaders.length && leaderBase.length
        ? matchingLeaders.reduce((sum, candle, candleIndex) => sum + (candle.close / leaderBase[Math.min(candleIndex, leaderBase.length - 1)]) * 100, 0) /
          matchingLeaders.length
        : 100;
    const spyClose = spy?.candles.find((candle) => candle.date === point.date)?.close ?? point.close;
    const month = new Date(`${point.date}T00:00:00`).toLocaleDateString("en-US", { month: "short" });

    return {
      month: `${month}${index === 0 ? "" : ""}`,
      model: Number(model.toFixed(2)),
      spy: Number(((spyClose / spyStart) * 100).toFixed(2)),
    };
  });
}
