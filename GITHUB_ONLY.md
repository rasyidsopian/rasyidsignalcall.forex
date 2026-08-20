# Deploy V6 on GitHub Pages

1. Extract the ZIP.
2. Open the extracted `rasyidsignalcall.scalping-v6` folder.
3. In the GitHub repository, choose **Code → Add file → Upload files**.
4. Upload the contents of the folder, not the wrapper folder itself.
5. Commit to `main` with message: `Deploy XAUUSD tight scalp V6`.
6. Wait for **Deploy GitHub Pages** to turn green in Actions.
7. Open the Pages URL and hard-refresh (`Ctrl+F5`).

Expected paths include:

- `frontend/lib/strategyV6.ts`
- `frontend/lib/marketData.ts`
- `frontend/components/Dashboard.tsx`
- `frontend/components/CandleChart.tsx`
- `.github/workflows/pages.yml`
