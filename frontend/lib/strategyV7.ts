import type { BacktestStats, BacktestTrade, Candle, Signal, TimeframeAnalysis } from "../types";
import type { MarketFrames } from "./marketData";
import { generateSignal } from "./signalEngine";
import type { AccountConfig as V5AccountConfig } from "./strategyV5";

export type AccountConfig = V5AccountConfig & {
  /** User convention: XAUUSD 1 pip = $0.10 price movement. */
  pipSize: number;
  maxScalpStopPips: number;
  maxDailyStopPips: number;
  scalpTargetRiskPct: number;
  dailyTargetRiskPct: number;
};

export type RiskAssessment = {
  riskUsd: number;
  riskIdr: number;
  riskPct: number;
  maxRiskPct: number;
  withinBudget: boolean;
  recommendedLotPerPosition: number;
  blendedRewardR: number;
  action: "ENTER_NOW" | "WAIT" | "SKIP_RISK" | "MARKET_CLOSED";
  message: string;
  stopPips: number;
  balanceCapPips: number;
  maxStopPips: number;
};

export type FibMap = {
  swingLow: number;
  swingHigh: number;
  fib50: number;
  fib618: number;
  fib705: number;
};

export type TradeSetup = {
  kind: "SCALPING" | "DAILY";
  side: "BUY" | "SELL";
  confidence: number;
  zoneScore: number;
  zoneGrade: "A+" | "A" | "B" | "C";
  zoneSource: string;
  entry: number;
  exactEntry: number;
  stop: number;
  tp1: number;
  tp2: number;
  rr1: number;
  rr2: number;
  blendedRr: number;
  status: string;
  reasons: string[];
  timeframeAnalysis: TimeframeAnalysis[];
  marketRegime: string;
  risk: RiskAssessment;
  beRule: string;
  entryZoneLow: number;
  entryZoneHigh: number;
  stopPips: number;
  maxStopPips: number;
  predictiveAction: "ENTER_NOW" | "WAIT_PULLBACK" | "WAIT_RECLAIM" | "PREP_ONLY";
  fib: FibMap;
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
  exactEntry: number;
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

function slope(values: number[]) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den ? num / den : 0;
}

function confirmedPivot(candles: Candle[], side: "BUY" | "SELL", lookback = 36): number | null {
  const rows = candles.slice(-lookback - 4);
  const out: number[] = [];
  for (let i = 2; i < rows.length - 2; i++) {
    if (side === "BUY") {
      const v = rows[i].low;
      if (v <= rows[i - 1].low && v < rows[i - 2].low && v <= rows[i + 1].low && v < rows[i + 2].low) out.push(v);
    } else {
      const v = rows[i].high;
      if (v >= rows[i - 1].high && v > rows[i - 2].high && v >= rows[i + 1].high && v > rows[i + 2].high) out.push(v);
    }
  }
  return out.at(-1) ?? null;
}

function recentSweep(candles: Candle[], side: "BUY" | "SELL", lookback = 12) {
  if (candles.length < lookback + 2) return null;
  const last = candles.at(-1)!;
  const prior = candles.slice(-(lookback + 1), -1);
  if (side === "BUY") {
    const low = Math.min(...prior.map((c) => c.low));
    return last.low < low && last.close > low ? last.low : null;
  }
  const high = Math.max(...prior.map((c) => c.high));
  return last.high > high && last.close < high ? last.high : null;
}

function nearestLiquidity(candles: Candle[], side: "BUY" | "SELL", entry: number, lookback = 60): number | null {
  const rows = candles.slice(-lookback, -2);
  if (side === "BUY") {
    const levels = rows.map((c) => c.high).filter((v) => v > entry).sort((a, b) => a - b);
    return levels[0] ?? null;
  }
  const levels = rows.map((c) => c.low).filter((v) => v < entry).sort((a, b) => b - a);
  return levels[0] ?? null;
}

function fibMap(candles: Candle[], side: "BUY" | "SELL", lookback: number): FibMap {
  const rows = candles.slice(-lookback);
  const swingLow = Math.min(...rows.map((c) => c.low));
  const swingHigh = Math.max(...rows.map((c) => c.high));
  const range = Math.max(swingHigh - swingLow, 0.01);
  if (side === "BUY") {
    return {
      swingLow,
      swingHigh,
      fib50: swingHigh - range * 0.5,
      fib618: swingHigh - range * 0.618,
      fib705: swingHigh - range * 0.705,
    };
  }
  return {
    swingLow,
    swingHigh,
    fib50: swingLow + range * 0.5,
    fib618: swingLow + range * 0.618,
    fib705: swingLow + range * 0.705,
  };
}

function weightedSide(base: Signal, kind: "SCALPING" | "DAILY") {
  const order = ["4h", "1h", "15m", "5m", "1m"];
  const weights = kind === "SCALPING"
    ? [0.03, 0.05, 0.12, 0.38, 0.42]
    : [0.12, 0.24, 0.30, 0.22, 0.12];
  const rows = order.map((tf) => base.timeframe_analysis.find((r) => r.timeframe === tf)!);
  const net = rows.reduce((sum, row, i) => sum + row.directionalScore * weights[i], 0);
  return { side: (net >= 0 ? "BUY" : "SELL") as "BUY" | "SELL", net, rows };
}

function maxBalanceDistance(config: AccountConfig, riskPct: number) {
  const totalLots = Math.max(config.positions * config.lotPerPosition, 0.0001);
  const riskIdr = config.balanceIdr * (riskPct / 100);
  const riskUsd = riskIdr / Math.max(config.usdIdr, 1);
  return riskUsd / Math.max(config.contractSizeOz * totalLots, 0.0001);
}

function riskFromPlan(
  entry: number,
  stop: number,
  tp1: number,
  tp2: number,
  config: AccountConfig,
  riskTargetPct: number,
  stopCapPips: number,
  action: RiskAssessment["action"],
): RiskAssessment {
  const distance = Math.abs(entry - stop);
  const totalLots = Math.max(config.positions * config.lotPerPosition, 0.0001);
  const riskUsd = distance * config.contractSizeOz * totalLots;
  const riskIdr = riskUsd * config.usdIdr;
  const riskPct = config.balanceIdr > 0 ? riskIdr / config.balanceIdr * 100 : 999;
  const rr1 = distance ? Math.abs(tp1 - entry) / distance : 0;
  const rr2 = distance ? Math.abs(tp2 - entry) / distance : 0;
  const blendedRewardR = (rr1 + rr2) / 2;
  const pip = Math.max(config.pipSize, 0.0001);
  const balanceCapPips = maxBalanceDistance(config, riskTargetPct) / pip;
  const stopPips = distance / pip;
  const maxStopPips = Math.min(stopCapPips, balanceCapPips);
  const withinBudget = stopPips <= maxStopPips + 0.15;
  return {
    riskUsd: round2(riskUsd),
    riskIdr: Math.round(riskIdr),
    riskPct: Math.round(riskPct * 10) / 10,
    maxRiskPct: riskTargetPct,
    withinBudget,
    recommendedLotPerPosition: config.lotPerPosition,
    blendedRewardR: Math.round(blendedRewardR * 100) / 100,
    action,
    message: action === "ENTER_NOW"
      ? `Harga sudah di mapped zone. Eksekusi ${stopPips.toFixed(1)} pips dari SL; total risk ${riskPct.toFixed(1)}% saldo.`
      : `Belum di mapped zone. Exact plan sudah fixed; tunggu harga menyentuh zone supaya risk tetap ${riskPct.toFixed(1)}% atau lebih kecil.`,
    stopPips: Math.round(stopPips * 10) / 10,
    balanceCapPips: Math.round(balanceCapPips * 10) / 10,
    maxStopPips: Math.round(maxStopPips * 10) / 10,
  };
}

function zoneGrade(score: number): TradeSetup["zoneGrade"] {
  if (score >= 88) return "A+";
  if (score >= 78) return "A";
  if (score >= 68) return "B";
  return "C";
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

function buildMappedPlan(
  frames: MarketFrames,
  base: Signal,
  config: AccountConfig,
  kind: "SCALPING" | "DAILY",
): TradeSetup {
  const current = frames.c1.at(-1)?.close ?? base.current_price;
  const pip = Math.max(config.pipSize, 0.0001);
  const { side, net, rows } = weightedSide(base, kind);
  const [a4h, a1h, a15, a5, a1] = rows;
  const riskTargetPct = kind === "SCALPING" ? config.scalpTargetRiskPct : config.dailyTargetRiskPct;
  const stopCapPips = kind === "SCALPING" ? config.maxScalpStopPips : config.maxDailyStopPips;
  const hardCapDistance = Math.max(4 * pip, stopCapPips * pip);
  const balanceCapDistance = Math.max(4 * pip, maxBalanceDistance(config, riskTargetPct));
  const cap = Math.min(hardCapDistance, balanceCapDistance);

  const structureTf = kind === "SCALPING" ? frames.c1 : frames.c5;
  const fibTf = kind === "SCALPING" ? frames.c5 : frames.c15;
  const targetTf = kind === "SCALPING" ? frames.c5 : frames.c15;
  const fib = fibMap(fibTf, side, kind === "SCALPING" ? 36 : 48);
  const fibLow = Math.min(fib.fib618, fib.fib705);
  const fibHigh = Math.max(fib.fib618, fib.fib705);
  const closesMicro = (kind === "SCALPING" ? frames.c1 : frames.c5).map((c) => c.close);
  const emaFast = ema(closesMicro, kind === "SCALPING" ? 9 : 20);
  const emaSlow = ema(closesMicro, kind === "SCALPING" ? 20 : 50);
  const emaValue = emaFast * 0.62 + emaSlow * 0.38;
  const atrMicro = Math.max(atr(kind === "SCALPING" ? frames.c1 : frames.c5), 2 * pip);
  const atrContext = Math.max(atr(kind === "SCALPING" ? frames.c5 : frames.c15), 3 * pip);

  const fallbackWindow = structureTf.slice(kind === "SCALPING" ? -18 : -28, -1);
  const fallbackAnchor = side === "BUY"
    ? Math.min(...fallbackWindow.map((c) => c.low))
    : Math.max(...fallbackWindow.map((c) => c.high));
  const pivot = confirmedPivot(structureTf, side, kind === "SCALPING" ? 32 : 44) ?? fallbackAnchor;
  const sweep = recentSweep(structureTf, side, kind === "SCALPING" ? 10 : 14);
  const anchor = sweep == null ? pivot : (side === "BUY" ? Math.min(pivot, sweep) : Math.max(pivot, sweep));
  const buffer = clamp(atrMicro * (kind === "SCALPING" ? 0.08 : 0.10), 1.5 * pip, 4 * pip);
  const stop = side === "BUY" ? anchor - buffer : anchor + buffer;

  // Candidate center combines OTE Fibonacci + EMA value. Then the zone is clamped to the account-derived stop cap.
  const fibMid = (fibLow + fibHigh) / 2;
  let center = fibMid * (kind === "SCALPING" ? 0.56 : 0.66) + emaValue * (kind === "SCALPING" ? 0.44 : 0.34);
  const minDistance = Math.max(4 * pip, cap * (kind === "SCALPING" ? 0.40 : 0.46));
  const maxDistance = Math.max(minDistance + 2 * pip, cap * 0.92);
  if (side === "BUY") center = clamp(center, stop + minDistance, stop + maxDistance);
  else center = clamp(center, stop - maxDistance, stop - minDistance);

  // Liquidity-aware adjustment: move the predictive entry closer to the stop when needed to preserve >=2R room.
  const targetLiquidity = nearestLiquidity(targetTf, side, center, kind === "SCALPING" ? 60 : 80);
  if (targetLiquidity != null) {
    const minTargetR = kind === "SCALPING" ? 1.8 : 2.0;
    if (side === "BUY") {
      const maxEntryForR = (targetLiquidity + minTargetR * stop) / (1 + minTargetR);
      center = Math.min(center, maxEntryForR);
      center = clamp(center, stop + minDistance, stop + maxDistance);
    } else {
      const minEntryForR = (targetLiquidity + minTargetR * stop) / (1 + minTargetR);
      center = Math.max(center, minEntryForR);
      center = clamp(center, stop - maxDistance, stop - minDistance);
    }
  }

  const zoneHalf = clamp(Math.min(atrMicro * 0.14, cap * 0.13), 1.5 * pip, Math.max(2.5 * pip, cap * 0.16));
  let entryZoneLow = center - zoneHalf;
  let entryZoneHigh = center + zoneHalf;
  if (side === "BUY") {
    entryZoneLow = Math.max(entryZoneLow, stop + minDistance);
    entryZoneHigh = Math.min(entryZoneHigh, stop + maxDistance);
  } else {
    entryZoneLow = Math.max(entryZoneLow, stop - maxDistance);
    entryZoneHigh = Math.min(entryZoneHigh, stop - minDistance);
  }
  if (entryZoneLow > entryZoneHigh) [entryZoneLow, entryZoneHigh] = [entryZoneHigh, entryZoneLow];

  entryZoneLow = round2(entryZoneLow);
  entryZoneHigh = round2(entryZoneHigh);
  const inZone = current >= entryZoneLow - pip * 0.2 && current <= entryZoneHigh + pip * 0.2;

  // User requirement: once price enters the mapped zone, the call becomes decisive BUY/SELL. No extra WAIT gate inside the zone.
  const predictiveAction: TradeSetup["predictiveAction"] = inZone
    ? "ENTER_NOW"
    : side === "BUY"
      ? (current < entryZoneLow ? "WAIT_RECLAIM" : "WAIT_PULLBACK")
      : (current > entryZoneHigh ? "WAIT_RECLAIM" : "WAIT_PULLBACK");

  const exactEntry = round2(inZone ? current : center);
  const riskDist = Math.max(Math.abs(exactEntry - stop), 2 * pip);
  const target1R = kind === "SCALPING" ? 1.8 : 2.0;
  const target2R = kind === "SCALPING" ? 2.8 : 3.0;
  let tp1 = side === "BUY" ? exactEntry + riskDist * target1R : exactEntry - riskDist * target1R;
  let tp2 = side === "BUY" ? exactEntry + riskDist * target2R : exactEntry - riskDist * target2R;

  if (targetLiquidity != null) {
    const availableR = Math.abs(targetLiquidity - exactEntry) / Math.max(riskDist, pip);
    if (availableR >= target1R + 0.15 && availableR < target2R) {
      const cushion = 1.5 * pip;
      tp2 = side === "BUY" ? targetLiquidity - cushion : targetLiquidity + cushion;
    }
  }

  const rr1 = Math.abs(tp1 - exactEntry) / Math.max(riskDist, pip);
  const rr2 = Math.abs(tp2 - exactEntry) / Math.max(riskDist, pip);
  const action: RiskAssessment["action"] = predictiveAction === "ENTER_NOW" ? "ENTER_NOW" : "WAIT";
  const risk = riskFromPlan(exactEntry, stop, tp1, tp2, config, riskTargetPct, stopCapPips, action);

  const fibOverlap = emaValue >= fibLow - atrMicro * 0.25 && emaValue <= fibHigh + atrMicro * 0.25;
  const microAlignment = Number(a1.bias === side) + Number(a5.bias === side);
  const contextAlignment = Number(a15.bias === side) + Number(a1h.bias === side) + Number(a4h.bias === side);
  const momentumHealthy = side === "BUY" ? a1.rsi >= 42 && a1.rsi <= 72 : a1.rsi <= 58 && a1.rsi >= 28;
  const rrQuality = rr1 >= target1R - 0.05 && rr2 >= target1R + 0.5;
  const zoneScore = clamp(Math.round(
    48
    + Math.min(18, Math.abs(net) * 0.22)
    + microAlignment * (kind === "SCALPING" ? 8 : 5)
    + contextAlignment * (kind === "SCALPING" ? 2 : 5)
    + Number(fibOverlap) * 8
    + Number(sweep != null) * 6
    + Number(momentumHealthy) * 5
    + Number(rrQuality) * 5,
  ), 45, 98);
  const confidence = clamp(Math.round(base.confidence * 0.52 + zoneScore * 0.48), 50, 97);

  const status = predictiveAction === "ENTER_NOW"
    ? `ENTER ${side} NOW`
    : `WAIT ${side} ZONE`;
  const zoneSource = kind === "SCALPING"
    ? "5M FIB OTE + 1M EMA VALUE + MICRO PIVOT/LIQUIDITY"
    : "15M FIB OTE + 5M EMA VALUE + ACCOUNT-CAPPED STRUCTURE";

  return {
    kind,
    side,
    confidence,
    zoneScore,
    zoneGrade: zoneGrade(zoneScore),
    zoneSource,
    entry: exactEntry,
    exactEntry,
    stop: round2(stop),
    tp1: round2(tp1),
    tp2: round2(tp2),
    rr1: Math.round(rr1 * 100) / 100,
    rr2: Math.round(rr2 * 100) / 100,
    blendedRr: risk.blendedRewardR,
    status,
    reasons: [
      `${kind === "SCALPING" ? "Scalp" : "Daily"} mapped zone memakai Fibonacci 61.8–70.5%, EMA value, confirmed pivot, liquidity sweep, RSI/ADX/MACD confluence dari engine utama.`,
      `Pip convention V7: 1 pip = $${pip.toFixed(2)} per XAUUSD price. Jadi 25 pips = $${(25 * pip).toFixed(2)} price movement.`,
      `Account cap: target risk ${riskTargetPct.toFixed(1)}% saldo → effective max ${risk.maxStopPips.toFixed(1)} pips, walau hard cap ${stopCapPips} pips.`,
      `Mapped zone ${entryZoneLow.toFixed(2)} – ${entryZoneHigh.toFixed(2)} · exact entry ${exactEntry.toFixed(2)} · SL ${round2(stop).toFixed(2)}.`,
      `FIB 50 ${fib.fib50.toFixed(2)} · 61.8 ${fib.fib618.toFixed(2)} · 70.5 ${fib.fib705.toFixed(2)} · ${fibOverlap ? "EMA/FIB overlap valid" : "EMA/FIB overlap partial"}.`,
      `${kind === "SCALPING" ? `1M ${a1.bias} + 5M ${a5.bias}` : `15M ${a15.bias} + 1H ${a1h.bias}`} · zone grade ${zoneGrade(zoneScore)} (${zoneScore}/100).`,
      predictiveAction === "ENTER_NOW"
        ? `PRICE IN ZONE → FIX ${side}. Tidak ada WAIT tambahan di dalam zone.`
        : `Harga belum menyentuh zone. Jangan chase; exact plan tetap ${exactEntry.toFixed(2)} / SL ${round2(stop).toFixed(2)}.`,
    ],
    timeframeAnalysis: base.timeframe_analysis,
    marketRegime: base.market_regime,
    risk,
    beRule: kind === "SCALPING"
      ? "Jangan BE sebelum minimal +1R dan 1M close tetap searah. Setelah valid, posisi #2 boleh diamankan ke BE +1 pip."
      : "Daily: jangan BE sebelum +1.25R dan 15M structure masih valid. Posisi #1 ke TP1; posisi #2 dibiarkan menuju TP2 selama structure belum invalid.",
    entryZoneLow,
    entryZoneHigh,
    stopPips: risk.stopPips,
    maxStopPips: risk.maxStopPips,
    predictiveAction,
    fib,
  };
}

export function buildScalpingSetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const base = generateSignal(frames.c1, frames.c5, frames.c15, frames.c1h, frames.c4h, nowMs, true);
  return buildMappedPlan(frames, base, config, "SCALPING");
}

export function buildDailySetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const base = generateSignal(frames.c1, frames.c5, frames.c15, frames.c1h, frames.c4h, nowMs, true);
  return buildMappedPlan(frames, base, config, "DAILY");
}


export function fastUpdateSetupForPrice(setup: TradeSetup, price: number, config: AccountConfig): TradeSetup {
  if (!Number.isFinite(price) || price <= 0) return setup;
  const pip = Math.max(config.pipSize, 0.0001);
  const inZone = price >= setup.entryZoneLow - pip * 0.2 && price <= setup.entryZoneHigh + pip * 0.2;
  const predictiveAction: TradeSetup["predictiveAction"] = inZone
    ? "ENTER_NOW"
    : setup.side === "BUY"
      ? (price < setup.entryZoneLow ? "WAIT_RECLAIM" : "WAIT_PULLBACK")
      : (price > setup.entryZoneHigh ? "WAIT_RECLAIM" : "WAIT_PULLBACK");
  const exactEntry = inZone ? round2(price) : setup.exactEntry;
  const riskDist = Math.max(Math.abs(exactEntry - setup.stop), 2 * pip);
  const tp1 = setup.side === "BUY" ? exactEntry + riskDist * setup.rr1 : exactEntry - riskDist * setup.rr1;
  const tp2 = setup.side === "BUY" ? exactEntry + riskDist * setup.rr2 : exactEntry - riskDist * setup.rr2;
  const targetRiskPct = setup.kind === "SCALPING" ? config.scalpTargetRiskPct : config.dailyTargetRiskPct;
  const capPips = setup.kind === "SCALPING" ? config.maxScalpStopPips : config.maxDailyStopPips;
  const risk = riskFromPlan(exactEntry, setup.stop, tp1, tp2, config, targetRiskPct, capPips, inZone ? "ENTER_NOW" : "WAIT");
  return {
    ...setup,
    entry: exactEntry,
    exactEntry,
    tp1: round2(tp1),
    tp2: round2(tp2),
    status: inZone ? `ENTER ${setup.side} NOW` : `WAIT ${setup.side} ZONE`,
    predictiveAction,
    risk,
    stopPips: risk.stopPips,
    maxStopPips: risk.maxStopPips,
    blendedRr: risk.blendedRewardR,
  };
}

export function buildPredictions(frames: MarketFrames, setup: TradeSetup): HorizonPrediction[] {
  const c1 = frames.c1.slice(-36);
  const c5 = frames.c5.slice(-18);
  const current = c1.at(-1)?.close ?? setup.exactEntry;
  const atr1 = Math.max(atr(c1), Math.max(0.01, setup.stopPips * 0.04));
  const slope1 = slope(c1.slice(-18).map((c) => c.close));
  const slope5 = slope(c5.slice(-10).map((c) => c.close)) / 5;
  const fast = slope1 * 0.80 + slope5 * 0.20;
  return ([1, 5, 10] as const).map((minutes) => {
    const projectedMove = fast * minutes;
    const projectedMid = current + projectedMove;
    const width = atr1 * Math.sqrt(minutes) * 0.38;
    const rawBias: "BUY" | "SELL" = projectedMove >= 0 ? "BUY" : "SELL";
    // Keep 1M/5M predictive horizon decisive when micro projection is nearly flat: inherit mapped side.
    const weakMove = Math.abs(projectedMove) < width * 0.18;
    const bias = weakMove ? setup.side : rawBias;
    const alignment = bias === setup.side ? "ALIGNED" : "CONFLICT";
    const normalized = Math.abs(projectedMove) / Math.max(width, 0.01);
    const edgeScore = clamp(Math.round(
      48 + normalized * 19 + (alignment === "ALIGNED" ? 10 : -6) + setup.zoneScore * 0.14 + (setup.predictiveAction === "ENTER_NOW" ? 6 : 0),
    ), 45, 96);
    const action = setup.predictiveAction === "ENTER_NOW" && alignment === "ALIGNED"
      ? `ENTER ${setup.side} NOW @ ${setup.exactEntry.toFixed(2)}`
      : alignment === "ALIGNED"
        ? `WAIT ${setup.side} ZONE @ ${setup.exactEntry.toFixed(2)}`
        : `HOLD · ${minutes}M projects ${bias}`;
    return {
      minutes,
      bias,
      edgeScore,
      projectedLow: round2(projectedMid - width),
      projectedHigh: round2(projectedMid + width),
      projectedMid: round2(projectedMid),
      alignment,
      action,
      exactEntry: setup.exactEntry,
      entryZoneLow: setup.entryZoneLow,
      entryZoneHigh: setup.entryZoneHigh,
      stop: setup.stop,
      tp1: setup.tp1,
      tp2: setup.tp2,
      rr: setup.rr2,
      note: `${minutes}m scenario memakai live 1M/5M slope + mapped Fibonacci/liquidity zone. Edge score adalah confluence score, bukan guaranteed win probability.`,
    };
  });
}

function statsFromTrades(trades: BacktestTrade[], nominalWinR: number): BacktestStats {
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const sampleSize = wins + losses;
  return {
    winRate: sampleSize ? Math.round(wins / sampleSize * 1000) / 10 : null,
    wins,
    losses,
    sampleSize,
    profitFactor: losses ? Math.round((wins * nominalWinR / losses) * 100) / 100 : wins ? 99 : null,
    averageRiskReward: trades.length ? Math.round(trades.reduce((s, t) => s + t.riskReward, 0) / trades.length * 100) / 100 : null,
    trades,
  };
}

function backtestMapped(frames: MarketFrames, config: AccountConfig, kind: "SCALPING" | "DAILY", maxTrades: number): BacktestStats {
  const trades: BacktestTrade[] = [];
  const c1 = frames.c1;
  const start = Math.max(280, c1.length - (kind === "SCALPING" ? 1200 : 1500));
  const step = kind === "SCALPING" ? 3 : 15;
  const horizon = kind === "SCALPING" ? 12 : 120;
  for (let i = start; i < c1.length - horizon - 1; i += step) {
    const evalMs = new Date(c1[i].timestamp).getTime() + 60_000;
    try {
      const hist = selectedClosedFrames(frames, evalMs);
      if ([hist.c1, hist.c5, hist.c15, hist.c1h, hist.c4h].some((rows) => rows.length < 205)) continue;
      const base = generateSignal(hist.c1, hist.c5, hist.c15, hist.c1h, hist.c4h, evalMs, false);
      const setup = buildMappedPlan(hist, base, config, kind);
      if (setup.predictiveAction !== "ENTER_NOW" || setup.zoneScore < 70 || setup.rr1 < (kind === "SCALPING" ? 1.75 : 1.95)) continue;
      const future = c1.slice(i + 1, i + 1 + horizon);
      let result: "WIN" | "LOSS" | null = null;
      for (const bar of future) {
        const sl = setup.side === "BUY" ? bar.low <= setup.stop : bar.high >= setup.stop;
        const tp = setup.side === "BUY" ? bar.high >= setup.tp1 : bar.low <= setup.tp1;
        if (sl && tp) { result = "LOSS"; break; }
        if (sl) { result = "LOSS"; break; }
        if (tp) { result = "WIN"; break; }
      }
      if (result) trades.push({
        timestamp: new Date(evalMs).toISOString(),
        side: setup.side,
        confidence: setup.confidence,
        regime: setup.marketRegime,
        result,
        riskReward: setup.rr1,
      });
    } catch {}
  }
  return statsFromTrades(trades.slice(-maxTrades), kind === "SCALPING" ? 1.8 : 2.0);
}

export function backtestTightScalp(frames: MarketFrames, config: AccountConfig, maxTrades = 140) {
  return backtestMapped(frames, config, "SCALPING", maxTrades);
}

export function backtestDailyMapped(frames: MarketFrames, config: AccountConfig, maxTrades = 80) {
  return backtestMapped(frames, config, "DAILY", maxTrades);
}

export const DEFAULT_ACCOUNT: AccountConfig = {
  balanceIdr: 1_000_000,
  positions: 2,
  lotPerPosition: 0.01,
  contractSizeOz: 100,
  usdIdr: 16_000,
  scalpMaxRiskPct: 4,
  dailyMaxRiskPct: 5,
  // User-defined convention from this chat: 25 pips = $2.50 XAUUSD price movement.
  pipSize: 0.10,
  maxScalpStopPips: 25,
  maxDailyStopPips: 25,
  scalpTargetRiskPct: 4,
  dailyTargetRiskPct: 5,
};
