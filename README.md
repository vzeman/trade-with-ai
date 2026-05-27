# Trade With AI

Trade With AI is a browser-based stock portfolio and signal dashboard for Alpaca-powered research and paper/live account monitoring.

It combines cached market data, Alpaca account data, technical trading signals, weighted recommendations, portfolio P/L views, and order placement controls in one UI.

> This project is research software. It is not financial advice and it does not guarantee profitable trading.

## Features

- Stock table with sortable recommendations, state, risk, gap-ups, 12-month high distance, volume, and mini charts.
- Stock detail dialog with price/candle/volume/return charts, state/risk overlays, Markov state probabilities, volume-risk factors, and technical signal history.
- Configurable weighted signal engine for common trader signals:
  - SMA 20/50 trend
  - EMA MACD
  - price vs SMA 200
  - 20-day rate of change
  - RSI 14
  - stochastic 14
  - Bollinger position
  - ATR risk
  - volume 5/20
  - OBV trend
  - 20-day breakout
  - gap pressure
  - 20-day relative strength vs SPY
- Portfolio page with Alpaca positions, orders, activities, balances, P/L cards, current holdings, and recommended trades.
- Alpaca order dialog with the common Trading API order options.
- Background browser sync for Alpaca portfolio data and 1-minute intraday cache while the app is open.
- Docker Compose setup so users do not need to install Node.js locally.

## What Is Not Committed

The repository intentionally does **not** include:

- Alpaca credentials
- `.env` secrets
- market data caches
- intraday tick caches
- generated build output
- `node_modules`

Ignored cache paths:

```text
public/data/*
data/*
```

The Docker Compose setup mounts local `./data` into `/app/public/data` inside the container. That keeps market cache files on your machine and out of git.

## Quick Start With Docker

Requirements:

- Docker Desktop or Docker Engine
- Docker Compose v2

Run:

```bash
git clone https://github.com/vzeman/trade-with-ai.git
cd trade-with-ai
docker compose up --build
```

Open:

```text
http://localhost:5173
```

The app starts even without market cache files. Add market cache files into `./data` when you have them.

## Alpaca Setup

Open **Settings** in the app and enter:

- Alpaca Trading API endpoint, for example `https://paper-api.alpaca.markets/v2`
- Account ID, optional for display/notes
- API key
- Secret key

Credentials are stored only in your browser localStorage. They are not committed to git.

After credentials are set:

- the app syncs portfolio data in the background every minute while open
- the Settings screen shows a manual **Sync Alpaca data now** button
- 1-minute bars are cached under `./data/intraday`

## Market Cache

The Stocks page expects a daily market cache at:

```text
./data/market-cache.json
```

Optional market-wide volume model signals:

```text
./data/volume-state-risk.json
```

These files are ignored by git because they may contain licensed, paid, private, or large market data.

### Minimal Market Cache Shape

```json
{
  "generatedAt": "2026-05-27T00:00:00.000Z",
  "source": "your-data-source",
  "startDate": "2025-01-01",
  "endDate": "2026-05-27",
  "symbols": [
    {
      "symbol": "SPY",
      "name": "SPDR S&P 500 ETF Trust",
      "sector": "ETF",
      "price": 0,
      "change": 0,
      "weight": 0,
      "volume": "--",
      "risk": "Medium",
      "marketState": "Sideways",
      "trendReturn": 0,
      "candles": [
        {
          "date": "2026-05-27",
          "open": 0,
          "high": 0,
          "low": 0,
          "close": 0,
          "volume": 0
        }
      ]
    }
  ]
}
```

For useful recommendations, provide daily OHLCV candles for each symbol and include SPY for relative-strength signals.

## Local Development Without Docker

Requirements:

- Node.js 22+
- npm

Run:

```bash
npm ci
npm run dev
```

Open:

```text
http://localhost:5173
```

Build check:

```bash
npm run build
```

## Data Persistence In Docker

Compose uses:

```yaml
volumes:
  - ./data:/app/public/data
```

That means:

- `./data/market-cache.json` is read by the Stocks screen
- `./data/volume-state-risk.json` is read by the volume-risk layer
- `./data/intraday/*.json` is written by the 1-minute Alpaca sync
- nothing under `./data` is committed

## Security Notes

- Do not commit `.env` files or cache files.
- Prefer Alpaca paper trading while testing.
- Browser localStorage is convenient for local use, but production SaaS should move secrets to a backend vault.
- This repository contains no real API keys or user portfolio cache.

## Project Structure

```text
src/
  App.tsx                 Main app, portfolio logic, signals, recommendations
  main.tsx                React entrypoint
  styles.css              App styling
  data/market.ts          Market cache loader/types
vite.intraday-cache-plugin.js
                          Vite middleware for local 1-minute Alpaca cache
public/data/.gitkeep      Placeholder only; real cache files are ignored
data/.gitkeep             Docker-mounted cache folder placeholder
Dockerfile
docker-compose.yml
```
