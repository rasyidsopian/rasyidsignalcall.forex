# Rasyid Signal Call — XAU/USD Scalping v2

GitHub Pages-only XAU/USD scalping dashboard.

## Strategy stack

- 4H: macro context
- 1H: directional bias
- 15M: primary setup / regime
- 5M: momentum confirmation
- 1M: execution trigger
- Always returns BUY or SELL; confidence is a confluence score, not a guaranteed probability.

## Performance display

The dashboard calculates a recent client-side backtest using synchronized historical candles. A trade is counted as a WIN when TP1 (1R) is touched before SL within the next 20 one-minute candles. If TP1 and SL are both touched inside the same 1M candle, the result is conservatively counted as LOSS because intrabar order is unknown.

It displays:

- Recent strategy win rate + N
- Wins / losses / profit factor
- Current-setup matched win rate + N

These are historical measurements, not guarantees. Broker spread, slippage, execution latency, and fees are not included because the browser feed does not contain broker-specific execution data.

## Data

Twelve Data API key is stored only in browser localStorage. Initial load requests 1M, 5M, 15M, 1H, and 4H history. Subsequent auto-refreshes request 1M only and rebuild recent higher timeframes locally.

## Deploy

Push changes to `main`. `.github/workflows/pages.yml` builds `frontend/` and deploys `frontend/out` to GitHub Pages.
