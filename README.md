# Rasyid Signal Call — XAU/USD

GitHub Pages version of a personal XAU/USD signal dashboard.

## What it does

- XAU/USD only
- 1H directional bias
- 15M primary setup
- 5M entry confirmation
- BUY / SELL / NO TRADE
- Confidence score
- Entry / SL / TP1 / TP2 / R:R
- EMA 20/50/200, RSI, MACD, ATR, ADX
- Market structure and market regime filters
- Signal history stored locally in the browser
- Refreshes market data every 60 seconds

## Market data

The dashboard fetches XAU/USD candles from Twelve Data directly in the browser. On first launch, enter your Twelve Data API key in the dashboard. The key is stored in browser localStorage and is not committed to GitHub.

## Deploy

This repository deploys with GitHub Actions to GitHub Pages. In repository Settings > Pages, set Source to GitHub Actions.

Expected project URL:

`https://rasyidsopian.github.io/rasyidsignalcall.forex/`

## Important

This is a research/personal signal tool, not an automated trading system. A 90%+ win rate is a research target and is not guaranteed or hardcoded.
