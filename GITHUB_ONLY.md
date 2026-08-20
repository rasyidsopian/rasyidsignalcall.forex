# GitHub-only deployment mode

This version deploys the dashboard to GitHub Pages and does not need Railway, Render, PostgreSQL, or a Python runtime.

## Runtime model

- GitHub Pages hosts the static Next.js export.
- The browser requests XAU/USD candles directly from Twelve Data REST API.
- The signal engine runs in TypeScript inside the browser.
- The Twelve Data API key is entered in the UI and stored in that browser's localStorage. It is not committed to GitHub.
- BUY/SELL history is stored in that browser's localStorage.
- The dashboard refreshes market data every 60 seconds and analyzes 5m, 15m and 1h candles.

## Limitation

GitHub Pages cannot run Python/FastAPI or a persistent database. This mode is designed for a personal signal dashboard. For shared server-side secrets, centralized history, and tick/WebSocket processing, a backend host is required.
