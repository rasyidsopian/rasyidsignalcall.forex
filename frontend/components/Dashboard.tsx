"use client";

import { useEffect, useMemo, useState } from "react";
import CandleChart from "./CandleChart";
import { clearApiKey, fetchAllTimeframes, getSavedApiKey, saveApiKey } from "../lib/marketData";
import { generateSignal } from "../lib/signalEngine";
import type { Candle, Signal } from "../types";

type HistoryRow = Signal & { id: string; created_at: string };

function price(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function loadHistory(): HistoryRow[] {
  try { return JSON.parse(localStorage.getItem("xau_signal_history") ?? "[]"); }
  catch { return []; }
}

function saveHistory(rows: HistoryRow[]) {
  localStorage.setItem("xau_signal_history", JSON.stringify(rows.slice(0, 100)));
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [signal, setSignal] = useState<Signal | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
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

  async function refresh(key = apiKey) {
    if (!key) return;
    setLoading(true);
    try {
      const { c5, c15, c1h } = await fetchAllTimeframes(key);
      const next = generateSignal(c5, c15, c1h);
      setCandles(c15);
      setSignal(next);
      setConnected(true);
      setError(null);
      setLastUpdated(new Date().toISOString());
      if (next.signal === "BUY" || next.signal === "SELL") {
        const candleId = c15.at(-1)?.timestamp ?? next.timestamp;
        const id = `${candleId}-${next.signal}`;
        setHistory((previous) => {
          if (previous.some((row) => row.id === id)) return previous;
          const rows = [{ ...next, id, created_at: next.timestamp }, ...previous].slice(0, 100);
          saveHistory(rows);
          return rows;
        });
      }
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Market data error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    refresh(apiKey);
    const timer = window.setInterval(() => refresh(apiKey), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const currentPrice = useMemo(() => candles.at(-1)?.close ?? signal?.entry_price ?? null, [candles, signal]);
  const tone = signal?.signal === "BUY" ? "buy" : signal?.signal === "SELL" ? "sell" : "neutral";

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
    setCandles([]);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">RASYID SIGNAL CALL</div><h1>XAU/USD</h1></div>
        <div className={`status ${connected ? "online" : "offline"}`}><span /> {connected ? "LIVE" : apiKey ? "RECONNECTING" : "API KEY REQUIRED"}</div>
      </header>

      {!apiKey && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div>
          <p style={{ color: "#9ba7bd", marginTop: 0 }}>Masukkan API key Twelve Data. Key disimpan hanya di browser ini (localStorage), bukan di GitHub.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="Paste Twelve Data API key"
              type="password"
              style={{ flex: 1, minWidth: 260, background: "#0b1020", color: "white", border: "1px solid #25304a", borderRadius: 8, padding: "12px 14px" }}
            />
            <button onClick={connectKey} style={{ padding: "12px 18px", borderRadius: 8, border: 0, cursor: "pointer", fontWeight: 700 }}>CONNECT</button>
          </div>
        </section>
      )}

      {apiKey && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14, color: "#9ba7bd", fontSize: 13 }}>
          <span>{lastUpdated ? `Last update ${new Date(lastUpdated).toLocaleTimeString()}` : "Waiting for first update..."}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => refresh()} disabled={loading} style={{ cursor: "pointer" }}>{loading ? "REFRESHING..." : "REFRESH NOW"}</button>
            <button onClick={disconnectKey} style={{ cursor: "pointer" }}>CHANGE API KEY</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="hero-grid">
        <article className="panel market-panel">
          <div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>15M</span></div>
          <div className="market-price">{price(currentPrice)}</div>
          <CandleChart candles={candles} />
        </article>

        <aside className={`panel signal-panel ${tone}`}>
          <div className="panel-head"><span>CURRENT SIGNAL</span><span>{signal?.status ?? "WAITING"}</span></div>
          <div className="signal-name">{signal?.signal?.replace("_", " ") ?? "—"}</div>
          <div className="confidence"><span>{signal?.confidence ?? 0}</span><small>/100 confidence</small></div>
          <div className="levels">
            <div><small>ENTRY</small><strong>{price(signal?.entry_price ?? null)}</strong></div>
            <div><small>STOP LOSS</small><strong>{price(signal?.stop_loss ?? null)}</strong></div>
            <div><small>TP1</small><strong>{price(signal?.take_profit_1 ?? null)}</strong></div>
            <div><small>TP2</small><strong>{price(signal?.take_profit_2 ?? null)}</strong></div>
          </div>
          <div className="rr"><span>R:R</span><strong>{signal?.risk_reward ? `1:${signal.risk_reward}` : "—"}</strong></div>
          <div className="regime"><small>MARKET REGIME</small><strong>{signal?.market_regime?.replaceAll("_", " ") ?? "—"}</strong></div>
        </aside>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-head"><span>MULTI-TIMEFRAME</span><span>HIGH PRECISION MODE</span></div>
          <div className="timeframes">
            {signal?.timeframe_analysis?.map((item) => (
              <div className="tf-row" key={item.timeframe}>
                <strong>{item.timeframe.toUpperCase()}</strong>
                <span className={`pill ${item.bias.toLowerCase()}`}>{item.bias}</span>
                <span>{item.score}/100</span>
                <small>RSI {item.rsi} · ADX {item.adx}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head"><span>WHY THIS SIGNAL?</span><span>{signal?.strategy_version ?? "v—"}</span></div>
          <ul className="reasons">{(signal?.reasons ?? ["Waiting for market data..."]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <div className="research-note">90%+ adalah target riset, bukan guaranteed win rate. NO TRADE diprioritaskan saat confluence tidak cukup.</div>
        </article>
      </section>

      <section className="panel history">
        <div className="panel-head"><span>SIGNAL HISTORY</span><span>Stored in this browser</span></div>
        {history.length === 0 ? <div className="empty">Belum ada BUY/SELL yang lolos high-precision filter.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Time</th><th>Signal</th><th>Confidence</th><th>Entry</th><th>SL</th><th>TP2</th><th>R:R</th></tr></thead><tbody>
            {history.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td><span className={`pill ${row.signal.toLowerCase()}`}>{row.signal}</span></td><td>{row.confidence}</td><td>{price(row.entry_price)}</td><td>{price(row.stop_loss)}</td><td>{price(row.take_profit_2)}</td><td>{row.risk_reward ? `1:${row.risk_reward}` : "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
