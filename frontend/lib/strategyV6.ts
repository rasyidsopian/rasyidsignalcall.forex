import type { BacktestStats, BacktestTrade, Candle, Signal, TimeframeAnalysis } from "../types";
import type { MarketFrames } from "./marketData";
import { generateSignal } from "./signalEngine";
import {
  buildDailySetup as buildDailySetupV5,
  DEFAULT_ACCOUNT as OLD_DEFAULT_ACCOUNT,
  type AccountConfig as V5AccountConfig,
  type TradeSetup as V5TradeSetup,
} from "./strategyV5";

export type AccountConfig = V5AccountConfig & {
  pipSize: number;
  maxScalpStopPips: number;
  scalpTargetRiskPct: number;
};

export type RiskAssessment = V5TradeSetup["risk"] & {
  stopPips: number;
  balanceCapPips: number;
  maxStopPips: number;
};

export type TradeSetup = Omit<V5TradeSetup, "risk"> & {
  risk: RiskAssessment;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopPips: number;
  maxStopPips: number;
  predictiveAction: "ENTER_NOW" | "WAIT_PULLBACK" | "WAIT_RECLAIM" | "PREP_ONLY";
};

export type HorizonPrediction = {
  minutes: 1 | 5 | 10;
  bias: "BUY" | "SELL";
  edgeScore: number;
  projectedLow: number;
  projectedHigh: number;
  projectedMid: number;
  alignment: "ALIGNED" | "CONFLICT";
  action: string;
  entryZoneLow: number;
  entryZoneHigh: number;
  stop: number;
  tp1: number;
  tp2: number;
  rr: number;
  note: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const p = Math.min(period, values.length);
  const k = 2 / (p + 1);
  let value = values.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (const next of values.slice(p)) value = next * k + value * (1 - k);
  return value;
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < 3) return 0;
  const rows = candles.slice(-(period + 1));
  const tr: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    tr.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low - rows[i - 1].close),
    ));
  }
  return tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : 0;
}

function lastConfirmedPivot(candles: Candle[], side: "BUY" | "SELL", lookback = 28): number | null {
  const rows = candles.slice(-lookback - 3);
  const pivots: number[] = [];
  for (let i = 2; i < rows.length - 2; i++) {
    if (side === "BUY") {
      const v = rows[i].low;
      if (v <= rows[i - 1].low && v < rows[i - 2].low && v <= rows[i + 1].low && v < rows[i + 2].low) pivots.push(v);
    } else {
      const v = rows[i].high;
      if (v >= rows[i - 1].high && v > rows[i - 2].high && v >= rows[i + 1].high && v > rows[i + 2].high) pivots.push(v);
    }
  }
  return pivots.at(-1) ?? null;
}

function recentSweep(c1: Candle[], side: "BUY" | "SELL") {
  if (c1.length < 12) return null;
  const last = c1.at(-1)!;
  const prior = c1.slice(-11, -1);
  if (side === "BUY") {
    const low = Math.min(...prior.map((c) => c.low));
    return last.low < low && last.close > low ? last.low : null;
  }
  const high = Math.max(...prior.map((c) => c.high));
  return last.high > high && last.close < high ? last.high : null;
}

function nearestLiquidity(c5: Candle[], side: "BUY" | "SELL", entry: number): number | null {
  const rows = c5.slice(-48, -2);
  if (side === "BUY") {
    const levels = rows.map((c) => c.high).filter((v) => v > entry).sort((a, b) => a - b);
    return levels[0] ?? null;
  }
  const levels = rows.map((c) => c.low).filter((v) => v < entry).sort((a, b) => b - a);
  return levels[0] ?? null;
}

function maxBalanceDistance(config: AccountConfig) {
  const totalLots = Math.max(config.positions * config.lotPerPosition, 0.0001);
  const riskIdr = config.balanceIdr * (config.scalpTargetRiskPct / 100);
  const riskUsd = riskIdr / Math.max(config.usdIdr, 1);
  return riskUsd / Math.max(config.contractSizeOz * totalLots, 0.0001);
}

function selectedClosedFrames(frames: MarketFrames, evaluationMs: number): MarketFrames {
  const closed = (rows: Candle[], minutes: number) => rows.filter((c) => new Date(c.timestamp).getTime() + minutes * 60_000 <= evaluationMs + 1000);
  return {
    c1: closed(frames.c1, 1),
    c5: closed(frames.c5, 5),
    c15: closed(frames.c15, 15),
    c1h: closed(frames.c1h, 60),
    c4h: closed(frames.c4h, 240),
  };
}

function riskFromPlan(entry: number, stop: number, tp1: number, tp2: number, config: AccountConfig, action: RiskAssessment["action"]): RiskAssessment {
  const distance = Math.abs(entry - stop);
  const totalLots = config.positions * config.lotPerPosition;
  const riskUsd = distance * config.contractSizeOz * totalLots;
  const riskIdr = riskUsd * config.usdIdr;
  const riskPct = config.balanceIdr > 0 ? riskIdr / config.balanceIdr * 100 : 999;
  const rr1 = distance ? Math.abs(tp1 - entry) / distance : 0;
  const rr2 = distance ? Math.abs(tp2 - entry) / distance : 0;
  const blendedRewardR = (rr1 + rr2) / 2;
  const balanceCapPips = maxBalanceDistance(config) / Math.max(config.pipSize, 0.0001);
  const stopPips = distance / Math.max(config.pipSize, 0.0001);
  return {
    riskUsd: round2(riskUsd),
    riskIdr: Math.round(riskIdr),
    riskPct: Math.round(riskPct * 10) / 10,
    maxRiskPct: config.scalpTargetRiskPct,
    withinBudget: stopPips <= Math.min(config.maxScalpStopPips, balanceCapPips) + 0.1,
    recommendedLotPerPosition: config.lotPerPosition,
    blendedRewardR: Math.round(blendedRewardR * 100) / 100,
    action,
    message: action === "ENTER_NOW"
      ? `Entry berada di micro zone. SL ${stopPips.toFixed(1)} pips dan R:R memenuhi tight-scalp gate.`
      : action === "MARKET_CLOSED"
        ? "Standard XAU/USD tidak streaming. Setup hanya preparation sampai feed broker benar-benar live."
        : "Arah sudah ada, tetapi tunggu harga masuk predictive entry zone; jangan chase supaya SL tetap kecil.",
    stopPips: Math.round(stopPips * 10) / 10,
    balanceCapPips: Math.round(balanceCapPips * 10) / 10,
    maxStopPips: Math.min(config.maxScalpStopPips, balanceCapPips),
  };
}

function isSaturdayJakarta(nowMs: number) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", weekday: "short" }).format(new Date(nowMs));
  return day === "Sat";
}

function buildTightPlan(frames: MarketFrames, base: Signal, config: AccountConfig, nowMs: number, ignoreWeekend = false): TradeSetup {
  const side = base.signal;
  const current = frames.c1.at(-1)?.close ?? base.current_price;
  const pip = Math.max(config.pipSize, 0.0001);
  const userCap = Math.max(config.maxScalpStopPips, 5) * pip;
  const balanceCap = maxBalanceDistance(config);
  const cap = Math.max(6 * pip, Math.min(userCap, balanceCap));
  const minRisk = Math.min(cap * 0.58, Math.max(8 * pip, cap * 0.42));
  const a1 = base.timeframe_analysis.find((x) => x.timeframe === "1m")!;
  const a5 = base.timeframe_analysis.find((x) => x.timeframe === "5m")!;
  const a15 = base.timeframe_analysis.find((x) => x.timeframe === "15m")!;
  const c1 = frames.c1;
  const c5 = frames.c5;
  const atr1 = Math.max(atr(c1), pip * 5);
  const close1 = c1.map((c) => c.close);
  const e9 = ema(close1, 9);
  const e20 = ema(close1, 20);
  const pivot = lastConfirmedPivot(c1, side) ?? (side === "BUY"
    ? Math.min(...c1.slice(-10, -1).map((c) => c.low))
    : Math.max(...c1.slice(-10, -1).map((c) => c.high)));
  const sweep = recentSweep(c1, side);
  const anchor = sweep == null ? pivot : (side === "BUY" ? Math.min(pivot, sweep) : Math.max(pivot, sweep));
  const buffer = clamp(atr1 * 0.07, 3 * pip, 6 * pip);
  const stop = side === "BUY" ? anchor - buffer : anchor + buffer;

  // Setup menyesuaikan saldo: ENTRY ZONE digeser mendekati structure, bukan SL dipaksa jauh.
  const zoneNear = minRisk;
  const zoneFar = Math.max(zoneNear + 2 * pip, cap * 0.92);
  let entryZoneLow: number;
  let entryZoneHigh: number;
  if (side === "BUY") {
    entryZoneLow = stop + zoneNear;
    entryZoneHigh = stop + zoneFar;
  } else {
    entryZoneHigh = stop - zoneNear;
    entryZoneLow = stop - zoneFar;
  }

  // Keep the zone around the fast micro-value area when possible.
  const microValue = (e9 * 0.62 + e20 * 0.38);
  if (side === "BUY" && microValue > entryZoneHigh && microValue - stop <= cap) {
    entryZoneHigh = microValue;
    entryZoneLow = Math.max(entryZoneLow, microValue - Math.max(5 * pip, cap * 0.2));
  } else if (side === "SELL" && microValue < entryZoneLow && stop - microValue <= cap) {
    entryZoneLow = microValue;
    entryZoneHigh = Math.min(entryZoneHigh, microValue + Math.max(5 * pip, cap * 0.2));
  }

  entryZoneLow = round2(Math.min(entryZoneLow, entryZoneHigh));
  entryZoneHigh = round2(Math.max(entryZoneLow, entryZoneHigh));
  const inZone = current >= entryZoneLow - pip && current <= entryZoneHigh + pip;
  const microAligned = a1.bias === side && a5.bias === side;
  const contextOkay = a15.bias === side || Math.abs(a15.directionalScore) < 35;
  const momentumOkay = side === "BUY" ? a1.rsi >= 48 && a1.rsi <= 69 : a1.rsi <= 52 && a1.rsi >= 31;
  const notChasing = Math.abs(current - e9) <= Math.max(atr1 * 0.62, cap * 1.4);
  const reclaimOkay = side === "BUY" ? current > stop + minRisk * 0.75 : current < stop - minRisk * 0.75;

  let predictiveAction: TradeSetup["predictiveAction"] = "WAIT_PULLBACK";
  if (inZone && microAligned && contextOkay && momentumOkay && notChasing && reclaimOkay) predictiveAction = "ENTER_NOW";
  else if ((side === "BUY" && current < entryZoneLow) || (side === "SELL" && current > entryZoneHigh)) predictiveAction = "WAIT_RECLAIM";
  if (!ignoreWeekend && isSaturdayJakarta(nowMs)) predictiveAction = "PREP_ONLY";

  const plannedEntry = predictiveAction === "ENTER_NOW" ? current : (entryZoneLow + entryZoneHigh) / 2;
  let riskDist = Math.abs(plannedEntry - stop);
  if (riskDist > cap) {
    // Numerical guard: pull the predictive entry back toward the anchor so stop never exceeds configured cap.
    riskDist = cap;
  }
  const entry = side === "BUY" ? stop + riskDist : stop - riskDist;
  const target1R = 1.8;
  const target2R = 2.6;
  let tp1 = side === "BUY" ? entry + riskDist * target1R : entry - riskDist * target1R;
  let tp2 = side === "BUY" ? entry + riskDist * target2R : entry - riskDist * target2R;
  const liquidity = nearestLiquidity(c5, side, entry);
  if (liquidity != null) {
    const availableR = Math.abs(liquidity - entry) / Math.max(riskDist, pip);
    if (availableR >= 1.8 && availableR < 2.6) {
      const cushion = 3 * pip;
      tp2 = side === "BUY" ? liquidity - cushion : liquidity + cushion;
    }
  }
  const rr1 = Math.abs(tp1 - entry) / Math.max(riskDist, pip);
  const rr2 = Math.abs(tp2 - entry) / Math.max(riskDist, pip);
  const action: RiskAssessment["action"] = predictiveAction === "ENTER_NOW" ? "ENTER_NOW" : predictiveAction === "PREP_ONLY" ? "MARKET_CLOSED" : "WAIT";
  const risk = riskFromPlan(entry, stop, tp1, tp2, config, action);
  const confluenceBonus = Number(microAligned) * 8 + Number(contextOkay) * 4 + Number(momentumOkay) * 4 + Number(sweep != null) * 5;
  const confidence = clamp(Math.round(base.confidence * 0.72 + confluenceBonus), 50, 96);

  const status = predictiveAction === "ENTER_NOW"
    ? `ENTER ${side} NOW`
    : predictiveAction === "WAIT_RECLAIM"
      ? `WAIT ${side} RECLAIM`
      : predictiveAction === "PREP_ONLY"
        ? `${side} PREP · MARKET CLOSED`
        : `WAIT ${side} ENTRY ZONE`;

  const reasons = [
    `V6 tight scalp: stop cap ${config.maxScalpStopPips} pips; balance-derived cap ${risk.balanceCapPips.toFixed(1)} pips. Effective max ${risk.maxStopPips.toFixed(1)} pips.`,
    `Predictive entry zone ${entryZoneLow.toFixed(2)} – ${entryZoneHigh.toFixed(2)} dibentuk dari confirmed 1M pivot/sweep + micro value, bukan mengejar current price.`,
    `1M ${a1.bias} + 5M ${a5.bias}; 15M ${a15.bias} hanya context. RSI 1M ${a1.rsi}; ${microAligned ? "micro alignment valid" : "micro alignment belum valid"}.`,
    sweep != null ? "Liquidity sweep/reclaim terdeteksi; stop berada di luar sweep + buffer kecil." : "Belum ada sweep aktif; stop memakai confirmed micro pivot + 3–6 pip buffer.",
    `Planned TP1 ${rr1.toFixed(1)}R dan TP2 ${rr2.toFixed(1)}R; target disesuaikan dengan liquidity 5M bila lebih dekat.`,
    predictiveAction === "ENTER_NOW" ? "ENTRY NOW valid: harga sudah di zone + momentum tidak overextended." : "Belum entry: tunggu harga masuk zone/reclaim agar SL tidak melebar.",
  ];

  return {
    kind: "SCALPING",
    side,
    confidence,
    entry: round2(entry),
    stop: round2(stop),
    tp1: round2(tp1),
    tp2: round2(tp2),
    rr1: Math.round(rr1 * 100) / 100,
    rr2: Math.round(rr2 * 100) / 100,
    blendedRr: risk.blendedRewardR,
    status,
    reasons,
    timeframeAnalysis: base.timeframe_analysis,
    marketRegime: base.market_regime,
    risk,
    beRule: "Jangan BE sebelum +1R. Setelah +1R dan candle 1M close tetap searah, pindahkan posisi #2 ke BE +2 pips; posisi #1 tetap ke TP1.",
    entryZoneLow,
    entryZoneHigh,
    stopPips: risk.stopPips,
    maxStopPips: risk.maxStopPips,
    predictiveAction,
  };
}

export function buildScalpingSetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const base = generateSignal(frames.c1, frames.c5, frames.c15, frames.c1h, frames.c4h, nowMs, true);
  return buildTightPlan(frames, base, config, nowMs, false);
}

export function buildDailySetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const daily = buildDailySetupV5(frames, config, nowMs);
  const stopPips = Math.abs(daily.entry - daily.stop) / Math.max(config.pipSize, 0.0001);
  return {
    ...daily,
    risk: {
      ...daily.risk,
      stopPips: Math.round(stopPips * 10) / 10,
      balanceCapPips: Math.round(maxBalanceDistance(config) / Math.max(config.pipSize, 0.0001) * 10) / 10,
      maxStopPips: config.maxScalpStopPips,
    },
    entryZoneLow: daily.entry,
    entryZoneHigh: daily.entry,
    stopPips: Math.round(stopPips * 10) / 10,
    maxStopPips: config.maxScalpStopPips,
    predictiveAction: daily.risk.action === "ENTER_NOW" ? "ENTER_NOW" : daily.risk.action === "MARKET_CLOSED" ? "PREP_ONLY" : "WAIT_PULLBACK",
  };
}

function slope(values: number[]) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += (i - xMean) ** 2; }
  return den ? num / den : 0;
}

export function buildPredictions(frames: MarketFrames, setup: TradeSetup): HorizonPrediction[] {
  const c1 = frames.c1.slice(-32);
  const c5 = frames.c5.slice(-14);
  const current = c1.at(-1)?.close ?? setup.entry;
  const atr1 = Math.max(atr(c1), Math.max(0.01, setup.stopPips * 0.01));
  const slope1 = slope(c1.slice(-16).map((c) => c.close));
  const slope5 = slope(c5.slice(-8).map((c) => c.close)) / 5;
  const fast = slope1 * 0.78 + slope5 * 0.22;
  return ([1, 5, 10] as const).map((minutes) => {
    const projectedMove = fast * minutes;
    const projectedMid = current + projectedMove;
    const width = atr1 * Math.sqrt(minutes) * 0.42;
    const bias: "BUY" | "SELL" = projectedMove >= 0 ? "BUY" : "SELL";
    const alignment = bias === setup.side ? "ALIGNED" : "CONFLICT";
    const normalized = Math.abs(projectedMove) / Math.max(width, 0.01);
    const edgeScore = clamp(Math.round(50 + normalized * 20 + (alignment === "ALIGNED" ? 8 : -5) + (setup.predictiveAction === "ENTER_NOW" ? 5 : 0)), 45, 92);
    return {
      minutes,
      bias,
      edgeScore,
      projectedLow: round2(projectedMid - width),
      projectedHigh: round2(projectedMid + width),
      projectedMid: round2(projectedMid),
      alignment,
      action: alignment === "ALIGNED" ? setup.status : `HOLD · ${minutes}M conflicts with scalp bias`,
      entryZoneLow: setup.entryZoneLow,
      entryZoneHigh: setup.entryZoneHigh,
      stop: setup.stop,
      tp1: setup.tp1,
      tp2: setup.tp2,
      rr: setup.rr2,
      note: `Scenario ${minutes}m memakai live 1M slope + 5M slope + ATR band. Edge score bukan probabilitas win.` ,
    };
  });
}

function statsFromTrades(trades: BacktestTrade[]): BacktestStats {
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const sampleSize = wins + losses;
  return {
    winRate: sampleSize ? Math.round(wins / sampleSize * 1000) / 10 : null,
    wins,
    losses,
    sampleSize,
    profitFactor: losses ? Math.round((wins * 1.8 / losses) * 100) / 100 : wins ? 99 : null,
    averageRiskReward: trades.length ? Math.round(trades.reduce((s, t) => s + t.riskReward, 0) / trades.length * 100) / 100 : null,
    trades,
  };
}

export function backtestTightScalp(frames: MarketFrames, config: AccountConfig, maxTrades = 120): BacktestStats {
  const trades: BacktestTrade[] = [];
  const c1 = frames.c1;
  const start = Math.max(260, c1.length - 1100);
  for (let i = start; i < c1.length - 12; i += 3) {
    const evalMs = new Date(c1[i].timestamp).getTime() + 60_000;
    try {
      const hist = selectedClosedFrames(frames, evalMs);
      if ([hist.c1, hist.c5, hist.c15, hist.c1h, hist.c4h].some((rows) => rows.length < 205)) continue;
      const base = generateSignal(hist.c1, hist.c5, hist.c15, hist.c1h, hist.c4h, evalMs, false);
      const setup = buildTightPlan(hist, base, config, evalMs, true);
      if (setup.predictiveAction !== "ENTER_NOW" || setup.confidence < 70 || setup.rr1 < 1.7) continue;
      const future = c1.slice(i + 1, i + 11);
      let result: "WIN" | "LOSS" | null = null;
      for (const bar of future) {
        const sl = setup.side === "BUY" ? bar.low <= setup.stop : bar.high >= setup.stop;
        const tp = setup.side === "BUY" ? bar.high >= setup.tp1 : bar.low <= setup.tp1;
        if (sl && tp) { result = "LOSS"; break; }
        if (sl) { result = "LOSS"; break; }
        if (tp) { result = "WIN"; break; }
      }
      if (result) trades.push({ timestamp: new Date(evalMs).toISOString(), side: setup.side, confidence: setup.confidence, regime: setup.marketRegime, result, riskReward: setup.rr1 });
    } catch {}
  }
  return statsFromTrades(trades.slice(-maxTrades));
}

export const DEFAULT_ACCOUNT: AccountConfig = {
  ...OLD_DEFAULT_ACCOUNT,
  pipSize: 0.01,
  maxScalpStopPips: 25,
  scalpTargetRiskPct: 2,
};
