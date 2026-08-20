"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CandleChart from "./CandleChart";
import {
  clearApiKey,
  fetchAllTimeframes,
  getCachedFrames,
  getSavedApiKey,
  refreshFromOneMinute,
  saveApiKey,
  type MarketFrames,
} from "../lib/marketData";
import { backtestStrategy, generateSignal, matchingSetupStats } from "../lib/signalEngine";
import type { BacktestStats, Signal } from "../types";

type HistoryRow = Signal & { id: string; created_at: string };

function price(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function loadHistory(): HistoryRow[] {
  try { return JSON.parse(localStorage.getItem("xau_scalp_signal_history") ?? "[]"); }
  catch { return []; }
}

function saveHistory(rows: HistoryRow[]) {
  localStorage.setItem("xau_scalp_signal_history", JSON.stringify(rows.slice(0, 120)));
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [signal, setSignal] = useState<Signal | null>(null);
  const [frames, setFrames] = useState<MarketFrames | null>(null);
  const framesRef = useRef<MarketFrames | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [backtest, setBacktest] = useState<BacktestStats | null>(null);
  const [setupStats, setSetupStats] = useState<BacktestStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedApiKey();
    setApiKey(saved);
    setDraftKey(saved);
    setHistory(loadHistory());
  }, []);

  async function refresh(key = apiKey, forceFull = false) {
    if (!key || loading) return;
    setLoading(true);
    try {
      const current = framesRef.current;
      const cached = !current && forceFull ? getCachedFrames() : null;
      const nextFrames = current
        ? await refreshFromOneMinute(key, current)
        : cached
          ? await refreshFromOneMinute(key, cached)
          : await fetchAllTimeframes(key);

      framesRef.current = nextFrames;
      setFrames(nextFrames);

      const nextSignal = generateSignal(nextFrames.c1, nextFrames.c5, nextFrames.c15, nextFrames.c1h, nextFrames.c4h);
      const bt = backtestStrategy(nextFrames.c1, nextFrames.c5, nextFrames.c15, nextFrames.c1h, nextFrames.c4h, 120);
      const matched = matchingSetupStats(bt, nextSignal);

      setSignal(nextSignal);
      setBacktest(bt);
      setSetupStats(matched);
      setConnected(true);
      setError(null);
      setLastUpdated(new Date().toISOString());

      const id = `${nextSignal.timestamp}-${nextSignal.signal}`;
      setHistory((previous) => {
        if (previous.some((row) => row.id === id)) return previous;
        const rows = [{ ...nextSignal, id, created_at: nextSignal.timestamp }, ...previous].slice(0, 120);
        saveHistory(rows);
        return rows;
      });
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Market data error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    framesRef.current = null;
    void refresh(apiKey, true);
    const timer = window.setInterval(() => void refresh(apiKey), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const currentPrice = useMemo(() => frames?.c1.at(-1)?.close ?? signal?.entry_price ?? null, [frames, signal]);
  const tone = signal?.signal === "BUY" ? "buy" : "sell";
  const chartCandles = frames?.c1 ?? [];
  const sampleQuality = (setupStats?.sampleSize ?? 0) >= 30 ? "GOOD SAMPLE" : (setupStats?.sampleSize ?? 0) >= 12 ? "EARLY SAMPLE" : "LOW SAMPLE";

  function connectKey() {
    const key = draftKey.trim();
    if (!key) return;
    saveApiKey(key);
    setApiKey(key);
  }

  function disconnectKey() {
    clearApiKey();
    setApiKey("");
    setDraftKey("");
    setConnected(false);
    setSignal(null);
    setFrames(null);
    framesRef.current = null;
    setBacktest(null);
    setSetupStats(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RASYID SIGNAL CALL · SCALPING MODE</div>
          <h1>XAU/USD</h1>
          <div className="subline">4H → 1H → 15M → 5M → 1M · directional call setiap update</div>
        </div>
        <div className={`status ${connected ? "online" : "offline"}`}><span /> {connected ? "LIVE" : apiKey ? "RECONNECTING" : "API KEY REQUIRED"}</div>
      </header>

      {!apiKey && (
        <section className="panel connect-panel">
          <div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div>
          <p>Masukkan API key Twelve Data. Key disimpan hanya di browser ini (localStorage), bukan di GitHub.</p>
          <div className="connect-row">
            <input value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Paste Twelve Data API key" type="password" />
            <button onClick={connectKey}>CONNECT</button>
          </div>
        </section>
      )}

      {apiKey && (
        <div className="toolbar">
          <span>{lastUpdated ? `Last update ${new Date(lastUpdated).toLocaleTimeString()}` : "Loading multi-timeframe data..."}</span>
          <span className="usage-note">Cold start maks. 5 calls; reload pakai cache + 1 call/menit.</span>
          <div>
            <button onClick={() => void refresh()} disabled={loading}>{loading ? "REFRESHING..." : "REFRESH NOW"}</button>
            <button onClick={disconnectKey}>CHANGE API KEY</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="hero-grid">
        <article className="panel market-panel">
          <div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>1M EXECUTION CHART</span></div>
          <div className="market-price">{price(currentPrice)}</div>
          <CandleChart candles={chartCandles} />
        </article>

        <aside className={`panel signal-panel ${tone}`}>
          <div className="panel-head"><span>SCALP CALL NOW</span><span>{signal?.status ?? "WAITING"}</span></div>
          <div className="signal-name">{signal?.signal ?? "—"}</div>
          <div className="confidence"><span>{signal?.confidence ?? 0}</span><small>/100 confluence</small></div>
          <div className="winrate-block">
            <div><small>CURRENT SETUP WR</small><strong>{percent(setupStats?.winRate)}</strong></div>
            <div><small>SAMPLE</small><strong>N={setupStats?.sampleSize ?? 0}</strong></div>
            <div className="sample-badge">{sampleQuality}</div>
          </div>
          <div className="levels">
            <div><small>ENTRY</small><strong>{price(signal?.entry_price)}</strong></div>
            <div><small>STOP LOSS</small><strong>{price(signal?.stop_loss)}</strong></div>
            <div><small>TP1 · 1R</small><strong>{price(signal?.take_profit_1)}</strong></div>
            <div><small>TP2 · 1.5R</small><strong>{price(signal?.take_profit_2)}</strong></div>
          </div>
          <div className="rr"><span>R:R</span><strong>{signal?.risk_reward ? `1:${signal.risk_reward}` : "—"}</strong></div>
          <div className="regime"><small>15M MARKET REGIME</small><strong>{signal?.market_regime?.replaceAll("_", " ") ?? "—"}</strong></div>
        </aside>
      </section>

      <section className="stats-grid">
        <article className="panel metric-card">
          <div className="panel-head"><span>RECENT STRATEGY BACKTEST</span><span>TP1 BEFORE SL · 20M MAX HOLD</span></div>
          <div className="metric-main">{percent(backtest?.winRate)}</div>
          <div className="metric-caption">Win rate · N={backtest?.sampleSize ?? 0}</div>
          <div className="mini-metrics">
            <span>WINS <strong>{backtest?.wins ?? 0}</strong></span>
            <span>LOSSES <strong>{backtest?.losses ?? 0}</strong></span>
            <span>PF <strong>{backtest?.profitFactor ?? "—"}</strong></span>
          </div>
        </article>

        <article className="panel metric-card">
          <div className="panel-head"><span>CURRENT SETUP MATCH</span><span>{signal?.signal ?? "—"}</span></div>
          <div className="metric-main">{percent(setupStats?.winRate)}</div>
          <div className="metric-caption">Similar recent calls · N={setupStats?.sampleSize ?? 0}</div>
          <div className="mini-metrics">
            <span>WINS <strong>{setupStats?.wins ?? 0}</strong></span>
            <span>LOSSES <strong>{setupStats?.losses ?? 0}</strong></span>
            <span>STATUS <strong>{sampleQuality}</strong></span>
          </div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-head"><span>TOP-DOWN ANALYSIS</span><span>HIGH → LOW</span></div>
          <div className="timeframes">
            {signal?.timeframe_analysis?.map((item) => (
              <div className="tf-row" key={item.timeframe}>
                <strong>{item.timeframe.toUpperCase()}</strong>
                <span className={`pill ${item.bias.toLowerCase()}`}>{item.bias}</span>
                <span>{item.score}/100</span>
                <small>Net {item.directionalScore > 0 ? "+" : ""}{item.directionalScore} · RSI {item.rsi} · ADX {item.adx}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head"><span>WHY THIS CALL?</span><span>{signal?.strategy_version ?? "v—"}</span></div>
          <ul className="reasons">{(signal?.reasons ?? ["Waiting for market data..."]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <div className="research-note">
            Call BUY/SELL selalu tersedia, tapi confluence ≠ probability. Win rate di atas dihitung dari recent historical candles dengan aturan TP1-before-SL; bukan jaminan trade berikutnya menang.
          </div>
        </article>
      </section>

      <section className="panel history">
        <div className="panel-head"><span>CALL HISTORY</span><span>Latest completed 1M candle · stored in this browser</span></div>
        {history.length === 0 ? <div className="empty">Belum ada call tersimpan.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Time</th><th>Call</th><th>Confluence</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>Regime</th></tr></thead><tbody>
            {history.map((row) => <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td><span className={`pill ${row.signal.toLowerCase()}`}>{row.signal}</span></td>
              <td>{row.confidence}</td><td>{price(row.entry_price)}</td><td>{price(row.stop_loss)}</td><td>{price(row.take_profit_1)}</td><td>{price(row.take_profit_2)}</td><td>{row.market_regime.replaceAll("_", " ")}</td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
