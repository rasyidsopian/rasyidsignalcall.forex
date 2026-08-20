"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CandleChart from "./CandleChart";
import {
  applyRealtimeTick,
  cacheMarketFrames,
  clearApiKey,
  connectRealtimeXauUsd,
  fetchAllTimeframes,
  getCachedFrames,
  getSavedApiKey,
  refreshFromOneMinute,
  saveApiKey,
  type MarketFrames,
  type StreamState,
} from "../lib/marketData";
import { backtestStrategy, generateSignal, matchingSetupStats } from "../lib/signalEngine";
import type { BacktestStats, Signal } from "../types";

type HistoryRow = Signal & { id: string; created_at: string };
type PendingFlip = { side: "BUY" | "SELL"; count: number; since: number; signal: Signal } | null;

function price(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function loadHistory(): HistoryRow[] {
  try { return JSON.parse(localStorage.getItem("xau_scalp_signal_history_v4") ?? "[]"); }
  catch { return []; }
}

function saveHistory(rows: HistoryRow[]) {
  localStorage.setItem("xau_scalp_signal_history_v4", JSON.stringify(rows.slice(0, 180)));
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [signal, setSignal] = useState<Signal | null>(null);
  const signalRef = useRef<Signal | null>(null);
  const [frames, setFrames] = useState<MarketFrames | null>(null);
  const framesRef = useRef<MarketFrames | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [backtest, setBacktest] = useState<BacktestStats | null>(null);
  const [setupStats, setSetupStats] = useState<BacktestStats | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("CLOSED");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const lastSignalCalcRef = useRef(0);
  const pendingFlipRef = useRef<PendingFlip>(null);

  useEffect(() => {
    const saved = getSavedApiKey();
    setApiKey(saved);
    setDraftKey(saved);
    setHistory(loadHistory());
  }, []);

  function publishSignal(next: Signal) {
    signalRef.current = next;
    setSignal(next);
  }

  function recalcResearch(nextFrames: MarketFrames, currentSignal?: Signal) {
    const bt = backtestStrategy(nextFrames.c1, nextFrames.c5, nextFrames.c15, nextFrames.c1h, nextFrames.c4h, 160);
    setBacktest(bt);
    const basis = currentSignal ?? signalRef.current;
    if (basis) setSetupStats(matchingSetupStats(bt, basis));
  }

  async function loadMarket(key: string) {
    setLoading(true);
    setReady(false);
    setError(null);
    try {
      const cached = getCachedFrames();
      // Cached startup costs only 1 REST call to fill the gap. True cold start costs 5 sequential calls.
      const nextFrames = cached ? await refreshFromOneMinute(key, cached) : await fetchAllTimeframes(key);
      framesRef.current = nextFrames;
      setFrames(nextFrames);
      const live = generateSignal(nextFrames.c1, nextFrames.c5, nextFrames.c15, nextFrames.c1h, nextFrames.c4h, Date.now(), true);
      publishSignal(live);
      recalcResearch(nextFrames, live);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Market data initialization error");
      setReady(false);
    } finally {
      setLoading(false);
    }
  }

  async function syncHistory() {
    const key = apiKey;
    const current = framesRef.current;
    if (!key || !current || loading) return;
    setLoading(true);
    try {
      const nextFrames = await refreshFromOneMinute(key, current);
      framesRef.current = nextFrames;
      setFrames(nextFrames);
      const live = generateSignal(nextFrames.c1, nextFrames.c5, nextFrames.c15, nextFrames.c1h, nextFrames.c4h, Date.now(), true);
      publishSignal(live);
      recalcResearch(nextFrames, live);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Historical sync failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!apiKey) return;
    framesRef.current = null;
    signalRef.current = null;
    pendingFlipRef.current = null;
    setFrames(null);
    setSignal(null);
    setBacktest(null);
    setSetupStats(null);
    setTickCount(0);
    void loadMarket(apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey || !ready || !framesRef.current) return;

    return connectRealtimeXauUsd(apiKey, {
      onState: setStreamState,
      onError: (message) => setError(message),
      onTick: (tick) => {
        const current = framesRef.current;
        if (!current) return;

        const previousMinute = current.c1.at(-1)?.timestamp;
        const nextFrames = applyRealtimeTick(current, tick);
        const nextMinute = nextFrames.c1.at(-1)?.timestamp;
        const minuteRolled = Boolean(previousMinute && nextMinute && previousMinute !== nextMinute);

        framesRef.current = nextFrames;
        setFrames(nextFrames);
        setLastTickAt(Date.now());
        setTickCount((n) => n + 1);
        setError(null);

        const now = performance.now();
        if (now - lastSignalCalcRef.current >= 100) {
          lastSignalCalcRef.current = now;
          try {
            const candidate = generateSignal(
              nextFrames.c1,
              nextFrames.c5,
              nextFrames.c15,
              nextFrames.c1h,
              nextFrames.c4h,
              tick.timestampMs,
              true,
            );
            const existing = signalRef.current;

            // Keep levels/confidence live when side is stable. Require a short confirmation before flipping side.
            if (!existing || existing.signal === candidate.signal) {
              pendingFlipRef.current = null;
              publishSignal(candidate);
            } else {
              const pending = pendingFlipRef.current;
              if (!pending || pending.side !== candidate.signal) {
                pendingFlipRef.current = { side: candidate.signal, count: 1, since: Date.now(), signal: candidate };
              } else {
                const updated = { ...pending, count: pending.count + 1, signal: candidate };
                pendingFlipRef.current = updated;
                if (updated.count >= 2 && Date.now() - updated.since >= 250) {
                  publishSignal(candidate);
                  pendingFlipRef.current = null;
                }
              }
            }
          } catch {
            // Keep the previous valid call while a just-opened candle lacks enough derived data.
          }
        }

        if (minuteRolled) {
          // Freeze one closed-candle call per minute for auditability, and refresh historical WR off closed bars only.
          try {
            const frozen = generateSignal(
              nextFrames.c1,
              nextFrames.c5,
              nextFrames.c15,
              nextFrames.c1h,
              nextFrames.c4h,
              tick.timestampMs,
              false,
            );
            const id = `${frozen.timestamp}-${frozen.signal}`;
            setHistory((previous) => {
              if (previous.some((row) => row.id === id)) return previous;
              const rows = [{ ...frozen, id, created_at: frozen.timestamp }, ...previous].slice(0, 180);
              saveHistory(rows);
              return rows;
            });
            recalcResearch(nextFrames, signalRef.current ?? frozen);
            cacheMarketFrames(nextFrames);
          } catch {
            // Research metrics remain at last completed snapshot if this minute is not evaluable yet.
          }
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, ready]);

  useEffect(() => {
    if (backtest && signal) setSetupStats(matchingSetupStats(backtest, signal));
  }, [backtest, signal]);

  const currentPrice = useMemo(() => frames?.c1.at(-1)?.close ?? signal?.entry_price ?? null, [frames, signal]);
  const tone = signal?.signal === "BUY" ? "buy" : "sell";
  const chartCandles = frames?.c1 ?? [];
  const sampleQuality = (setupStats?.sampleSize ?? 0) >= 30 ? "GOOD SAMPLE" : (setupStats?.sampleSize ?? 0) >= 12 ? "EARLY SAMPLE" : "LOW SAMPLE";
  const isLive = streamState === "LIVE";
  const tickAge = lastTickAt ? Math.max(0, (Date.now() - lastTickAt) / 1000) : null;

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
    setReady(false);
    setStreamState("CLOSED");
    setSignal(null);
    signalRef.current = null;
    setFrames(null);
    framesRef.current = null;
    setBacktest(null);
    setSetupStats(null);
    setLastTickAt(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RASYID SIGNAL CALL · REALTIME SCALPING V4</div>
          <h1>XAU/USD</h1>
          <div className="subline">4H/1H context → 15M setup → 5M + 1M micro execution · realtime WebSocket</div>
        </div>
        <div className={`status ${isLive ? "online" : "offline"}`}>
          <span /> {apiKey ? `WS ${streamState}` : "API KEY REQUIRED"}
        </div>
      </header>

      {!apiKey && (
        <section className="panel connect-panel">
          <div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div>
          <p>Masukkan API key Twelve Data. Untuk versi GitHub Pages, key tersimpan hanya di browser ini tetapi tetap dapat terlihat oleh JavaScript/network browser; gunakan hanya untuk dashboard personal.</p>
          <div className="connect-row">
            <input value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Paste Twelve Data API key" type="password" />
            <button onClick={connectKey}>CONNECT</button>
          </div>
        </section>
      )}

      {apiKey && (
        <div className="toolbar">
          <span>{lastTickAt ? `Last tick ${new Date(lastTickAt).toLocaleTimeString()} · ${tickAge?.toFixed(1)}s ago` : loading ? "Loading historical data..." : "Waiting for first live tick..."}</span>
          <span className="usage-note">WebSocket tick → chart immediately · signal recalc ≤100ms · REST only for history · ticks {tickCount}</span>
          <div>
            <button onClick={() => void syncHistory()} disabled={loading || !frames}>{loading ? "SYNCING..." : "SYNC HISTORY"}</button>
            <button onClick={disconnectKey}>CHANGE API KEY</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="hero-grid">
        <article className="panel market-panel">
          <div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>{isLive ? "● LIVE TICK · 1M" : "1M EXECUTION CHART"}</span></div>
          <div className="market-price">{price(currentPrice)} <small className={`live-tag ${isLive ? "on" : ""}`}>{isLive ? "STREAMING" : streamState}</small></div>
          <CandleChart candles={chartCandles} />
        </article>

        <aside className={`panel signal-panel ${tone}`}>
          <div className="panel-head"><span>MICRO SCALP CALL</span><span>{signal?.status ?? "WAITING"}</span></div>
          <div className="signal-name">{signal?.signal ?? "—"}</div>
          <div className="confidence"><span>{signal?.confidence ?? 0}</span><small>/100 micro confluence</small></div>
          <div className={`execution-box ${signal?.execution_mode === "ENTER_NOW" ? "ready" : "wait"}`}>
            <small>EXECUTION</small><strong>{signal?.execution_mode === "ENTER_NOW" ? "ENTER NOW" : "WAIT PULLBACK"}</strong>
            <span>Setup grade {signal?.setup_grade ?? "—"} · 5M/1M weighted 80%</span>
          </div>
          <div className="winrate-block">
            <div><small>HISTORICAL SETUP WR</small><strong>{percent(setupStats?.winRate)}</strong></div>
            <div><small>SAMPLE</small><strong>N={setupStats?.sampleSize ?? 0}</strong></div>
            <div className="sample-badge">{sampleQuality} · CLOSED-CANDLE TEST</div>
          </div>
          <div className="levels">
            <div><small>SUGGESTED ENTRY</small><strong>{price(signal?.entry_price)}</strong></div>
            <div><small>STOP LOSS</small><strong>{price(signal?.stop_loss)}</strong></div>
            <div><small>TP1 · ~1.6R</small><strong>{price(signal?.take_profit_1)}</strong></div>
            <div><small>TP2 · structure / ~2.2R</small><strong>{price(signal?.take_profit_2)}</strong></div>
          </div>
          <div className="rr"><span>R:R</span><strong>{signal?.risk_reward ? `1:${signal.risk_reward}` : "—"}</strong></div>
          <div className="regime"><small>5M MARKET REGIME</small><strong>{signal?.market_regime?.replaceAll("_", " ") ?? "—"}</strong><small>Risk distance {price(signal?.risk_distance)} · live {price(signal?.current_price)}</small></div>
        </aside>
      </section>

      <section className="stats-grid">
        <article className="panel metric-card">
          <div className="panel-head"><span>RECENT STRATEGY BACKTEST</span><span>CLOSED BARS ONLY</span></div>
          <div className="metric-main">{percent(backtest?.winRate)}</div>
          <div className="metric-caption">Executable entries only · TP1 before SL · max hold 15M · N={backtest?.sampleSize ?? 0}</div>
          <div className="mini-metrics">
            <span>WINS <strong>{backtest?.wins ?? 0}</strong></span>
            <span>LOSSES <strong>{backtest?.losses ?? 0}</strong></span>
            <span>PF <strong>{backtest?.profitFactor ?? "—"}</strong></span>
          </div>
        </article>

        <article className="panel metric-card">
          <div className="panel-head"><span>CURRENT SETUP MATCH</span><span>{signal?.signal ?? "—"}</span></div>
          <div className="metric-main">{percent(setupStats?.winRate)}</div>
          <div className="metric-caption">Similar historical calls · N={setupStats?.sampleSize ?? 0}</div>
          <div className="mini-metrics">
            <span>WINS <strong>{setupStats?.wins ?? 0}</strong></span>
            <span>LOSSES <strong>{setupStats?.losses ?? 0}</strong></span>
            <span>STATUS <strong>{sampleQuality}</strong></span>
          </div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-head"><span>LIVE TOP-DOWN ANALYSIS</span><span>HIGH → LOW</span></div>
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
            V4 memprioritaskan 5M + 1M untuk entry. Higher timeframe hanya konteks. Win rate historical hanya menghitung setup yang engine tandai ENTER NOW pada closed candles. Stop ditempatkan di luar micro swing/liquidity sweep dengan ATR buffer; ini mengurangi stop yang terlalu ketat tetapi tidak menjamin terhindar dari stop-out.
          </div>
        </article>
      </section>

      <section className="panel history">
        <div className="panel-head"><span>FROZEN 1M CALL HISTORY</span><span>V4 snapshots · stored in this browser</span></div>
        {history.length === 0 ? <div className="empty">Belum ada closed-minute call tersimpan.</div> : (
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
