# Browser-only deployment

This version requires no Railway, Render, Postgres, or Python backend.

Upload the contents of this folder to the repository root. Keep `.github/workflows/pages.yml` and `.github/workflows/ci.yml` in place. GitHub Actions will rebuild and deploy automatically on `main`.

Realtime market data uses Twelve Data WebSocket in the browser. Historical candles use Twelve Data REST only on initialization/manual sync.
