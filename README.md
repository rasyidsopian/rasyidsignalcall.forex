# Rasyid Signal Call — XAU/USD Realtime Scalping V4

GitHub Pages dashboard for personal XAU/USD scalping research.

## V4 changes

- Realtime 1M chart hardened against stale/out-of-order ticks and duplicate timestamps.
- New cache namespace prevents corrupted/stale V3 frame data from carrying over.
- Chart redraw fallback automatically restores candles if an incremental update fails.
- Signal engine recalculates up to every 100 ms when new WebSocket ticks arrive.
- BUY/SELL direction is now dominated by 1M + 5M (80% combined weight).
- 15M is setup context; 1H/4H are secondary context filters.
- Execution is separated into `ENTER NOW` vs `WAIT PULLBACK` while directional BUY/SELL remains visible.
- Stop placement uses confirmed micro swing / liquidity sweep plus ATR buffer to reduce overly tight stops.
- TP1 targets about 1.6R and TP2 targets about 2.2R, with TP2 capped before nearby 5M structure when appropriate.
- Historical win rate is calculated only from closed-candle setups that the engine itself marked `ENTER NOW`.

## Realtime architecture

- Historical initialization: Twelve Data REST `/time_series`
- Realtime stream: Twelve Data WebSocket `/v1/quotes/price`
- Symbol: XAU/USD only
- Analysis stack: 4H / 1H context → 15M setup → 5M + 1M execution
- Live 1M candle built from price ticks
- Current 5M/15M/1H/4H candles updated locally from the same tick stream

## Important

The displayed historical win rate is calculated from the available recent closed-candle sample. It is not a guaranteed future win rate. The live confluence score is not a probability of winning. ATR/swing-buffer stop placement may reduce overly tight stops but cannot guarantee avoidance of stop-outs or so-called stop hunting.

## GitHub Pages

The custom GitHub Actions workflow builds `frontend/` as a static Next.js export and publishes `frontend/out`.

## API key

Because GitHub Pages is a client-side static site, the Twelve Data key is stored in the user's browser and is used directly by REST/WebSocket requests. This is suitable only for a personal dashboard. A server-side proxy would be required to keep a shared key private.
