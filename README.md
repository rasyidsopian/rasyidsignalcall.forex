# Rasyid Signal Call — XAU/USD V8 Adaptive Realtime Zone Engine

Static GitHub Pages XAU/USD research dashboard using Twelve Data REST for historical initialization and WebSocket price events for realtime updates.

## V8 changes

- Adaptive rolling entry zone: old zones are retired when stale, displaced, invalidated, or when TP1 is reached before entry.
- New setup is remapped automatically from the latest 1M/5M structure instead of waiting forever for an obsolete zone.
- Main UI is intentionally simplified into **Realtime Action**, **Predictive Zone**, and **Performance**.
- Chart shows one active scalp zone only, plus exact Entry, SL, TP1 and TP2.
- 1M / 5M / 10M predictive bias is separate from the realtime execution action.
- Frozen zone lifecycle archive records replaced/missed zones without rewriting their original levels.
- Local event-to-UI latency is measured separately from provider tick interval / feed timestamp age.
- Local target is <=100 ms after the browser receives a tick. Upstream market-to-browser latency is not guaranteed by this static app.
- XAU/USD pip convention in this project: 1 pip = $0.10 price movement; 25 pips = $2.50 price movement.

## Deploy on GitHub Pages

The repo includes `.github/workflows/pages.yml`. Upload/commit the project to `main`; GitHub Actions builds `frontend` and deploys `frontend/out` to Pages.

## Data key

The Twelve Data API key is entered in the browser and stored in localStorage for this personal dashboard. Do not hardcode private keys in a public repository.

## Important

This is a research/paper-signal dashboard. Historical win rate is shown only from recorded/backtested setups and is not a guaranteed future win rate.
