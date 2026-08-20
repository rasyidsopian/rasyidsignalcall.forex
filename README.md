# Rasyid Signal Call — XAU/USD Scalping V2.1

GitHub Pages static dashboard for XAU/USD directional scalping research.

## Stack
- 4H macro context
- 1H directional bias
- 15M setup/regime
- 5M momentum confirmation
- 1M execution trigger
- BUY/SELL directional call on every completed 1M update

## V2.1 rate-limit fix
- Multi-timeframe history is cached in the browser for 15 minutes.
- Reloads reuse cached 4H/1H/15M/5M history and make only one 1M refresh request.
- Cold-start requests are sequential instead of a 5-request burst.
- HTTP 429 uses retry/backoff and gives a clearer quota message.
- Normal refresh remains one REST call per minute.

## Win-rate semantics
Win rate is measured from simulated historical calls. A WIN means TP1 (1R) is reached before SL within a maximum 20 one-minute candles. Same-candle TP/SL ambiguity is treated conservatively as a LOSS. Sample size N is always shown.

No performance figure is guaranteed. This is a research dashboard, not automatic trade execution.
