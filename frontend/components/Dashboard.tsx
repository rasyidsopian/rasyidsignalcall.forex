"use client";

import { useEffect, useRef, useState } from "react";
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
  backtestDailyMapped,
  backtestTightScalp,
  buildDailySetup,
  buildPredictions,
  buildScalpingSetup,
  fastUpdateSetupForPrice,
  DEFAULT_ACCOUNT,
  type AccountConfig,
  type HorizonPrediction,
  type TradeSetup,
} from "../lib/strategyV7";
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
    const saved = JSON.parse(localStorage.getItem("xau_v7_account") ?? "null");
    return saved ? { ...DEFAULT_ACCOUNT, ...saved } : DEFAULT_ACCOUNT;
  } catch { return DEFAULT_ACCOUNT; }
}
function loadHistory(): FrozenRow[] {
  try { return JSON.parse(localStorage.getItem("xau_v7_history") ?? "[]"); } catch { return []; }
}

function RiskLine({ setup }: { setup: TradeSetup | null }) {
  if (!setup) return null;
  const risk = setup.risk;
  return (
    <div className={`risk-gate ${risk.action === "ENTER_NOW" ? "pass" : risk.action === "SKIP_RISK" ? "fail" : "wait"}`}>
      <strong>{setup.status}</strong>
      <span>{risk.message}</span>
      <small>
        Total risk {money.format(risk.riskIdr)} ({risk.riskPct.toFixed(1)}%) · budget {risk.maxRiskPct.toFixed(1)}% · blended R:R 1:{risk.blendedRewardR.toFixed(2)}
      </small>
    </div>
  );
}

function SetupCard({ title, setup }: { title: string; setup: TradeSetup | null }) {
  const tone = setup?.side.toLowerCase() ?? "neutral";
  return (
    <article className={`panel setup-card ${tone}`}>
      <div className="panel-head"><span>{title}</span><span>{setup?.status ?? "WAITING"}</span></div>
      <div className="setup-call">
        <strong>{setup?.side ?? "—"}</strong>
        <span>{setup ? `${setup.zoneGrade} ZONE · ${setup.zoneScore}/100 · conf ${setup.confidence}/100` : "0/100"}</span>
      </div>
      <RiskLine setup={setup} />
      <div className="levels compact">
        <div><small>EXACT ENTRY</small><strong>{px(setup?.exactEntry)}</strong></div>
        <div><small>ENTRY ZONE</small><strong>{setup ? `${px(setup.entryZoneLow)} – ${px(setup.entryZoneHigh)}` : "—"}</strong></div>
        <div><small>STOP · {setup?.stopPips?.toFixed(1) ?? "—"} PIPS</small><strong>{px(setup?.stop)}</strong></div>
        <div><small>EFFECTIVE MAX STOP</small><strong>{setup?.maxStopPips?.toFixed(1) ?? "—"} pips</strong></div>
        <div><small>POS #1 TP · {setup?.rr1?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp1)}</strong></div>
        <div><small>POS #2 TP · {setup?.rr2?.toFixed(1) ?? "—"}R</small><strong>{px(setup?.tp2)}</strong></div>
      </div>
      {setup && <div className="zone-map-line">
        <strong>MAPPED ZONE</strong><span>{setup.zoneSource}</span>
        <small>FIB 50 {px(setup.fib.fib50)} · 61.8 {px(setup.fib.fib618)} · 70.5 {px(setup.fib.fib705)}</small>
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
      <small><b>Exact entry {px(row.exactEntry)}</b> · zone {px(row.entryZoneLow)} – {px(row.entryZoneHigh)}</small>
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
  const [dailyBacktest, setDailyBacktest] = useState<BacktestStats | null>(null);
  const [setupStats, setSetupStats] = useState<BacktestStats | null>(null);
  const [history, setHistory] = useState<FrozenRow[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("CLOSED");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [pipelineLatencyMs, setPipelineLatencyMs] = useState<number | null>(null);
  const [analysisLatencyMs, setAnalysisLatencyMs] = useState<number | null>(null);
  const [sourceTimestampGapMs, setSourceTimestampGapMs] = useState<number | null>(null);
  const [tickGapMs, setTickGapMs] = useState<number | null>(null);
  const lastTickWallRef = useRef<number | null>(null);
  const lastDailyCalcRef = useRef(0);

  useEffect(() => {
    const key = getSavedApiKey();
    setApiKey(key); setDraftKey(key);
    setAccount(loadAccount()); setHistory(loadHistory());
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("xau_v7_account", JSON.stringify(account)); } catch {}
    const f = framesRef.current;
    if (f) recalcAll(f, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  function recalcResearch(next: MarketFrames) {
    try {
      const bt = backtestTightScalp(next, account, 140);
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
    try { setDailyBacktest(backtestDailyMapped(next, account, 80)); } catch {}
  }

  function recalcAll(next: MarketFrames, includeDaily = false, nowMs = Date.now()) {
    try {
      const s = buildScalpingSetup(next, account, nowMs);
      scalpRef.current = s; setScalp(s);
      setPredictions(buildPredictions(next, s));
    } catch {}
    // Keep DAILY calculation out of the hot tick path. It only runs on initialization/manual sync/minute roll.
    if (includeDaily) {
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

        // V7 two-speed engine:
        // 1) O(1) execution path immediately updates chart + ENTER/WAIT state from the already-validated zone.
        // 2) Deep Fibonacci/liquidity/indicator remap runs right after, outside the measured hot path.
        const priorSetup = scalpRef.current;
        if (priorSetup) {
          const fastSetup = fastUpdateSetupForPrice(priorSetup, tick.price, account);
          scalpRef.current = fastSetup;
          setScalp(fastSetup);
        }
        setFrames(next);
        setLastTickAt(tick.receivedAtMs);
        setTickCount((n) => n + 1);
        setError(null);

        const hotElapsed = performance.now() - tick.receivedPerfMs;
        setPipelineLatencyMs(Math.round(hotElapsed * 10) / 10);
        if (tick.sourceTimestampMs != null) setSourceTimestampGapMs(Math.max(0, tick.receivedAtMs - tick.sourceTimestampMs));
        if (lastTickWallRef.current != null) setTickGapMs(Math.max(0, tick.receivedAtMs - lastTickWallRef.current));
        lastTickWallRef.current = tick.receivedAtMs;

        window.setTimeout(() => {
          const deep0 = performance.now();
          try {
            const s = buildScalpingSetup(next, account, tick.receivedAtMs);
            scalpRef.current = s;
            setScalp(s);
            setPredictions(buildPredictions(next, s));
          } catch {}
          setAnalysisLatencyMs(Math.round((performance.now() - deep0) * 10) / 10);
        }, 0);

        if (minuteRolled) {
          const frozen = scalpRef.current;
          if (frozen) {
            const row: FrozenRow = {
              id: `${nextMinute}-${frozen.side}`,
              at: nextMinute!, side: frozen.side, action: frozen.status,
              entry: frozen.exactEntry, stop: frozen.stop, tp1: frozen.tp1, tp2: frozen.tp2,
              riskPct: frozen.risk.riskPct, confidence: frozen.confidence,
            };
            setHistory((old) => {
              if (old.some((x) => x.id === row.id)) return old;
              const rows = [row, ...old].slice(0, 120);
              try { localStorage.setItem("xau_v7_history", JSON.stringify(rows)); } catch {}
              return rows;
            });
          }
          // Defer non-scalp work so the just-received price event is never held up by daily/backtest/cache work.
          window.setTimeout(() => {
            try { setDaily(buildDailySetup(next, account, tick.receivedAtMs)); } catch {}
            cacheMarketFrames(next);
          }, 0);
          const runResearch = () => recalcResearch(next);
          const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
          if (typeof idle === "function") idle(runResearch);
          else window.setTimeout(runResearch, 250);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, ready, account]);

  const currentPrice = frames?.c1.at(-1)?.close ?? scalp?.exactEntry ?? null;
  const tickAge = lastTickAt ? Math.max(0, (clock - lastTickAt) / 1000) : null;
  const isSaturday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "short" }).format(new Date(clock)) === "Sat";
  const stale = tickAge != null && tickAge > 3;
  const formatWib = (ms: number) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false }).format(new Date(ms)) + " WIB";
  const sampleQuality = (setupStats?.sampleSize ?? 0) >= 40 ? "GOOD SAMPLE" : (setupStats?.sampleSize ?? 0) >= 15 ? "EARLY SAMPLE" : "LOW SAMPLE";
  const pipRiskTotalIdr = account.pipSize * account.contractSizeOz * account.lotPerPosition * account.positions * account.usdIdr;

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
        <div><div className="eyebrow">RASYID SIGNAL CALL · XAUUSD V7 MAPPED ENTRY</div><h1>XAU/USD</h1><div className="subline">Fibonacci + liquidity + predictive zones · exact entry/SL · account-capped daily & scalp</div></div>
        <div className={`status ${streamState === "LIVE" && !stale ? "online" : "offline"}`}><span />{apiKey ? `WS ${streamState}${stale ? " · NO NEW TICK" : ""}` : "API KEY REQUIRED"}</div>
      </header>

      {isSaturday && <div className="weekend-banner"><strong>SATURDAY MODE</strong><span>V7 tidak otomatis memblokir entry hari Sabtu. Eksekusi cuma dianggap live kalau WebSocket benar-benar mengirim tick; cek juga apakah broker lo memang membuka XAU/USD weekend.</span></div>}

      {!apiKey && <section className="panel connect-panel"><div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div><p>API key disimpan lokal di browser untuk dashboard personal.</p><div className="connect-row"><input type="password" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Paste Twelve Data API key"/><button onClick={connectKey}>CONNECT</button></div></section>}

      {apiKey && <div className="toolbar"><span>{lastTickAt ? `Last tick ${formatWib(lastTickAt)} · ${tickAge?.toFixed(2)}s ago` : loading ? "Loading history..." : "Waiting tick..."}</span><span className="usage-note">HOT PATH {pipelineLatencyMs == null ? "—" : `${pipelineLatencyMs.toFixed(1)}ms${pipelineLatencyMs <= 10 ? " ✓" : " >10ms"}`} · deep map {analysisLatencyMs == null ? "—" : `${analysisLatencyMs.toFixed(1)}ms`} · event gap {tickGapMs == null ? "—" : `${tickGapMs}ms`} · provider timestamp gap {sourceTimestampGapMs == null ? "—" : `${sourceTimestampGapMs}ms`} · ticks {tickCount}</span><div><button onClick={() => void syncHistory()} disabled={loading}>{loading ? "SYNCING..." : "SYNC HISTORY"}</button><button onClick={disconnectKey}>CHANGE API KEY</button></div></div>}
      {error && <div className="error">{error}</div>}

      <section className="hero-grid v5-hero">
        <article className="panel market-panel"><div className="panel-head"><span>Gold Spot / U.S. Dollar</span><span>● LIVE TICK · 1M · WIB</span></div><div className="market-price">{px(currentPrice)} <small className={`live-tag ${streamState === "LIVE" && !stale ? "on" : ""}`}>{streamState === "LIVE" && !stale ? "STREAMING" : stale ? "WAITING PROVIDER EVENT" : streamState}</small></div><CandleChart candles={frames?.c1 ?? []} scalp={scalp} daily={daily}/></article>
        <div className="side-stack"><SetupCard title="SCALP MAPPED SETUP · 1M + 5M" setup={scalp}/><SetupCard title="DAILY PREDICTIVE SETUP · 15M + 1H" setup={daily}/></div>
      </section>

      <section className="panel account-panel">
        <div className="panel-head"><span>ACCOUNT + PIP / RISK ENGINE</span><span>DEFAULT: Rp1.000.000 · 2 × 0.01 LOT</span></div>
        <div className="account-grid">
          <label>Balance IDR<input type="number" value={account.balanceIdr} onChange={(e) => updateAccount("balanceIdr", Number(e.target.value))}/></label>
          <label>Positions<input type="number" min="1" step="1" value={account.positions} onChange={(e) => updateAccount("positions", Number(e.target.value))}/></label>
          <label>Lot / position<input type="number" step="0.001" value={account.lotPerPosition} onChange={(e) => updateAccount("lotPerPosition", Number(e.target.value))}/></label>
          <label>Contract oz / 1 lot<input type="number" value={account.contractSizeOz} onChange={(e) => updateAccount("contractSizeOz", Number(e.target.value))}/></label>
          <label>USD/IDR estimate<input type="number" value={account.usdIdr} onChange={(e) => updateAccount("usdIdr", Number(e.target.value))}/></label>
          <label>Pip size ($ price)<input type="number" step="0.01" value={account.pipSize} onChange={(e) => updateAccount("pipSize", Number(e.target.value))}/></label>
          <label>Max scalp SL (pips)<input type="number" step="1" value={account.maxScalpStopPips} onChange={(e) => updateAccount("maxScalpStopPips", Number(e.target.value))}/></label>
          <label>Max daily SL (pips)<input type="number" step="1" value={account.maxDailyStopPips} onChange={(e) => updateAccount("maxDailyStopPips", Number(e.target.value))}/></label>
          <label>Scalp target risk %<input type="number" step="0.1" value={account.scalpTargetRiskPct} onChange={(e) => updateAccount("scalpTargetRiskPct", Number(e.target.value))}/></label>
          <label>Daily target risk %<input type="number" step="0.1" value={account.dailyTargetRiskPct} onChange={(e) => updateAccount("dailyTargetRiskPct", Number(e.target.value))}/></label>
        </div>
        <div className="risk-warning">Pip convention lo sekarang dikunci default <b>1 pip = $0.10 movement</b>, jadi <b>25 pips = $2.50 movement</b>. Dengan 2 × 0.01 lot dan contract 100 oz, 1 pip total ≈ {money.format(pipRiskTotalIdr)} dan 25 pips ≈ {money.format(pipRiskTotalIdr * 25)} total risk pada USD/IDR sekarang. Setup V7 menyesuaikan entry zone ke risk budget; daily nggak boleh lagi bikin risk &gt;100%.</div>
      </section>

      <section className="panel prediction-panel">
        <div className="panel-head"><span>PREDICTIVE CALL · 1 / 5 / 10 MIN</span><span>EXACT ENTRY + ZONE + SL/TP · NO EXTRA WAIT INSIDE ZONE</span></div>
        <div className="prediction-grid">{predictions.length ? predictions.map((p) => <PredictionCard key={p.minutes} row={p}/>) : <div className="empty">Waiting for market data...</div>}</div>
      </section>

      <section className="stats-grid v7-stats">
        <article className="panel metric-card"><div className="panel-head"><span>RECENT 40 V7 SCALPS</span><span>MAPPED ZONE ONLY</span></div><div className="metric-main">{pct(setupStats?.winRate)}</div><div className="metric-caption">Recent executable mapped-zone sample · TP1 1.8R before SL · N={setupStats?.sampleSize ?? 0} · {sampleQuality}</div><div className="mini-metrics"><span>WINS <strong>{setupStats?.wins ?? 0}</strong></span><span>LOSSES <strong>{setupStats?.losses ?? 0}</strong></span><span>PF <strong>{setupStats?.profitFactor ?? "—"}</strong></span></div></article>
        <article className="panel metric-card"><div className="panel-head"><span>FULL V7 SCALP BACKTEST</span><span>FIB + LIQUIDITY MAP</span></div><div className="metric-main">{pct(backtest?.winRate)}</div><div className="metric-caption">Closed-bar backtest · N={backtest?.sampleSize ?? 0}</div><div className="mini-metrics"><span>WINS <strong>{backtest?.wins ?? 0}</strong></span><span>LOSSES <strong>{backtest?.losses ?? 0}</strong></span><span>AVG RR <strong>{backtest?.averageRiskReward ?? "—"}</strong></span></div></article>
        <article className="panel metric-card"><div className="panel-head"><span>V7 DAILY ZONE BACKTEST</span><span>ACCOUNT-CAPPED</span></div><div className="metric-main">{pct(dailyBacktest?.winRate)}</div><div className="metric-caption">Daily predictive-zone sample · TP1 2.0R before SL · N={dailyBacktest?.sampleSize ?? 0}</div><div className="mini-metrics"><span>WINS <strong>{dailyBacktest?.wins ?? 0}</strong></span><span>LOSSES <strong>{dailyBacktest?.losses ?? 0}</strong></span><span>AVG RR <strong>{dailyBacktest?.averageRiskReward ?? "—"}</strong></span></div></article>
      </section>

      <section className="lower-grid">
        <article className="panel"><div className="panel-head"><span>TOP-DOWN MARKET MAP</span><span>4H → 1M</span></div><div className="timeframes">{scalp?.timeframeAnalysis.map((row) => <div className="tf-row" key={row.timeframe}><strong>{row.timeframe.toUpperCase()}</strong><span className={`pill ${row.bias.toLowerCase()}`}>{row.bias}</span><span>{row.score}/100</span><small>Net {row.directionalScore > 0 ? "+" : ""}{row.directionalScore} · RSI {row.rsi} · ADX {row.adx}</small></div>)}</div></article>
        <article className="panel"><div className="panel-head"><span>WHY THIS ZONE?</span><span>V7</span></div><ul className="reasons">{(scalp?.reasons ?? ["Waiting for data..."]).map((r) => <li key={r}>{r}</li>)}</ul><div className="research-note">Zona entry dipetakan dari Fibonacci retracement, EMA value, micro structure, liquidity/sweep, momentum dan ruang R:R. Begitu harga masuk box entry zone, status langsung tegas ENTER BUY/SELL NOW.</div></article>
      </section>

      <section className="panel history"><div className="panel-head"><span>FROZEN 1M DECISIONS</span><span>browser-local</span></div>{!history.length ? <div className="empty">Belum ada minute snapshot.</div> : <div className="table-wrap"><table><thead><tr><th>Time</th><th>Side</th><th>Action</th><th>Conf</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>Risk%</th></tr></thead><tbody>{history.map((r) => <tr key={r.id}><td>{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "medium" }).format(new Date(r.at)) + " WIB"}</td><td><span className={`pill ${r.side.toLowerCase()}`}>{r.side}</span></td><td>{r.action}</td><td>{r.confidence}</td><td>{px(r.entry)}</td><td>{px(r.stop)}</td><td>{px(r.tp1)}</td><td>{px(r.tp2)}</td><td>{r.riskPct.toFixed(1)}%</td></tr>)}</tbody></table></div>}</section>
    </main>
  );
}
