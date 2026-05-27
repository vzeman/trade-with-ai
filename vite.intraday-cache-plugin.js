import fs from "node:fs/promises";
import path from "node:path";
import { EventName, IBApi, OrderAction, OrderType, SecType } from "@stoqey/ib";

const ROOT = process.cwd();
const INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");
const INDEX_PATH = path.join(INTRADAY_DIR, "index.json");
const DEFAULT_FEED = "iex";
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_SYMBOLS_PER_REQUEST = 120;
const IBKR_TIMEOUT_MS = 12_000;
const IBKR_ACCOUNT_TAGS = [
  "NetLiquidation",
  "TotalCashValue",
  "AvailableFunds",
  "BuyingPower",
  "EquityWithLoanValue",
  "GrossPositionValue",
  "UnrealizedPnL",
  "RealizedPnL",
  "DayTradesRemaining",
  "Leverage",
  "AccountType",
];

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

function normalizeIbkrConfig(config = {}) {
  const host = String(config.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(config.port ?? 7497);
  const clientId = Number(config.clientId ?? 1);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Interactive Brokers port must be a valid TCP port.");
  }
  if (!Number.isInteger(clientId) || clientId < 0) {
    throw new Error("Interactive Brokers client ID must be a non-negative integer.");
  }
  return {
    host,
    port,
    clientId,
    accountId: String(config.accountId ?? "").trim(),
    paper: config.paper !== false,
  };
}

function ibkrConnect(config) {
  return new Promise((resolve, reject) => {
    const ib = new IBApi({ host: config.host, port: config.port });
    let settled = false;
    const errors = [];
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ib.disconnect();
        } catch {
          // Ignore cleanup failures.
        }
        reject(new Error(`Interactive Brokers connection timed out after ${IBKR_TIMEOUT_MS / 1000}s. Make sure TWS or IB Gateway is running, API socket clients are enabled, and host/port are reachable.`));
      }
    }, IBKR_TIMEOUT_MS);

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ib.disconnect();
      } catch {
        // Ignore cleanup failures.
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    ib.on(EventName.error, (error, code, reqId) => {
      const message = error?.message ?? String(error);
      errors.push(`IBKR ${code ?? "error"}${reqId != null && reqId >= 0 ? `/${reqId}` : ""}: ${message}`);
      if (!ib.isConnected && !settled) {
        fail(new Error(errors.at(-1)));
      }
    });
    ib.once(EventName.nextValidId, (nextOrderId) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ib, nextOrderId, warnings: errors });
    });
    ib.once(EventName.disconnected, () => {
      if (!settled) {
        fail(new Error(errors.at(-1) ?? "Interactive Brokers disconnected before the API session was ready."));
      }
    });

    try {
      ib.connect(config.clientId);
    } catch (error) {
      fail(error);
    }
  });
}

function waitForIbkrManagedAccounts(ib) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 2_500);
    ib.once(EventName.managedAccounts, (accounts) => {
      clearTimeout(timer);
      resolve(String(accounts ?? "").split(",").map((account) => account.trim()).filter(Boolean));
    });
  });
}

function requestIbkrAccountSummary(ib) {
  return new Promise((resolve, reject) => {
    const reqId = Date.now() % 100000;
    const rows = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while reading Interactive Brokers account summary."));
    }, IBKR_TIMEOUT_MS);
    const onSummary = (receivedReqId, account, tag, value, currency) => {
      if (receivedReqId === reqId) {
        rows.push({ account, tag, value, currency });
      }
    };
    const onEnd = (receivedReqId) => {
      if (receivedReqId !== reqId) {
        return;
      }
      cleanup();
      resolve(rows);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.accountSummary, onSummary);
      ib.off(EventName.accountSummaryEnd, onEnd);
      try {
        ib.cancelAccountSummary(reqId);
      } catch {
        // Request may have already completed.
      }
    };
    ib.on(EventName.accountSummary, onSummary);
    ib.on(EventName.accountSummaryEnd, onEnd);
    ib.reqAccountSummary(reqId, "All", IBKR_ACCOUNT_TAGS.join(","));
  });
}

function requestIbkrAccountUpdates(ib, accountId) {
  return new Promise((resolve, reject) => {
    const account = {};
    const positions = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve({ account, positions });
    }, IBKR_TIMEOUT_MS);
    const onValue = (key, value, currency, accountName) => {
      if (!accountId || accountName === accountId) {
        account[key] = value;
        account[`${key}_currency`] = currency;
      }
    };
    const onPortfolio = (contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, accountName) => {
      if (accountId && accountName && accountName !== accountId) {
        return;
      }
      if (!position) {
        return;
      }
      positions.push({ contract, position, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, accountName });
    };
    const onEnd = (accountName) => {
      if (accountId && accountName !== accountId) {
        return;
      }
      cleanup();
      resolve({ account, positions });
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.updateAccountValue, onValue);
      ib.off(EventName.updatePortfolio, onPortfolio);
      ib.off(EventName.accountDownloadEnd, onEnd);
      try {
        ib.reqAccountUpdates(false, accountId);
      } catch {
        // Ignore cleanup failures.
      }
    };
    ib.on(EventName.updateAccountValue, onValue);
    ib.on(EventName.updatePortfolio, onPortfolio);
    ib.on(EventName.accountDownloadEnd, onEnd);
    ib.reqAccountUpdates(true, accountId);
  });
}

function requestIbkrPositions(ib, accountFilter) {
  return new Promise((resolve) => {
    const positions = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve(positions);
    }, IBKR_TIMEOUT_MS);
    const onPosition = (account, contract, pos, avgCost) => {
      if ((!accountFilter || account === accountFilter) && pos) {
        positions.push({ accountName: account, contract, position: pos, averageCost: avgCost });
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(positions);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.position, onPosition);
      ib.off(EventName.positionEnd, onEnd);
      try {
        ib.cancelPositions();
      } catch {
        // Ignore cleanup failures.
      }
    };
    ib.on(EventName.position, onPosition);
    ib.once(EventName.positionEnd, onEnd);
    ib.reqPositions();
  });
}

function requestIbkrOpenOrders(ib) {
  return new Promise((resolve) => {
    const orders = new Map();
    const timer = setTimeout(() => {
      cleanup();
      resolve(Array.from(orders.values()));
    }, IBKR_TIMEOUT_MS);
    const onOpenOrder = (orderId, contract, order, orderState) => {
      orders.set(String(orderId), { orderId, contract, order, orderState, status: orderState?.status ?? "open" });
    };
    const onStatus = (orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld) => {
      const key = String(orderId);
      const existing = orders.get(key) ?? { orderId, contract: {}, order: {}, orderState: {} };
      orders.set(key, { ...existing, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld });
    };
    const onEnd = () => {
      cleanup();
      resolve(Array.from(orders.values()));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.openOrder, onOpenOrder);
      ib.off(EventName.orderStatus, onStatus);
      ib.off(EventName.openOrderEnd, onEnd);
    };
    ib.on(EventName.openOrder, onOpenOrder);
    ib.on(EventName.orderStatus, onStatus);
    ib.once(EventName.openOrderEnd, onEnd);
    ib.reqOpenOrders();
  });
}

function requestIbkrCompletedOrders(ib) {
  return new Promise((resolve) => {
    const orders = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve(orders);
    }, IBKR_TIMEOUT_MS);
    const onCompleted = (contract, order, orderState) => {
      orders.push({ orderId: order?.orderId ?? order?.permId ?? orders.length + 1, contract, order, orderState, status: orderState?.status ?? "completed" });
    };
    const onEnd = () => {
      cleanup();
      resolve(orders);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.completedOrder, onCompleted);
      ib.off(EventName.completedOrdersEnd, onEnd);
    };
    ib.on(EventName.completedOrder, onCompleted);
    ib.once(EventName.completedOrdersEnd, onEnd);
    try {
      ib.reqCompletedOrders(false);
    } catch {
      cleanup();
      resolve(orders);
    }
  });
}

function requestIbkrExecutions(ib, accountId) {
  return new Promise((resolve) => {
    const executions = [];
    const reqId = (Date.now() + 17) % 100000;
    const timer = setTimeout(() => {
      cleanup();
      resolve(executions);
    }, IBKR_TIMEOUT_MS);
    const onExec = (receivedReqId, contract, execution) => {
      if (receivedReqId === reqId) {
        executions.push({ contract, execution });
      }
    };
    const onEnd = (receivedReqId) => {
      if (receivedReqId !== reqId) {
        return;
      }
      cleanup();
      resolve(executions);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ib.off(EventName.execDetails, onExec);
      ib.off(EventName.execDetailsEnd, onEnd);
    };
    ib.on(EventName.execDetails, onExec);
    ib.once(EventName.execDetailsEnd, onEnd);
    ib.reqExecutions(reqId, accountId ? { acctCode: accountId } : {});
  });
}

function accountSummaryToAlpacaAccount(summaryRows, updates, accountId) {
  const byTag = {};
  for (const row of summaryRows) {
    if (!accountId || row.account === accountId) {
      byTag[row.tag] = row.value;
      byTag[`${row.tag}_currency`] = row.currency;
    }
  }
  const account = {
    id: accountId,
    account_number: accountId,
    status: "CONNECTED",
    currency: byTag.NetLiquidation_currency || updates.TotalCashValue_currency || "USD",
    cash: updates.TotalCashValue ?? byTag.TotalCashValue ?? byTag.AvailableFunds ?? "0",
    equity: byTag.EquityWithLoanValue ?? byTag.NetLiquidation ?? "0",
    portfolio_value: byTag.NetLiquidation ?? byTag.EquityWithLoanValue ?? "0",
    buying_power: byTag.BuyingPower ?? byTag.AvailableFunds ?? updates.BuyingPower ?? "0",
    long_market_value: byTag.GrossPositionValue ?? "0",
    unrealized_pl: byTag.UnrealizedPnL ?? "0",
    realized_pl: byTag.RealizedPnL ?? "0",
    daytrade_count: byTag.DayTradesRemaining ?? "",
    pattern_day_trader: false,
    broker: "interactive-brokers",
  };
  for (const [key, value] of Object.entries(updates)) {
    if (!key.endsWith("_currency")) {
      account[key] = value;
    }
  }
  return account;
}

function ibkrPositionToAlpacaPosition(position) {
  const symbol = String(position.contract?.symbol ?? position.contract?.localSymbol ?? "").toUpperCase();
  const qty = Number(position.position ?? 0);
  const currentPrice = Number(position.marketPrice ?? 0);
  const marketValue = Number(position.marketValue ?? (currentPrice && qty ? currentPrice * qty : 0));
  const avgCost = Number(position.averageCost ?? 0);
  return {
    symbol,
    qty: String(qty),
    market_value: String(marketValue || 0),
    avg_entry_price: String(avgCost || 0),
    unrealized_pl: String(Number(position.unrealizedPNL ?? (marketValue && avgCost ? marketValue - avgCost * qty : 0)) || 0),
    current_price: String(currentPrice || (qty ? marketValue / qty : 0) || avgCost || 0),
    asset_class: position.contract?.secType ?? "STK",
    exchange: position.contract?.exchange ?? position.contract?.primaryExch ?? "",
    account: position.accountName ?? position.account ?? "",
  };
}

function ibkrOrderToAlpacaOrder(item) {
  const order = item.order ?? {};
  const contract = item.contract ?? {};
  const side = String(order.action ?? "").toUpperCase() === "SELL" ? "sell" : "buy";
  const qty = Number(order.totalQuantity ?? item.filled ?? 0) || 0;
  const filled = Number(item.filled ?? 0) || 0;
  const avgFill = Number(item.avgFillPrice ?? 0) || Number(order.lmtPrice ?? 0) || 0;
  return {
    id: String(item.orderId ?? order.orderId ?? order.permId ?? `${contract.symbol ?? "order"}-${Date.now()}`),
    submitted_at: new Date().toISOString(),
    filled_at: String(item.status ?? "").toLowerCase() === "filled" ? new Date().toISOString() : undefined,
    symbol: String(contract.symbol ?? order.symbol ?? "").toUpperCase(),
    side,
    qty: String(qty),
    filled_qty: String(filled),
    type: String(order.orderType ?? "").toLowerCase(),
    time_in_force: String(order.tif ?? "DAY").toLowerCase(),
    status: String(item.status ?? item.orderState?.status ?? "open").toLowerCase(),
    limit_price: order.lmtPrice != null ? String(order.lmtPrice) : null,
    filled_avg_price: avgFill ? String(avgFill) : null,
    broker: "interactive-brokers",
    order_ref: order.orderRef ?? "",
    account: order.account ?? "",
  };
}

function ibkrExecutionToActivity(item) {
  const execution = item.execution ?? {};
  const contract = item.contract ?? {};
  const side = String(execution.side ?? "").toUpperCase() === "SLD" ? "sell" : "buy";
  const qty = Number(execution.shares ?? execution.cumQty ?? 0) || 0;
  const price = Number(execution.price ?? execution.avgPrice ?? 0) || 0;
  return {
    id: execution.execId ?? `${contract.symbol ?? "execution"}-${execution.time ?? Date.now()}`,
    activity_type: "FILL",
    transaction_time: execution.time ?? new Date().toISOString(),
    date: execution.time ? String(execution.time).slice(0, 10).replace(/\s/g, "T") : new Date().toISOString().slice(0, 10),
    symbol: String(contract.symbol ?? "").toUpperCase(),
    side,
    qty: String(qty),
    price: String(price),
    net_amount: String((side === "buy" ? -1 : 1) * qty * price),
    type: "fill",
    account: execution.acctNumber ?? "",
    broker: "interactive-brokers",
  };
}

function ibkrOrderRequestToContract(order) {
  const symbol = String(order.symbol ?? "").trim().toUpperCase();
  if (!symbol) {
    throw new Error("Symbol is required for Interactive Brokers orders.");
  }
  return {
    symbol,
    exchange: String(order.exchange ?? "SMART"),
    currency: String(order.currency ?? "USD"),
    secType: SecType.STK,
  };
}

function ibkrOrderRequestToOrder(order, accountId, nextOrderId) {
  const side = String(order.side ?? "").toLowerCase();
  const qty = Math.floor(Number(order.qty ?? 0));
  if (side !== "buy" && side !== "sell") {
    throw new Error("Order side must be buy or sell.");
  }
  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error("Interactive Brokers connector supports whole-share quantity orders only.");
  }
  if (order.notional) {
    throw new Error("Interactive Brokers connector does not support notional orders yet. Use whole-share quantity.");
  }
  const type = String(order.type ?? "market");
  const ibOrder = {
    orderId: nextOrderId,
    action: side === "buy" ? OrderAction.BUY : OrderAction.SELL,
    totalQuantity: qty,
    tif: mapIbkrTimeInForce(order.time_in_force),
    transmit: true,
    outsideRth: Boolean(order.extended_hours),
    account: accountId || undefined,
    orderRef: String(order.client_order_id ?? "trade-with-ai").slice(0, 32),
  };
  if (type === "market") {
    ibOrder.orderType = OrderType.MKT;
  } else if (type === "limit") {
    ibOrder.orderType = OrderType.LMT;
    ibOrder.lmtPrice = requiredPositiveNumber(order.limit_price, "Limit price");
  } else if (type === "stop") {
    ibOrder.orderType = OrderType.STP;
    ibOrder.auxPrice = requiredPositiveNumber(order.stop_price, "Stop price");
  } else if (type === "stop_limit") {
    ibOrder.orderType = OrderType.STP_LMT;
    ibOrder.lmtPrice = requiredPositiveNumber(order.limit_price, "Limit price");
    ibOrder.auxPrice = requiredPositiveNumber(order.stop_price, "Stop price");
  } else if (type === "trailing_stop") {
    ibOrder.orderType = OrderType.TRAIL;
    if (order.trail_price) {
      ibOrder.auxPrice = requiredPositiveNumber(order.trail_price, "Trail price");
    }
    if (order.trail_percent) {
      ibOrder.trailingPercent = requiredPositiveNumber(order.trail_percent, "Trail percent");
    }
  } else {
    throw new Error(`Interactive Brokers order type ${type} is not supported yet.`);
  }
  return ibOrder;
}

function mapIbkrTimeInForce(value) {
  const tif = String(value ?? "day").toLowerCase();
  if (tif === "day") return "DAY";
  if (tif === "gtc") return "GTC";
  if (tif === "opg") return "OPG";
  if (tif === "ioc") return "IOC";
  if (tif === "fok") return "FOK";
  throw new Error(`Interactive Brokers time in force ${value} is not supported yet.`);
}

function requiredPositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

async function loadInteractiveBrokersPortfolio(config) {
  const session = await ibkrConnect(config);
  const { ib, warnings } = session;
  try {
    const managedAccounts = await waitForIbkrManagedAccounts(ib);
    const summaryRows = await requestIbkrAccountSummary(ib);
    const accountId = config.accountId || summaryRows[0]?.account || managedAccounts[0] || "";
    const [updates, fallbackPositions, openOrders, completedOrders, executions] = await Promise.all([
      accountId ? requestIbkrAccountUpdates(ib, accountId) : Promise.resolve({ account: {}, positions: [] }),
      requestIbkrPositions(ib, accountId),
      requestIbkrOpenOrders(ib),
      requestIbkrCompletedOrders(ib),
      requestIbkrExecutions(ib, accountId),
    ]);
    const account = accountSummaryToAlpacaAccount(summaryRows, updates.account, accountId);
    const updatePositions = updates.positions.length ? updates.positions : fallbackPositions;
    const positions = updatePositions.map(ibkrPositionToAlpacaPosition).filter((position) => position.symbol);
    const orders = [...openOrders, ...completedOrders].map(ibkrOrderToAlpacaOrder).filter((order) => order.symbol);
    const activities = executions.map(ibkrExecutionToActivity).filter((activity) => activity.symbol);
    return {
      account,
      positions,
      history: { timestamp: [], equity: [], profit_loss: [] },
      orders,
      activities,
      meta: {
        broker: "interactive-brokers",
        host: config.host,
        port: config.port,
        clientId: config.clientId,
        managedAccounts,
        warnings,
      },
    };
  } finally {
    ib.disconnect();
  }
}

async function placeInteractiveBrokersOrder(config, orderRequest) {
  const session = await ibkrConnect(config);
  const { ib, nextOrderId, warnings } = session;
  try {
    const managedAccounts = await waitForIbkrManagedAccounts(ib);
    const accountId = config.accountId || managedAccounts[0] || "";
    const contract = ibkrOrderRequestToContract(orderRequest);
    const order = ibkrOrderRequestToOrder(orderRequest, accountId, nextOrderId);
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ orderId: nextOrderId, status: "submitted", filled: 0, remaining: order.totalQuantity, avgFillPrice: 0 });
      }, 5_000);
      const onStatus = (orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld) => {
        if (orderId !== nextOrderId) {
          return;
        }
        cleanup();
        resolve({ orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld });
      };
      const onError = (error, code, reqId) => {
        if (reqId === nextOrderId) {
          cleanup();
          reject(new Error(`IBKR order rejected (${code}): ${error?.message ?? error}`));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        ib.off(EventName.orderStatus, onStatus);
        ib.off(EventName.error, onError);
      };
      ib.on(EventName.orderStatus, onStatus);
      ib.on(EventName.error, onError);
      ib.placeOrder(nextOrderId, contract, order);
    });
    return {
      ok: true,
      order: ibkrOrderToAlpacaOrder({ ...status, contract, order }),
      warnings,
    };
  } finally {
    ib.disconnect();
  }
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
      server.middlewares.use("/api/brokers/interactive-brokers/test", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed." });
          return;
        }
        let session = null;
        try {
          const body = await readBody(req);
          const config = normalizeIbkrConfig(body.config ?? body);
          session = await ibkrConnect(config);
          const managedAccounts = await waitForIbkrManagedAccounts(session.ib);
          sendJson(res, 200, {
            ok: true,
            broker: "interactive-brokers",
            host: config.host,
            port: config.port,
            clientId: config.clientId,
            paper: config.paper,
            nextOrderId: session.nextOrderId,
            managedAccounts,
            warnings: session.warnings,
          });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Interactive Brokers connection test failed." });
        } finally {
          try {
            session?.ib?.disconnect();
          } catch {
            // Ignore cleanup failures.
          }
        }
      });

      server.middlewares.use("/api/brokers/interactive-brokers/portfolio", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed." });
          return;
        }
        try {
          const body = await readBody(req);
          const config = normalizeIbkrConfig(body.config ?? body);
          const portfolio = await loadInteractiveBrokersPortfolio(config);
          sendJson(res, 200, { ok: true, portfolio });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Interactive Brokers portfolio load failed." });
        }
      });

      server.middlewares.use("/api/brokers/interactive-brokers/orders", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed." });
          return;
        }
        try {
          const body = await readBody(req);
          const config = normalizeIbkrConfig(body.config);
          const result = await placeInteractiveBrokersOrder(config, body.order ?? {});
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Interactive Brokers order failed." });
        }
      });

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
