# Rasyid Signal Call — XAU/USD V7 Mapped Entry

GitHub Pages-only personal XAU/USD signal dashboard.

## V7 focus

- Separate SCALP and DAILY predictive setups.
- User pip convention: **1 pip = $0.10 XAU/USD price movement**, so **25 pips = $2.50 movement**.
- Default account: Rp1,000,000, 2 positions, 0.01 lot each, 100 oz / lot.
- Account-capped stop distance: the entry zone adapts to the configured risk budget instead of allowing a huge structural SL.
- Fibonacci 50 / 61.8 / 70.5 retracement mapping + EMA value + confirmed pivots + liquidity sweep + RSI/ADX/MACD/top-down context.
- Exact entry, entry zone, SL, TP1, TP2 and R:R shown for both scalp and daily setups.
- Once live price is inside a mapped zone, status immediately becomes `ENTER BUY NOW` or `ENTER SELL NOW`; there is no extra WAIT gate inside the zone.
- Chart overlays show scalp and daily entry-zone boxes plus exact entry / SL / TP lines.
- 1/5/10-minute predictive cards show exact execution levels.
- Separate mapped-zone backtests for scalp and daily setups. Win rate is historical, never hardcoded.
- WebSocket event is processed immediately with no artificial throttle. UI reports **LOCAL PIPELINE** separately from upstream provider event gaps/timestamps.
- Live candle bucketing uses browser receive time so the chart clock remains current in WIB even when the provider timestamp is coarse/stale.

## Important latency note

V7 targets <=10 ms for local browser processing after a WebSocket event is received. It cannot guarantee <=10 ms end-to-end market-data latency because network/provider delivery is upstream of the app. The dashboard therefore reports local pipeline time, event-to-event gap, and provider timestamp gap separately.

## GitHub Pages

Upload the contents of this folder to the repository root and commit to `main`. `.github/workflows/pages.yml` builds and deploys `frontend/out` automatically.

## API key

The Twelve Data API key is entered in the browser and stored in localStorage. Do not hardcode a private key into a public repository.
