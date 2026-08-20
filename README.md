# Rasyid Signal Call — XAU/USD V6 Tight Scalp

GitHub Pages-only personal XAU/USD dashboard.

## V6 changes

- Realtime Twelve Data WebSocket tick stream.
- No 35 ms analysis throttle: every received provider tick updates chart + micro setup.
- Dashboard reports measured in-browser engine calculation latency and provider tick age separately.
- Chart clock is explicitly formatted in Asia/Jakarta (WIB), fixing the previous UTC-looking axis.
- Predictive 1m / 5m / 10m calls now show direction, entry zone, SL, TP1, TP2 and R:R.
- Tight scalp engine prioritizes 1M + 5M and moves the predictive entry zone toward confirmed micro structure instead of widening the SL.
- Default maximum scalp SL: 25 pips.
- Default pip size: 0.01. Change this in the dashboard if the broker defines XAU/USD pips differently.
- Balance-aware stop cap: the effective stop is the lower of the configured pip cap and the distance implied by the account risk budget.
- TP1 targets ~1.8R and TP2 ~2.6R when nearby 5M liquidity allows it.
- Backtest reports only executable V6 tight-stop calls; performance is not hardcoded or guaranteed.

## Important latency note

The dashboard can process a received WebSocket tick immediately, but it cannot force the upstream data vendor or internet path to deliver ticks in 1–20 ms. The UI separates engine processing time from provider/feed age for this reason.

## Risk note

A tight 25-pip SL can be too small for XAU/USD during volatile periods, spread expansion or slippage. V6 therefore prefers WAIT ENTRY ZONE / WAIT RECLAIM rather than chasing price with a larger stop. Verify XAU/USD contract size, pip definition and execution conditions with the broker before using the sizing output.
