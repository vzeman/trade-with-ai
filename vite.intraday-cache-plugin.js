import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");
const INDEX_PATH = path.join(INTRADAY_DIR, "index.json");
const DEFAULT_FEED = "iex";
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_SYMBOLS_PER_REQUEST = 120;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeSymbols(symbols) {
  return Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, MAX_SYMBOLS_PER_REQUEST);
}

function toIsoMinute(date) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next.toISOString();
}

function nextMinute(iso) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? toIsoMinute(new Date(date.getTime() + 60_000)) : null;
}

function barToCandle(bar) {
  return {
    date: toIsoMinute(bar.t),
    open: Number(Number(bar.o ?? 0).toFixed(4)),
    high: Number(Number(bar.h ?? 0).toFixed(4)),
    low: Number(Number(bar.l ?? 0).toFixed(4)),
    close: Number(Number(bar.c ?? 0).toFixed(4)),
    volume: Math.round(Number(bar.v ?? 0)),
  };
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function fetchAlpacaBars({ apiKey, secret, symbols, feed, start }) {
  const bySymbol = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: "1Min",
      adjustment: "raw",
      feed,
      limit: "10000",
      sort: "asc",
    });
    if (start) {
      params.set("start", start);
    }
    if (pageToken) {
      params.set("page_token", pageToken);
    }

    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${params}`, {
      headers: {
        accept: "application/json",
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secret,
      },
    });
    if (!response.ok) {
      let message = `Alpaca market data request failed: ${response.status}`;
      try {
        const body = await response.json();
        if (body?.message) {
          message = `Alpaca market data request failed: ${body.message}`;
        }
      } catch {
        // Keep status-only message.
      }
      throw new Error(message);
    }

    const payload = await response.json();
    for (const [symbol, bars] of Object.entries(payload.bars ?? {})) {
      bySymbol[symbol] = [...(bySymbol[symbol] ?? []), ...bars.map(barToCandle)];
    }
    pageToken = payload.next_page_token ?? "";
  } while (pageToken);

  return bySymbol;
}

async function mergeSymbol(symbol, rows, feed) {
  const filePath = path.join(INTRADAY_DIR, `${symbol}.json`);
  const existing = await readJsonIfExists(filePath, {
    symbol,
    source: "alpaca-market-data",
    start: "",
    end: "",
    rows: [],
  });
  const previousRows = Array.isArray(existing.rows) ? existing.rows : [];
  const byDate = new Map(previousRows.map((row) => [row.date, row]));
  for (const row of rows) {
    byDate.set(row.date, row);
  }
  const mergedRows = Array.from(byDate.values()).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const payload = {
    symbol,
    source: `alpaca-market-data:${feed}`,
    start: mergedRows[0]?.date ?? "",
    end: mergedRows.at(-1)?.date ?? "",
    rows: mergedRows,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 0));
  return {
    symbol,
    path: `/data/intraday/${symbol}.json`,
    added: mergedRows.length - previousRows.length,
    rows: mergedRows.length,
    start: payload.start,
    end: payload.end,
  };
}

async function updateIndex(results, feed) {
  const index = await readJsonIfExists(INDEX_PATH, {
    source: "alpaca-market-data",
    lookbackDays: null,
    symbols: {},
  });
  index.source = `alpaca-market-data:${feed}`;
  index.generatedAt = new Date().toISOString();
  index.symbols = index.symbols ?? {};
  for (const result of results) {
    index.symbols[result.symbol] = {
      path: result.path,
      rows: result.rows,
      start: result.start,
      end: result.end,
    };
  }
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
}

export function intradayCachePlugin() {
  return {
    name: "local-intraday-cache-sync",
    configureServer(server) {
      server.middlewares.use("/api/intraday-cache/sync", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed." });
          return;
        }
        try {
          const body = await readBody(req);
          const symbols = normalizeSymbols(body.symbols);
          const apiKey = String(body.apiKey ?? "").trim();
          const secret = String(body.secret ?? "").trim();
          const feed = String(body.feed ?? DEFAULT_FEED).trim() || DEFAULT_FEED;
          const lookbackDays = Math.max(1, Math.min(10, Number(body.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS));
          if (!symbols.length) {
            throw new Error("No symbols selected for minute cache sync.");
          }
          if (!apiKey || !secret) {
            throw new Error("Alpaca API key and secret are required.");
          }

          await fs.mkdir(INTRADAY_DIR, { recursive: true });
          const starts = await Promise.all(
            symbols.map(async (symbol) => {
              const existing = await readJsonIfExists(path.join(INTRADAY_DIR, `${symbol}.json`), null);
              return existing?.end ? nextMinute(existing.end) : null;
            }),
          );
          const fallbackStart = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
          const start = starts.filter(Boolean).sort()[0] ?? fallbackStart;
          const bars = await fetchAlpacaBars({ apiKey, secret, symbols, feed, start });
          const results = await Promise.all(symbols.map((symbol) => mergeSymbol(symbol, bars[symbol] ?? [], feed)));
          await updateIndex(results, feed);
          sendJson(res, 200, {
            ok: true,
            feed,
            start,
            symbolsRequested: symbols.length,
            symbolsSynced: results.filter((result) => result.added > 0).length,
            barsAdded: results.reduce((sum, result) => sum + Math.max(0, result.added), 0),
            results,
          });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Minute cache sync failed." });
        }
      });
    },
  };
}
