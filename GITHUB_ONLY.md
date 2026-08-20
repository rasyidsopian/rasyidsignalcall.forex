# GitHub Pages deployment

1. Open the GitHub repository.
2. Choose **Add file → Upload files**.
3. Upload the CONTENTS of this folder so `frontend/` and `.github/` remain at repository root.
4. Commit directly to `main`.
5. GitHub Actions automatically runs `Deploy GitHub Pages`.
6. Hard refresh the live site after the deployment turns green.

V4 intentionally uses no Railway/Render backend. Twelve Data REST initializes historical candles and WebSocket streams live XAU/USD ticks directly to the browser.
