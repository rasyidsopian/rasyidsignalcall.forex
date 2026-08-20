# Rasyid Signal Call — XAU/USD Realtime Scalping V3

GitHub Pages dashboard for personal XAU/USD scalping research.

## V3 realtime architecture

- Historical initialization: Twelve Data REST `/time_series`
- Realtime stream: Twelve Data WebSocket `/v1/quotes/price`
- Symbol: XAU/USD only
- Top-down analysis: 4H → 1H → 15M → 5M → 1M
- Live 1M candle built from price ticks
- Current 5M/15M/1H/4H candles updated locally from the same tick stream
- BUY/SELL directional call recalculated intrabar
- Short flip-confirmation window reduces BUY/SELL flicker
- Backtest and win rate use closed candles only
- One frozen call snapshot is stored per completed 1M candle

## Important

The displayed historical win rate is calculated from the available recent candle sample. It is not a guaranteed future win rate. The live confluence score is not a probability of winning.

## GitHub Pages

The custom GitHub Actions workflow builds `frontend/` as a static Next.js export and publishes `frontend/out`.

## API key

Because GitHub Pages is a client-side static site, the Twelve Data key is stored in the user's browser and is used directly by REST/WebSocket requests. This is acceptable for a personal dashboard but not secure for a public multi-user product. A server-side proxy would be required to keep a shared key private.
