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
import {
  backtestTightScalp,
  buildDailySetup,
  buildPredictions,
  buildScalpingSetup,
  DEFAULT_ACCOUNT,
  type AccountConfig,
  type HorizonPrediction,
  type TradeSetup,
} from "../lib/strategyV6";
import type { BacktestStats } from "../types";

type FrozenRow = {
  id: string;
  at: string;
  side: "BUY" | "SELL";
  action: string;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  confidence: number;
};

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const px = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
const pct = (v: number | null | undefined) => v == null ? "—" : `${v.toFixed(1)}%`;

function loadAccount(): AccountConfig {
  try {
    const saved = JSON.parse(localStorage.getItem("xau_v6_account") ?? "null");
    return saved ? { ...DEFAULT_ACCOUNT, ...saved } : DEFAULT_ACCOUNT;
  } catch { return DEFAULT_ACCOUNT; }
}
function loadHistory(): FrozenRow[] {
  try { return JSON.parse(localStorage.getItem("xau_v6_history") ?? "[]"); } catch { return []; }
}

function RiskLine({ setup }: { setup: TradeSetup | null }) {
  if (!setup) return null;
  const risk = setup.risk;
  return (
    <div className={`risk-gate ${risk.action === "ENTER_NOW" ? "pass" : risk.action === "SKIP_RISK" ? "fail" : "wait"}`}>
      <strong>{setup.status}</strong>
      <span>{risk.message}</span>
      <small>
        Risk {money.format(risk.riskIdr)} ({risk.riskPct.toFixed(1)}%) · max {risk.maxRiskPct.toFixed(1)}% · blended R:R 1:{risk.blendedRewardR.toFixed(2)}
      </small>
    </div>
  );
}

function SetupCard({ title, setup, showRisk = true, tight = true }: { title: string; setup: TradeSetup | null; showRisk?: boolean; tight?: boolean }) {
  const tone = setup?.side.toLowerCase() ?? "neutral";
  return (
    <article className={`panel setup-card ${tone}`}>
      <div className="panel-head"><span>{title}</span><span>{setup?.status ?? "WAITING"}</span></div>
      <div className="setup-call"><strong>{setup?.side ?? "—"}</strong><span>{setup?.confidence ?? 0}/100 confluence</span></div>
      {showRisk && <RiskLine setup={setup} />}
      {tight ? <div className="levels compact">
        <div><small>ENTRY / PLAN</small><strong>{px(setup?.entry)}</strong></div>
        <div><small>ENTRY ZONE</small><strong>{setup ? `${px(setup.entryZoneLow)} – ${px(setup.entryZoneHigh)}` : "—"}</strong></div>
        <div><small>STOP · {setup?.stopPips?.toFixed(1) ?? "—"} PIPS</small><strong>{px(setup?.stop)}</strong></div>
        <div><small>MAX STOP</small><strong>{setup?.maxStopPips?.toFixed(1) ?? "—"} pips</strong></div>
        <div><small>POS #1 TP · {setup?.rr1?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp1)}</strong></div>
        <div><small>POS #2 TP · {setup?.rr2?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp2)}</strong></div>
      </div> : <div className="levels compact">
        <div><small>ENTRY</small><strong>{px(setup?.entry)}</strong></div>
        <div><small>STOP</small><strong>{px(setup?.stop)}</strong></div>
        <div><small>TP1 · {setup?.rr1?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp1)}</strong></div>
        <div><small>TP2 · {setup?.rr2?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp2)}</strong></div>
      </div>}
      <div className="be-note"><strong>BE rule</strong><span>{setup?.beRule ?? "—"}</span></div>
    </article>
  );
}

function PredictionCard({ row }: { row: HorizonPrediction }) {
  return (
    <div className={`prediction ${row.bias.toLowerCase()}`}>
      <div><strong>{row.minutes} MIN</strong><span className={`pill ${row.bias.toLowerCase()}`}>{row.bias}</span></div>
      <b>{row.edgeScore}/100 edge</b>
      <strong className="prediction-action">{row.action}</strong>
      <small>Entry zone {px(row.entryZoneLow)} – {px(row.entryZoneHigh)}</small>
      <small>SL {px(row.stop)} · TP1 {px(row.tp1)} · TP2 {px(row.tp2)} · R:R 1:{row.rr.toFixed(1)}</small>
      <small>Projected {px(row.projectedLow)} – {px(row.projectedHigh)} · {row.alignment}</small>
    </div>
  );
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [frames, setFrames] = useState<MarketFrames | null>(null);
  const framesRef = useRef<MarketFrames | null>(null);
  const [scalp, setScalp] = useState<TradeSetup | null>(null);
  const scalpRef = useRef<TradeSetup | null>(null);
  const [daily, setDaily] = useState<TradeSetup | null>(null);
  const [predictions, setPredictions] = useState<HorizonPrediction[]>([]);
  const [account, setAccount] = useState<AccountConfig>(DEFAULT_ACCOUNT);
  const [backtest, setBacktest] = useState<BacktestStats | null>(null);
  const [setupStats, setSetupStats] = useState<BacktestStats | null>(null);
  const [history, setHistory] = useState<FrozenRow[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("CLOSED");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [engineLatencyMs, setEngineLatencyMs] = useState<number | null>(null);
  const [providerTickMs, setProviderTickMs] = useState<number | null>(null);
  const lastDailyCalcRef = useRef(0);

  useEffect(() => {
    const key = getSavedApiKey();
    setApiKey(key); setDraftKey(key);
    setAccount(loadAccount()); setHistory(loadHistory());
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("xau_v6_account", JSON.stringify(account)); } catch {}
    const f = framesRef.current;
    if (f) recalcAll(f, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  function recalcResearch(next: MarketFrames) {
    try {
      const bt = backtestTightScalp(next, account, 120);
      setBacktest(bt);
      const recent = bt.trades.slice(-40);
      const wins = recent.filter((t) => t.result === "WIN").length;
      const losses = recent.filter((t) => t.result === "LOSS").length;
      const sampleSize = wins + losses;
      setSetupStats({
        winRate: sampleSize ? Math.round(wins / sampleSize * 1000) / 10 : null,
        wins, losses, sampleSize,
        profitFactor: losses ? Math.round((wins * 1.8 / losses) * 100) / 100 : wins ? 99 : null,
        averageRiskReward: recent.length ? Math.round(recent.reduce((s, t) => s + t.riskReward, 0) / recent.length * 100) / 100 : null,
        trades: recent,
      });
    } catch {}
  }

  function recalcAll(next: MarketFrames, includeDaily = false, nowMs = Date.now()) {
    try {
      const s = buildScalpingSetup(next, account, nowMs);
      scalpRef.current = s; setScalp(s);
      setPredictions(buildPredictions(next, s));
    } catch {}
    if (includeDaily || nowMs - lastDailyCalcRef.current > 15_000) {
      lastDailyCalcRef.current = nowMs;
      try { setDaily(buildDailySetup(next, account, nowMs)); } catch {}
    }
  }

  async function loadMarket(key: string) {
    setLoading(true); setReady(false); setError(null);
    try {
      const cached = getCachedFrames();
      const next = cached ? await refreshFromOneMinute(key, cached) : await fetchAllTimeframes(key);
      framesRef.current = next; setFrames(next);
      recalcAll(next, true); recalcResearch(next);
      setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Market data initialization error"); }
    finally { setLoading(false); }
  }

  async function syncHistory() {
    if (!apiKey || !framesRef.current || loading) return;
    setLoading(true);
    try {
      const next = await refreshFromOneMinute(apiKey, framesRef.current);
      framesRef.current = next; setFrames(next); recalcAll(next, true); recalcResearch(next); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Historical sync failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!apiKey) return;
    setFrames(null); framesRef.current = null; setReady(false); setTickCount(0);
    void loadMarket(apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey || !ready || !framesRef.current) return;
    return connectRealtimeXauUsd(apiKey, {
      onState: setStreamState,
      onError: setError,
      onTick: (tick) => {
        const current = framesRef.current;
        if (!current) return;
        const prevMinute = current.c1.at(-1)?.timestamp;
        const next = applyRealtimeTick(current, tick);
        const nextMinute = next.c1.at(-1)?.timestamp;
        const minuteRolled = Boolean(prevMinute && nextMinute && prevMinute !== nextMinute);
        framesRef.current = next;
        setFrames(next); // chart hot-path updates immediately on EVERY provider tick
        setLastTickAt(Date.now()); setTickCount((n) => n + 1); setError(null);

        const perf0 = performance.now();
        recalcAll(next, minuteRolled, tick.timestampMs); // V6: no 35ms throttle; every received provider tick is analyzed.
        setEngineLatencyMs(Math.round((performance.now() - perf0) * 10) / 10);
        setProviderTickMs(tick.timestampMs);
        if (minuteRolled) {
          cacheMarketFrames(next); recalcResearch(next);
          const frozen = scalpRef.current;
          if (frozen) {
            const row: FrozenRow = {
              id: `${nextMinute}-${frozen.side}`,
              at: nextMinute!, side: frozen.side, action: frozen.status,
              entry: frozen.entry, stop: frozen.stop, tp1: frozen.tp1, tp2: frozen.tp2,
              riskPct: frozen.risk.riskPct, confidence: frozen.confidence,
            };
            setHistory((old) => {
              if (old.some((x) => x.id === row.id)) return old;
              const rows = [row, ...old].slice(0, 120);
              try { localStorage.setItem("xau_v6_history", JSON.stringify(rows)); } catch {}
              return rows;
            });
          }
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, ready, account]);

  const currentPrice = frames?.c1.at(-1)?.close ?? scalp?.entry ?? null;
  const tickAge = lastTickAt ? Math.max(0, (clock - lastTickAt) / 1000) : null;
  const isSaturday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "short" }).format(new Date(clock)) === "Sat";
  const stale = tickAge != null && tickAge > 3;
  const providerAgeMs = providerTickMs ? Math.max(0, Date.now() - providerTickMs) : null;
  const formatWib = (ms: number) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(ms)) + " WIB";
  const sampleQuality = (setupStats?.sampleSize ?? 0) >= 40 ? "GOOD SAMPLE" : (setupStats?.sampleSize ?? 0) >= 15 ? "EARLY SAMPLE" : "LOW SAMPLE";

  function connectKey() {
    const key = draftKey.trim(); if (!key) return;
    saveApiKey(key); setApiKey(key);
  }
  function disconnectKey() {
    clearApiKey(); setApiKey(""); setDraftKey(""); setReady(false); setFrames(null); framesRef.current = null; setScalp(null); setDaily(null); setPredictions([]);
  }
  function updateAccount<K extends keyof AccountConfig>(key: K, value: number) {
    setAccount((a) => ({ ...a, [key]: Number.isFinite(value) ? value : a[key] }));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="eyebrow">RASYID SIGNAL CALL · XAUUSD V6 TIGHT SCALP</div><h1>XAU/USD</h1><div className="subline">Predictive micro-entry · max 25-pip SL · 1M/5M execution · WIB realtime clock</div></div>
        <div className={`status ${streamState === "LIVE" && !stale ? "online" : "offline"}`}><span />{apiKey ? `WS ${streamState}${stale ? " · STALE" : ""}` : "API KEY REQUIRED"}</div>
      </header>

      {isSaturday && <div className="weekend-banner"><strong>SATURDAY MODE</strong><span>Standard XAU/USD umumnya tutup Sabtu. Dashboard memakai Friday-close data untuk preparation; live entry hanya valid bila broker/feed benar-benar mengirim tick.</span></div>}

      {!apiKey && <section className="panel connect-panel"><div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div><p>API key disimpan lokal di browser untuk dashboard personal.</p><div className="connect-row"><input type="password" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Paste Twelve Data API key"/><button onClick={connectKey}>CONNECT</button></div></section>}

      {apiKey && <div className="toolbar"><span>{lastTickAt ? `Last tick ${formatWib(lastTickAt)} · ${tickAge?.toFixed(1)}s ago` : loading ? "Loading history..." : "Waiting tick..."}</span><span className="usage-note">Every provider tick → chart + signal · engine {engineLatencyMs == null ? "—" : `${engineLatencyMs.toFixed(1)}ms`} · feed age {providerAgeMs == null ? "—" : `${providerAgeMs}ms`} · ticks {tickCount}</span><div><button onClick={() => void syncHistory()} disabled={loading}>{loading ? "SYNCING..." : "SYNC HISTORY"}</button><button onClick={disconnectKey}>CHANGE API KEY</button></div></div>}
      {error && <div className="error">{error}</div>}

      <section className="hero-grid v5-hero">
        <article className="panel market-panel"><div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>● LIVE TICK · 1M · WIB</span></div><div className="market-price">{px(currentPrice)} <small className={`live-tag ${streamState === "LIVE" && !stale ? "on" : ""}`}>{streamState === "LIVE" && !stale ? "STREAMING" : stale ? "STALE FEED" : streamState}</small></div><CandleChart candles={frames?.c1 ?? []}/></article>
        <div className="side-stack"><SetupCard title="PREDICTIVE SCALP · 1M + 5M" setup={scalp}/><SetupCard title="DAILY SETUP · 4H + 1H + 15M" setup={daily} tight={false}/></div>
      </section>

      <section className="panel account-panel">
        <div className="panel-head"><span>ACCOUNT + TIGHT STOP ENGINE</span><span>DEFAULT: Rp1.000.000 · 2 × 0.01 LOT · MAX 25 PIPS</span></div>
        <div className="account-grid">
          <label>Balance IDR<input type="number" value={account.balanceIdr} onChange={(e) => updateAccount("balanceIdr", Number(e.target.value))}/></label>
          <label>Positions<input type="number" min="1" step="1" value={account.positions} onChange={(e) => updateAccount("positions", Number(e.target.value))}/></label>
          <label>Lot / position<input type="number" step="0.001" value={account.lotPerPosition} onChange={(e) => updateAccount("lotPerPosition", Number(e.target.value))}/></label>
          <label>Contract oz / 1 lot<input type="number" value={account.contractSizeOz} onChange={(e) => updateAccount("contractSizeOz", Number(e.target.value))}/></label>
          <label>USD/IDR estimate<input type="number" value={account.usdIdr} onChange={(e) => updateAccount("usdIdr", Number(e.target.value))}/></label>
          <label>Broker pip size<input type="number" step="0.01" value={account.pipSize} onChange={(e) => updateAccount("pipSize", Number(e.target.value))}/></label>
          <label>Max scalp SL (pips)<input type="number" step="1" value={account.maxScalpStopPips} onChange={(e) => updateAccount("maxScalpStopPips", Number(e.target.value))}/></label>
          <label>Target risk % total<input type="number" step="0.1" value={account.scalpTargetRiskPct} onChange={(e) => updateAccount("scalpTargetRiskPct", Number(e.target.value))}/></label>
        </div>
        <div className="risk-warning">V6 menggeser predictive ENTRY ZONE mendekati micro structure agar SL muat di saldo + cap 25 pips. Default pip size 0.01 mengikuti quote 2-desimal; ubah kalau definisi pip broker lo berbeda. Engine tidak menjanjikan 25 pips selalu aman dari noise/spread.</div>
      </section>

      <section className="panel prediction-panel">
        <div className="panel-head"><span>PREDICTIVE CALL · 1 / 5 / 10 MIN</span><span>ENTRY ZONE + MAX-SL PLAN · NOT GUARANTEED PROBABILITY</span></div>
        <div className="prediction-grid">{predictions.length ? predictions.map((p) => <PredictionCard key={p.minutes} row={p}/>) : <div className="empty">Waiting for market data...</div>}</div>
      </section>

      <section className="stats-grid">
        <article className="panel metric-card"><div className="panel-head"><span>RECENT 40 V6 CALLS</span><span>≤25-PIP EXECUTABLE CALLS</span></div><div className="metric-main">{pct(setupStats?.winRate)}</div><div className="metric-caption">Recent tight-SL sample · TP1 1.8R before SL · N={setupStats?.sampleSize ?? 0} · {sampleQuality}</div><div className="mini-metrics"><span>WINS <strong>{setupStats?.wins ?? 0}</strong></span><span>LOSSES <strong>{setupStats?.losses ?? 0}</strong></span><span>PF <strong>{setupStats?.profitFactor ?? "—"}</strong></span></div></article>
        <article className="panel metric-card"><div className="panel-head"><span>FULL V6 BACKTEST</span><span>TIGHT STOP SAMPLE</span></div><div className="metric-main">{pct(backtest?.winRate)}</div><div className="metric-caption">Full V6 closed-bar backtest · N={backtest?.sampleSize ?? 0}</div><div className="mini-metrics"><span>WINS <strong>{backtest?.wins ?? 0}</strong></span><span>LOSSES <strong>{backtest?.losses ?? 0}</strong></span><span>AVG RR <strong>{backtest?.averageRiskReward ?? "—"}</strong></span></div></article>
      </section>

      <section className="lower-grid">
        <article className="panel"><div className="panel-head"><span>TOP-DOWN MARKET MAP</span><span>4H → 1M</span></div><div className="timeframes">{scalp?.timeframeAnalysis.map((row) => <div className="tf-row" key={row.timeframe}><strong>{row.timeframe.toUpperCase()}</strong><span className={`pill ${row.bias.toLowerCase()}`}>{row.bias}</span><span>{row.score}/100</span><small>Net {row.directionalScore > 0 ? "+" : ""}{row.directionalScore} · RSI {row.rsi} · ADX {row.adx}</small></div>)}</div></article>
        <article className="panel"><div className="panel-head"><span>WHY / WHY NOT ENTRY?</span><span>V6</span></div><ul className="reasons">{(scalp?.reasons ?? ["Waiting for data..."]).map((r) => <li key={r}>{r}</li>)}</ul><div className="research-note">V6 selalu memberi predictive direction + entry zone, tetapi ENTER NOW hanya muncul saat harga sudah berada di micro zone, 1M/5M align, momentum tidak overextended, dan SL tetap ≤ cap saldo/pip.</div></article>
      </section>

      <section className="panel history"><div className="panel-head"><span>FROZEN 1M DECISIONS</span><span>browser-local</span></div>{!history.length ? <div className="empty">Belum ada minute snapshot.</div> : <div className="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Action</th><th>Conf</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>Risk%</th></tr></thead><tbody>{history.map((r) => <tr key={r.id}><td>{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "medium" }).format(new Date(r.at)) + " WIB"}</td><td><span className={`pill ${r.side.toLowerCase()}`}>{r.side}</span></td><td>{r.action}</td><td>{r.confidence}</td><td>{px(r.entry)}</td><td>{px(r.stop)}</td><td>{px(r.tp1)}</td><td>{px(r.tp2)}</td><td>{r.riskPct.toFixed(1)}%</td></tr>)}</tbody></table></div>}</section>
    </main>
  );
}
