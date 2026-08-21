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
  DATA_STALE_THRESHOLD_MS,
  DEFAULT_ACCOUNT,
  MIN_REMAP_INTERVAL_MS,
  buildAdaptiveCandidate,
  buildDailySetup,
  buildV8Predictions,
  computeComparablePerformance,
  currentAction,
  evaluateAdaptiveZone,
  updateZoneHot,
  type AccountConfig,
  type AdaptiveZone,
  type HorizonPrediction,
  type TradeSetup,
  type ZoneArchive,
} from "../lib/strategyV8";
import type { BacktestStats } from "../types";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const px = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
const pct = (v: number | null | undefined) => v == null ? "—" : `${v.toFixed(1)}%`;
const formatWib = (ms: number) => new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false,
}).format(new Date(ms)) + " WIB";

function loadAccount(): AccountConfig {
  try {
    const saved = JSON.parse(localStorage.getItem("xau_v8_account") ?? "null");
    return saved ? { ...DEFAULT_ACCOUNT, ...saved } : DEFAULT_ACCOUNT;
  } catch { return DEFAULT_ACCOUNT; }
}

function loadArchive(): ZoneArchive[] {
  try { return JSON.parse(localStorage.getItem("xau_v8_zone_archive") ?? "[]"); } catch { return []; }
}

function saveArchive(rows: ZoneArchive[]) {
  try { localStorage.setItem("xau_v8_zone_archive", JSON.stringify(rows.slice(0, 120))); } catch {}
}

function ActionPanel({ zone, action, currentPrice, stale }: { zone: AdaptiveZone | null; action: string; currentPrice: number | null; stale: boolean }) {
  const side = zone?.side.toLowerCase() ?? "neutral";
  const live = action.startsWith("ENTER");
  return (
    <article className={`panel v8-action-card ${side} ${live ? "live-action" : ""}`}>
      <div className="panel-head"><span>REALTIME ACTION</span><span>{stale ? "STALE FEED" : zone?.state ?? "MAPPING"}</span></div>
      <div className="v8-action-title">{action}</div>
      <div className="v8-current">CURRENT <strong>{px(currentPrice)}</strong></div>
      <div className="levels compact v8-levels">
        <div><small>EXACT ENTRY</small><strong>{px(zone?.exactEntry)}</strong></div>
        <div><small>SL · {zone?.stopPips?.toFixed(1) ?? "—"} PIPS</small><strong>{px(zone?.stop)}</strong></div>
        <div><small>TP1 · {zone?.rr1?.toFixed(1) ?? "—"}R</small><strong>{px(zone?.tp1)}</strong></div>
        <div><small>TP2 · {zone?.rr2?.toFixed(1) ?? "—"}R</small><strong>{px(zone?.tp2)}</strong></div>
      </div>
      <div className="v8-action-note">{zone?.lifecycleReason ?? "Building the best current executable zone..."}</div>
    </article>
  );
}

function ZonePanel({ zone }: { zone: AdaptiveZone | null }) {
  if (!zone) return <article className="panel v8-zone-card"><div className="panel-head"><span>PREDICTIVE ZONE</span><span>FORMING</span></div><div className="empty">Mapping current market...</div></article>;
  return (
    <article className={`panel v8-zone-card ${zone.side.toLowerCase()}`}>
      <div className="panel-head"><span>PREDICTIVE ZONE</span><span>{zone.zoneGrade} · {zone.zoneScore}/100</span></div>
      <div className="v8-zone-side">NEXT {zone.side} OPPORTUNITY</div>
      <div className="v8-zone-range">{px(zone.entryZoneLow)} – {px(zone.entryZoneHigh)}</div>
      <div className="v8-zone-meta"><span>Preferred <b>{px(zone.exactEntry)}</b></span><span>Setup <b>{zone.setupType}</b></span></div>
      <div className="v8-zone-meta"><span>Created <b>{formatWib(zone.createdAt)}</b></span><span>State <b>{zone.state}</b></span></div>
    </article>
  );
}

function PerformancePanel({ zone, stats }: { zone: AdaptiveZone | null; stats: BacktestStats | null }) {
  const sample = stats?.sampleSize ?? 0;
  const quality = sample >= 100 ? "GOOD SAMPLE" : sample >= 30 ? "EARLY SAMPLE" : "LOW SAMPLE";
  return (
    <article className="panel v8-performance-card">
      <div className="panel-head"><span>PERFORMANCE</span><span>{quality}</span></div>
      <div className="v8-perf-main">{pct(stats?.winRate)}</div>
      <div className="metric-caption">Comparable executable mapped-zone backtest · N={sample}</div>
      <div className="mini-metrics">
        <span>SETUP <strong>{zone?.setupType ?? "—"}</strong></span>
        <span>AVG RR <strong>{stats?.averageRiskReward ?? "—"}</strong></span>
        <span>PF <strong>{stats?.profitFactor ?? "—"}</strong></span>
      </div>
      <div className="research-note">Win rate is historical evidence from comparable executable mapped setups, not the zone score and not a guarantee.</div>
    </article>
  );
}

function PredictionCard({ row }: { row: HorizonPrediction }) {
  return (
    <div className={`prediction ${row.bias.toLowerCase()}`}>
      <div><strong>{row.minutes} MIN</strong><span className={`pill ${row.bias.toLowerCase()}`}>{row.bias}</span></div>
      <b>{row.edgeScore}/100 edge</b>
      <strong className="prediction-action">{row.action}</strong>
      <small>Projected {px(row.projectedLow)} – {px(row.projectedHigh)} · {row.alignment}</small>
    </div>
  );
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [frames, setFrames] = useState<MarketFrames | null>(null);
  const framesRef = useRef<MarketFrames | null>(null);
  const [zone, setZone] = useState<AdaptiveZone | null>(null);
  const zoneRef = useRef<AdaptiveZone | null>(null);
  const [daily, setDaily] = useState<TradeSetup | null>(null);
  const [predictions, setPredictions] = useState<HorizonPrediction[]>([]);
  const [performanceStats, setPerformanceStats] = useState<BacktestStats | null>(null);
  const [archiveRows, setArchiveRows] = useState<ZoneArchive[]>([]);
  const [account, setAccount] = useState<AccountConfig>(DEFAULT_ACCOUNT);
  const [streamState, setStreamState] = useState<StreamState>("CLOSED");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [hotPathMs, setHotPathMs] = useState<number | null>(null);
  const [uiPaintMs, setUiPaintMs] = useState<number | null>(null);
  const [localTotalMs, setLocalTotalMs] = useState<number | null>(null);
  const [deepMapMs, setDeepMapMs] = useState<number | null>(null);
  const [providerGapMs, setProviderGapMs] = useState<number | null>(null);
  const [feedAgeMs, setFeedAgeMs] = useState<number | null>(null);
  const lastTickWallRef = useRef<number | null>(null);
  const lastRemapRef = useRef(0);

  useEffect(() => {
    const key = getSavedApiKey();
    setApiKey(key); setDraftKey(key);
    setAccount(loadAccount()); setArchiveRows(loadArchive());
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("xau_v8_account", JSON.stringify(account)); } catch {}
    const f = framesRef.current;
    if (!f) return;
    try {
      const candidate = buildAdaptiveCandidate(f, account, Date.now());
      const price = f.c1.at(-1)?.close ?? candidate.exactEntry;
      const evaluated = evaluateAdaptiveZone(null, candidate, price, Date.now(), account);
      zoneRef.current = evaluated.zone; setZone(evaluated.zone); setPredictions(buildV8Predictions(f, evaluated.zone));
      setDaily(buildDailySetup(f, account, Date.now()));
      setPerformanceStats(computeComparablePerformance(f, account));
    } catch {}
  }, [account]);

  function pushArchive(row: ZoneArchive | null) {
    if (!row) return;
    setArchiveRows((old) => {
      if (old.some((x) => x.id === row.id && x.closedAt === row.closedAt)) return old;
      const next = [row, ...old].slice(0, 120);
      saveArchive(next);
      return next;
    });
  }

  function initializeFromFrames(next: MarketFrames) {
    const now = Date.now();
    const candidate = buildAdaptiveCandidate(next, account, now);
    const price = next.c1.at(-1)?.close ?? candidate.exactEntry;
    const evaluated = evaluateAdaptiveZone(null, candidate, price, now, account);
    zoneRef.current = evaluated.zone;
    setZone(evaluated.zone);
    setPredictions(buildV8Predictions(next, evaluated.zone));
    setDaily(buildDailySetup(next, account, now));
    try { setPerformanceStats(computeComparablePerformance(next, account)); } catch {}
  }

  async function loadMarket(key: string) {
    setLoading(true); setReady(false); setError(null);
    try {
      const cached = getCachedFrames();
      const next = cached ? await refreshFromOneMinute(key, cached) : await fetchAllTimeframes(key);
      framesRef.current = next; setFrames(next); initializeFromFrames(next); setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Market data initialization error"); }
    finally { setLoading(false); }
  }

  async function syncHistory() {
    if (!apiKey || !framesRef.current || loading) return;
    setLoading(true);
    try {
      const next = await refreshFromOneMinute(apiKey, framesRef.current);
      framesRef.current = next; setFrames(next); initializeFromFrames(next); cacheMarketFrames(next); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Historical sync failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!apiKey) return;
    framesRef.current = null; zoneRef.current = null; setFrames(null); setZone(null); setReady(false); setTickCount(0);
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
        const hotStart = performance.now();
        const prevMinute = current.c1.at(-1)?.timestamp;
        const next = applyRealtimeTick(current, tick);
        const nextMinute = next.c1.at(-1)?.timestamp;
        const minuteRolled = Boolean(prevMinute && nextMinute && prevMinute !== nextMinute);
        framesRef.current = next;

        const active = zoneRef.current;
        if (active) {
          const hotZone = updateZoneHot(active, tick.price, tick.receivedAtMs, account.pipSize);
          zoneRef.current = hotZone; setZone(hotZone);
        }
        setFrames(next);
        setLastTickAt(tick.receivedAtMs);
        setTickCount((n) => n + 1);
        setError(null);
        if (lastTickWallRef.current != null) setProviderGapMs(Math.max(0, tick.receivedAtMs - lastTickWallRef.current));
        lastTickWallRef.current = tick.receivedAtMs;
        if (tick.sourceTimestampMs != null) setFeedAgeMs(Math.max(0, tick.receivedAtMs - tick.sourceTimestampMs));
        const hot = performance.now() - hotStart;
        setHotPathMs(Math.round(hot * 10) / 10);

        requestAnimationFrame(() => {
          const total = performance.now() - tick.receivedPerfMs;
          setLocalTotalMs(Math.round(total * 10) / 10);
          setUiPaintMs(Math.round(Math.max(0, total - hot) * 10) / 10);
        });

        if (tick.receivedAtMs - lastRemapRef.current >= MIN_REMAP_INTERVAL_MS) {
          lastRemapRef.current = tick.receivedAtMs;
          window.setTimeout(() => {
            const deep0 = performance.now();
            try {
              const candidate = buildAdaptiveCandidate(next, account, tick.receivedAtMs);
              const evaluated = evaluateAdaptiveZone(zoneRef.current, candidate, tick.price, tick.receivedAtMs, account);
              zoneRef.current = evaluated.zone; setZone(evaluated.zone); pushArchive(evaluated.archived);
              setPredictions(buildV8Predictions(next, evaluated.zone));
            } catch {}
            setDeepMapMs(Math.round((performance.now() - deep0) * 10) / 10);
          }, 0);
        }

        if (minuteRolled) {
          window.setTimeout(() => {
            try { setDaily(buildDailySetup(next, account, tick.receivedAtMs)); } catch {}
            try { setPerformanceStats(computeComparablePerformance(next, account)); } catch {}
            cacheMarketFrames(next);
          }, 0);
        }
      },
    });
  }, [apiKey, ready, account]);

  const currentPrice = frames?.c1.at(-1)?.close ?? zone?.exactEntry ?? null;
  const tickAgeMs = lastTickAt ? Math.max(0, clock - lastTickAt) : null;
  const stale = tickAgeMs != null && tickAgeMs > DATA_STALE_THRESHOLD_MS;
  const streamLive = streamState === "LIVE" && tickAgeMs != null;
  const action = currentAction(zone, stale, streamLive);
  const localTargetOk = localTotalMs != null && localTotalMs <= 100;
  const providerTargetOk = providerGapMs != null && providerGapMs <= 100;
  const isSaturday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "short" }).format(new Date(clock)) === "Sat";
  const totalRiskPerPip = account.pipSize * account.contractSizeOz * account.lotPerPosition * account.positions * account.usdIdr;

  function connectKey() {
    const key = draftKey.trim(); if (!key) return;
    saveApiKey(key); setApiKey(key);
  }
  function disconnectKey() {
    clearApiKey(); setApiKey(""); setDraftKey(""); setReady(false); framesRef.current = null; zoneRef.current = null; setFrames(null); setZone(null); setPredictions([]);
  }
  function updateAccount<K extends keyof AccountConfig>(key: K, value: number) {
    setAccount((a) => ({ ...a, [key]: Number.isFinite(value) ? value : a[key] }));
  }

  return (
    <main className="shell v8-shell">
      <header className="topbar">
        <div><div className="eyebrow">RASYID SIGNAL CALL · XAUUSD V8 ADAPTIVE ZONE</div><h1>XAU/USD</h1><div className="subline">Always-remapped scalp opportunity · one clean zone · realtime action separated from predictive mapping</div></div>
        <div className={`status ${streamState === "LIVE" && !stale ? "online" : "offline"}`}><span />{apiKey ? `WS ${streamState}${stale ? " · STALE" : ""}` : "API KEY REQUIRED"}</div>
      </header>

      {isSaturday && <div className="weekend-banner"><strong>SATURDAY FEED MODE</strong><span>V8 trades only if fresh live XAU/USD ticks are actually arriving. If the connected feed is frozen, realtime action is disabled instead of inventing a weekend call.</span></div>}

      {!apiKey && <section className="panel connect-panel"><div className="panel-head"><span>CONNECT MARKET DATA</span><span>Twelve Data</span></div><p>API key stays in your browser for this personal GitHub Pages dashboard.</p><div className="connect-row"><input type="password" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Paste Twelve Data API key"/><button onClick={connectKey}>CONNECT</button></div></section>}

      {apiKey && <div className="toolbar v8-toolbar"><span>{lastTickAt ? `Last tick ${formatWib(lastTickAt)} · ${((tickAgeMs ?? 0) / 1000).toFixed(2)}s ago` : loading ? "Loading history..." : "Waiting tick..."}</span><span className="usage-note">LOCAL {localTotalMs == null ? "—" : `${localTotalMs.toFixed(1)}ms ${localTargetOk ? "✓" : ">100ms"}`} · hot {hotPathMs == null ? "—" : `${hotPathMs.toFixed(1)}ms`} · UI {uiPaintMs == null ? "—" : `${uiPaintMs.toFixed(1)}ms`} · deep map {deepMapMs == null ? "—" : `${deepMapMs.toFixed(1)}ms`} · provider tick interval {providerGapMs == null ? "—" : `${providerGapMs}ms ${providerTargetOk ? "✓" : "upstream"}`} · feed age {feedAgeMs == null ? "—" : `${feedAgeMs}ms`} · ticks {tickCount}</span><div><button onClick={() => setShowAnalysis((v) => !v)}>{showAnalysis ? "HIDE ANALYSIS" : "SHOW ANALYSIS"}</button><button onClick={() => void syncHistory()} disabled={loading}>{loading ? "SYNCING..." : "SYNC HISTORY"}</button><button onClick={disconnectKey}>CHANGE API KEY</button></div></div>}
      {error && <div className="error">{error}</div>}

      <section className="v8-decision-grid">
        <ActionPanel zone={zone} action={action} currentPrice={currentPrice} stale={stale} />
        <ZonePanel zone={zone} />
        <PerformancePanel zone={zone} stats={performanceStats} />
      </section>

      <section className="panel market-panel v8-market-panel">
        <div className="panel-head"><span>LIVE 1M CHART · WIB</span><span>ONE ACTIVE ZONE ONLY</span></div>
        <div className="market-price">{px(currentPrice)} <small className={`live-tag ${streamState === "LIVE" && !stale ? "on" : ""}`}>{streamState === "LIVE" && !stale ? "STREAMING" : stale ? "STALE" : streamState}</small></div>
        <CandleChart candles={frames?.c1 ?? []} zone={zone} showAnalysis={showAnalysis}/>
      </section>

      <section className="panel prediction-panel v8-prediction-panel">
        <div className="panel-head"><span>PREDICTIVE BIAS · 1 / 5 / 10 MIN</span><span>SCENARIO, NOT GUARANTEE</span></div>
        <div className="prediction-grid">{predictions.length ? predictions.map((p) => <PredictionCard key={p.minutes} row={p}/>) : <div className="empty">Waiting for market data...</div>}</div>
      </section>

      <section className="lower-grid v8-secondary-grid">
        <article className="panel"><div className="panel-head"><span>DAILY CONTEXT</span><span>NOT DRAWN ON CHART</span></div><div className="v8-daily-compact"><b>{daily?.side ?? "—"}</b><span>Entry {px(daily?.exactEntry)} · SL {px(daily?.stop)} · TP1 {px(daily?.tp1)} · TP2 {px(daily?.tp2)}</span><small>{daily?.status ?? "Waiting for data"}</small></div></article>
        <article className="panel"><div className="panel-head"><span>RISK ENGINE</span><span>1 PIP = $0.10 XAU MOVE</span></div><div className="v8-risk-compact"><span>Balance <b>{money.format(account.balanceIdr)}</b></span><span>{account.positions} × {account.lotPerPosition.toFixed(3)} lot</span><span>Max scalp SL <b>{account.maxScalpStopPips} pips</b></span><span>Risk per total pip ≈ <b>{money.format(totalRiskPerPip)}</b></span></div></article>
      </section>

      <section className="panel account-panel v8-account-panel">
        <div className="panel-head"><span>ACCOUNT SETTINGS</span><span>ZONE FITS THE ACCOUNT</span></div>
        <div className="account-grid">
          <label>Balance IDR<input type="number" value={account.balanceIdr} onChange={(e) => updateAccount("balanceIdr", Number(e.target.value))}/></label>
          <label>Positions<input type="number" min="1" step="1" value={account.positions} onChange={(e) => updateAccount("positions", Number(e.target.value))}/></label>
          <label>Lot / position<input type="number" step="0.001" value={account.lotPerPosition} onChange={(e) => updateAccount("lotPerPosition", Number(e.target.value))}/></label>
          <label>USD/IDR<input type="number" value={account.usdIdr} onChange={(e) => updateAccount("usdIdr", Number(e.target.value))}/></label>
          <label>Max scalp SL pips<input type="number" step="1" value={account.maxScalpStopPips} onChange={(e) => updateAccount("maxScalpStopPips", Number(e.target.value))}/></label>
          <label>Scalp target risk %<input type="number" step="0.1" value={account.scalpTargetRiskPct} onChange={(e) => updateAccount("scalpTargetRiskPct", Number(e.target.value))}/></label>
        </div>
      </section>

      <section className="panel history v8-history"><div className="panel-head"><span>ZONE LIFECYCLE ARCHIVE</span><span>old setups never rewritten</span></div>{!archiveRows.length ? <div className="empty">No replaced/missed zones yet.</div> : <div className="table-wrap"><table><thead><tr><th>Closed</th><th>Side</th><th>Setup</th><th>State</th><th>Entry</th><th>SL</th><th>TP1</th><th>Score</th><th>Reason</th></tr></thead><tbody>{archiveRows.slice(0, 40).map((r) => <tr key={`${r.id}-${r.closedAt}`}><td>{formatWib(r.closedAt)}</td><td><span className={`pill ${r.side.toLowerCase()}`}>{r.side}</span></td><td>{r.setupType}</td><td>{r.state}</td><td>{px(r.exactEntry)}</td><td>{px(r.stop)}</td><td>{px(r.tp1)}</td><td>{r.score}</td><td>{r.reason}</td></tr>)}</tbody></table></div>}</section>
    </main>
  );
}
