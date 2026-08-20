# GitHub-only deploy

1. Upload the **contents** of this folder to the repository root.
2. Keep `.github/workflows/pages.yml`.
3. Commit to `main`.
4. GitHub Actions builds `frontend/` and publishes `frontend/out`.
5. Hard-refresh the live site after the workflow turns green.

V5 requires no Railway/Render backend. Twelve Data REST is used for historical initialization and WebSocket for live XAU/USD ticks.
