# Rasyid Signal Call — XAU/USD V5

GitHub Pages dashboard for personal XAU/USD analysis.

## V5 changes

- separates **Scalping Setup** from **Daily Setup**
- realtime WebSocket tick chart; current 1M candle updates on every received provider tick
- optimized chart hot path (only current candle updates between minute rolls)
- scalp setup focuses on **5M + 1M execution**, with 15M structure confirmation
- daily setup focuses on **4H + 1H + 15M**
- explicit **ENTER NOW / WAIT / NO ENTRY RISK / MARKET CLOSED** gate
- two-position plan: default **2 × 0.01 lot**
- default balance **Rp1,000,000**
- broker-aware risk calculator using configurable contract size and USD/IDR estimate
- position #1 targets ~1.5R; position #2 targets ~2.5R when liquidity space permits
- BE guidance delays stop-to-entry until TP1 + 1M confirmation
- 1 / 5 / 10 minute scenario projections (edge score, not guaranteed probability)
- Saturday mode: standard XAU/USD is treated as closed/preparation-only unless actual live ticks are present
- backtest metrics remain closed-candle based; no fabricated win rate

## Important risk note

Default risk math assumes 1 standard XAU/USD lot = 100 oz. Broker contract specifications can differ. The dashboard therefore exposes contract size and USD/IDR as editable settings. With a Rp1,000,000 account, **2 × 0.01 lot can easily exceed a reasonable percentage risk if a structurally valid gold stop is several dollars wide**. V5 does not shrink the stop just to force a trade; it returns NO ENTRY when the configured position size is too large for the risk budget.

## GitHub Pages

Upload the contents of this folder to the repository root. GitHub Actions deploys `frontend/out` automatically.
