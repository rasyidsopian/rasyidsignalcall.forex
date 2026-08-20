"use client";

import { useEffect, useMemo, useState } from "react";
import CandleChart from "./CandleChart";
import { getCandles, getHistory, getSignal, WS_URL } from "../lib/api";
import type { Candle, Signal } from "../types";

function price(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

export default function Dashboard() {
  const [signal, setSignal] = useState<Signal | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function hydrate() {
    try {
      const [s, c, h] = await Promise.all([getSignal(), getCandles(), getHistory()]);
      setSignal(s);
      setCandles(c);
      setHistory(h.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown API error");
    }
  }

  useEffect(() => {
    hydrate();
    const chartTimer = window.setInterval(() => getCandles().then(setCandles).catch(() => {}), 60_000);
    const ws = new WebSocket(`${WS_URL}/api/ws/signals`);
    ws.onopen = () => {
      setConnected(true);
      ws.send("ready");
    };
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.symbol === "XAU/USD") setSignal(payload);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    return () => {
      window.clearInterval(chartTimer);
      ws.close();
    };
  }, []);

  const currentPrice = useMemo(() => candles.at(-1)?.close ?? signal?.entry_price ?? null, [candles, signal]);
  const tone = signal?.signal === "BUY" ? "buy" : signal?.signal === "SELL" ? "sell" : "neutral";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RASYID SIGNAL CALL</div>
          <h1>XAU/USD</h1>
        </div>
        <div className={`status ${connected ? "online" : "offline"}`}>
          <span /> {connected ? "LIVE" : "RECONNECTING"}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="hero-grid">
        <article className="panel market-panel">
          <div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>15M</span></div>
          <div className="market-price">{price(currentPrice)}</div>
          <CandleChart candles={candles} />
        </article>

        <aside className={`panel signal-panel ${tone}`}>
          <div className="panel-head"><span>CURRENT SIGNAL</span><span>{signal?.status ?? "LOADING"}</span></div>
          <div className="signal-name">{signal?.signal?.replace("_", " ") ?? "—"}</div>
          <div className="confidence">
            <span>{signal?.confidence ?? 0}</span><small>/100 confidence</small>
          </div>
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
          <ul className="reasons">
            {(signal?.reasons ?? ["Waiting for analysis..."]).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <div className="research-note">90%+ is a research target, not a guaranteed win rate. NO TRADE is preferred when confluence is insufficient.</div>
        </article>
      </section>

      <section className="panel history">
        <div className="panel-head"><span>SIGNAL HISTORY</span><span>Issued BUY/SELL only</span></div>
        {history.length === 0 ? (
          <div className="empty">No qualifying signal has been issued yet.</div>
        ) : (
          <div className="table-wrap"><table><thead><tr><th>Time</th><th>Signal</th><th>Confidence</th><th>Entry</th><th>SL</th><th>TP2</th><th>R:R</th></tr></thead><tbody>
          {history.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td><span className={`pill ${row.signal.toLowerCase()}`}>{row.signal}</span></td><td>{row.confidence}</td><td>{price(row.entry_price)}</td><td>{price(row.stop_loss)}</td><td>{price(row.take_profit_2)}</td><td>{row.risk_reward ? `1:${row.risk_reward}` : "—"}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
