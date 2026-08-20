# Rasyid Signal Call — XAU/USD Only

Signal-only research dashboard for **XAU/USD**. It never executes trades. The engine returns **BUY**, **SELL**, or **NO TRADE** using 1H directional bias, 15M primary setup, and 5M confirmation.

> The 90%+ precision figure is a research target, not a guaranteed result. The app does not fabricate performance metrics. `NO TRADE` is preferred when confluence is insufficient.

## Stack

- Frontend: Next.js + TypeScript + Lightweight Charts
- Backend: FastAPI + Python
- Data provider: Twelve Data adapter, plus mock provider for local development
- Persistence: SQLAlchemy; SQLite locally or PostgreSQL in production
- Realtime UI: backend WebSocket
- CI: GitHub Actions

## Local start

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000`.

The default `.env.example` uses `MARKET_DATA_PROVIDER=mock`, so the UI works without an API key. Synthetic mock prices are **not real market data**.

## Enable real XAU/USD data

Set:

```env
MARKET_DATA_PROVIDER=twelve_data
TWELVE_DATA_API_KEY=your_key_here
```

The backend requests `XAU/USD` at `5min`, `15min`, and `1h` intervals. Do not put the provider API key in the frontend or commit it to GitHub.

## Signal logic

High-precision mode requires alignment across all three timeframes. Each timeframe evaluates EMA 20/50/200 alignment, RSI, MACD, ADX and recent market structure. The 1H / 15M / 5M scores are weighted 35% / 45% / 20%. The default threshold is `85`.

A signal is withheld when:

- all three timeframes are not directionally aligned;
- trend strength is weak;
- 15M regime is uncertain/high volatility;
- confluence score is below threshold;
- minimum risk/reward is not met.

Risk levels use ATR plus recent structure. Default target R:R is 1:2.

## Backend endpoints

- `GET /health`
- `GET /api/market/XAUUSD?timeframe=15min&outputsize=220`
- `GET /api/signals/current/XAUUSD`
- `GET /api/signals/history`
- `GET /api/performance`
- `WS /api/ws/signals`

Interactive docs: `/docs`.

## Deploy from GitHub

### Backend — Render

This repo includes `render.yaml`.

1. Push the repo to GitHub.
2. In Render, create a Blueprint from the repository.
3. Add secret `TWELVE_DATA_API_KEY`.
4. Set `CORS_ORIGINS` to the final Vercel frontend origin, e.g. `https://your-app.vercel.app`.
5. Render will provision the backend and PostgreSQL from `render.yaml`.

Copy the resulting backend URL, e.g. `https://rasyidsignalcall-api.onrender.com`.

### Frontend — Vercel

Import the same GitHub repository into Vercel and set **Root Directory** to `frontend`.

Environment variables:

```env
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com
NEXT_PUBLIC_WS_URL=wss://YOUR-BACKEND.onrender.com
```

Deploy. Every push to `main` can then trigger the normal GitHub-connected deployment flow.

## GitHub push for an empty repo

From the extracted project directory:

```bash
git init
git branch -M main
git remote add origin https://github.com/rasyidsopian/rasyidsignalcall.forex.git
git add .
git commit -m "Initial XAUUSD signal platform"
git push -u origin main
```

## Tests

```bash
cd backend
pip install -r requirements.txt
pytest -q
```

Frontend:

```bash
cd frontend
npm install
npm run build
```

## Current MVP limits

- Market output is only XAU/USD.
- Mock provider is synthetic and must not be interpreted as a live signal.
- Twelve Data API limits depend on your plan.
- Live outcome evaluation (TP/SL hit tracking) is not yet enabled, so the API deliberately returns `win_rate: null` rather than inventing a performance figure.
- Before using real capital, add spread/slippage assumptions, a proper historical evaluator, walk-forward validation and live paper-signal tracking.
