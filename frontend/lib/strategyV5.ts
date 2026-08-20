import type { Candle, Signal, TimeframeAnalysis } from "../types";
import type { MarketFrames } from "./marketData";
import { generateSignal } from "./signalEngine";

export type AccountConfig = {
  balanceIdr: number;
  positions: number;
  lotPerPosition: number;
  contractSizeOz: number;
  usdIdr: number;
  scalpMaxRiskPct: number;
  dailyMaxRiskPct: number;
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
};

export type TradeSetup = {
  kind: "SCALPING" | "DAILY";
  side: "BUY" | "SELL";
  confidence: number;
  entry: number;
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
};

export type HorizonPrediction = {
  minutes: 1 | 5 | 10;
  bias: "BUY" | "SELL";
  edgeScore: number;
  projectedLow: number;
  projectedHigh: number;
  projectedMid: number;
  alignment: "ALIGNED" | "CONFLICT";
  note: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function ema(values: number[], period: number) {
  if (values.length < period) return values.at(-1) ?? 0;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const next of values.slice(period)) value = next * k + value * (1 - k);
  return value;
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < period + 2) return 0;
  const rows = candles.slice(-(period + 1));
  const tr: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    tr.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low - rows[i - 1].close),
    ));
  }
  return tr.reduce((a, b) => a + b, 0) / tr.length;
}

function pivot(candles: Candle[], side: "BUY" | "SELL", lookback = 36) {
  const rows = candles.slice(-lookback, -2);
  if (!rows.length) return candles.at(-1)?.close ?? 0;
  return side === "BUY" ? Math.min(...rows.map((c) => c.low)) : Math.max(...rows.map((c) => c.high));
}

function fiveMinuteLiquidity(c5: Candle[], side: "BUY" | "SELL", entry: number) {
  const rows = c5.slice(-60, -2);
  const candidates = side === "BUY"
    ? rows.map((c) => c.high).filter((v) => v > entry).sort((a, b) => a - b)
    : rows.map((c) => c.low).filter((v) => v < entry).sort((a, b) => b - a);
  return candidates[0] ?? null;
}

function riskAssessment(
  entry: number,
  stop: number,
  tp1: number,
  tp2: number,
  config: AccountConfig,
  kind: "SCALPING" | "DAILY",
  baseAction: "ENTER_NOW" | "WAIT",
  marketClosed: boolean,
): RiskAssessment {
  const distance = Math.abs(entry - stop);
  const totalLots = config.positions * config.lotPerPosition;
  const riskUsd = distance * config.contractSizeOz * totalLots;
  const riskIdr = riskUsd * config.usdIdr;
  const riskPct = config.balanceIdr > 0 ? (riskIdr / config.balanceIdr) * 100 : 999;
  const maxRiskPct = kind === "SCALPING" ? config.scalpMaxRiskPct : config.dailyMaxRiskPct;
  const maxRiskUsd = (config.balanceIdr * (maxRiskPct / 100)) / Math.max(config.usdIdr, 1);
  const maxTotalLots = distance > 0 ? maxRiskUsd / (distance * config.contractSizeOz) : 0;
  const recommendedLotPerPosition = Math.max(0, maxTotalLots / Math.max(config.positions, 1));
  const rr1 = distance ? Math.abs(tp1 - entry) / distance : 0;
  const rr2 = distance ? Math.abs(tp2 - entry) / distance : 0;
  const blendedRewardR = (rr1 + rr2) / 2;
  const withinBudget = riskPct <= maxRiskPct && blendedRewardR >= (kind === "SCALPING" ? 1.65 : 1.9);

  let action: RiskAssessment["action"] = "ENTER_NOW";
  let message = "Risk budget dan R:R memenuhi filter.";
  if (marketClosed) {
    action = "MARKET_CLOSED";
    message = "Standard XAU/USD sedang tutup. Setup hanya untuk preparation; jangan entry tanpa tick broker live.";
  } else if (!withinBudget) {
    action = "SKIP_RISK";
    message = riskPct > maxRiskPct
      ? `2×${config.lotPerPosition.toFixed(3)} lot terlalu besar untuk SL struktural ini (${riskPct.toFixed(1)}% saldo).`
      : `Blended R:R ${blendedRewardR.toFixed(2)} belum cukup.`;
  } else if (baseAction === "WAIT") {
    action = "WAIT";
    message = "Arah ada, tapi harga belum di area entry yang efisien. Tunggu pullback/trigger.";
  }

  return {
    riskUsd: round2(riskUsd),
    riskIdr: Math.round(riskIdr),
    riskPct: Math.round(riskPct * 10) / 10,
    maxRiskPct,
    withinBudget,
    recommendedLotPerPosition: Math.round(recommendedLotPerPosition * 1000) / 1000,
    blendedRewardR: Math.round(blendedRewardR * 100) / 100,
    action,
    message,
  };
}

function standardSaturdayClosed() {
  if (typeof window === "undefined") return false;
  return new Date().getDay() === 6;
}

export function buildScalpingSetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const base: Signal = generateSignal(frames.c1, frames.c5, frames.c15, frames.c1h, frames.c4h, nowMs, true);
  const riskDist = Math.abs(base.entry_price - base.stop_loss);
  const rr1 = riskDist ? Math.abs(base.take_profit_1 - base.entry_price) / riskDist : 0;
  let tp1 = base.take_profit_1;
  let tp2 = base.take_profit_2;

  // V5: two-position plan. Pos-1 cashes at ~1.5R; Pos-2 targets >=2.5R when structure allows.
  if (riskDist > 0) {
    tp1 = base.signal === "BUY" ? base.entry_price + riskDist * 1.5 : base.entry_price - riskDist * 1.5;
    const structural = fiveMinuteLiquidity(frames.c5, base.signal, base.entry_price);
    const idealTp2 = base.signal === "BUY" ? base.entry_price + riskDist * 2.5 : base.entry_price - riskDist * 2.5;
    if (structural != null) {
      const structuralR = Math.abs(structural - base.entry_price) / riskDist;
      tp2 = structuralR >= 2.0
        ? (base.signal === "BUY" ? Math.min(idealTp2, structural - riskDist * 0.08) : Math.max(idealTp2, structural + riskDist * 0.08))
        : idealTp2;
    } else tp2 = idealTp2;
  }

  const microAligned = base.timeframe_analysis.find((x) => x.timeframe === "1m")?.bias === base.signal
    && base.timeframe_analysis.find((x) => x.timeframe === "5m")?.bias === base.signal;
  const baseAction: "ENTER_NOW" | "WAIT" = base.execution_mode === "ENTER_NOW" && microAligned ? "ENTER_NOW" : "WAIT";
  const risk = riskAssessment(base.entry_price, base.stop_loss, tp1, tp2, config, "SCALPING", baseAction, standardSaturdayClosed());
  const finalStatus = risk.action === "ENTER_NOW"
    ? `ENTER ${base.signal} NOW`
    : risk.action === "WAIT"
      ? `WAIT ${base.signal} PULLBACK`
      : risk.action === "SKIP_RISK"
        ? `NO ENTRY · RISK TOO HIGH`
        : "MARKET CLOSED · PREP ONLY";

  const rr2 = riskDist ? Math.abs(tp2 - base.entry_price) / riskDist : 0;
  return {
    kind: "SCALPING",
    side: base.signal,
    confidence: base.confidence,
    entry: base.entry_price,
    stop: base.stop_loss,
    tp1: round2(tp1),
    tp2: round2(tp2),
    rr1: Math.round(rr1 * 100) / 100,
    rr2: Math.round(rr2 * 100) / 100,
    blendedRr: risk.blendedRewardR,
    status: finalStatus,
    reasons: [
      ...base.reasons.slice(0, 5),
      "V5 entry gate: 1M + 5M harus searah; 15M hanya konfirmasi struktur agar tidak chase noise.",
      "2 posisi: posisi #1 target 1.5R, posisi #2 target sekitar 2.5R / sebelum liquidity 5M.",
      "BE rule: jangan buru-buru BE. Setelah TP1 kena, tunggu 1M close tetap searah lalu geser posisi #2 ke BE + 0.1R.",
      risk.message,
    ],
    timeframeAnalysis: base.timeframe_analysis,
    marketRegime: base.market_regime,
    risk,
    beRule: "Setelah TP1 hit + satu candle 1M close tetap searah, pindahkan SL posisi #2 ke entry +0.1R (BUY) / entry -0.1R (SELL).",
  };
}

export function buildDailySetup(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): TradeSetup {
  const base = generateSignal(frames.c1, frames.c5, frames.c15, frames.c1h, frames.c4h, nowMs, true);
  const [a4h, a1h, a15, a5, a1] = base.timeframe_analysis;
  const weights = [0.25, 0.35, 0.25, 0.1, 0.05];
  const net = base.timeframe_analysis.reduce((sum, row, i) => sum + row.directionalScore * weights[i], 0);
  const side: "BUY" | "SELL" = net >= 0 ? "BUY" : "SELL";
  const current = frames.c1.at(-1)?.close ?? base.current_price;
  const closes15 = frames.c15.map((c) => c.close);
  const atr15 = atr(frames.c15);
  const atr1h = atr(frames.c1h);
  const ema20_15 = ema(closes15, 20);
  const anchor = pivot(frames.c15, side, 48);
  const buffer = Math.max(atr15 * 0.22, atr1h * 0.06, 0.25);
  const stop = side === "BUY" ? anchor - buffer : anchor + buffer;
  let entry = current;
  const extension = Math.abs(current - ema20_15) / Math.max(atr15, 0.01);
  let baseAction: "ENTER_NOW" | "WAIT" = extension <= 0.7 && a15.bias === side && a1h.bias === side ? "ENTER_NOW" : "WAIT";
  if (baseAction === "WAIT") entry = side === "BUY" ? Math.min(current, ema20_15 + atr15 * 0.1) : Math.max(current, ema20_15 - atr15 * 0.1);
  const riskDist = Math.max(Math.abs(entry - stop), Math.max(atr15 * 0.65, atr1h * 0.12));
  const finalStop = side === "BUY" ? entry - riskDist : entry + riskDist;
  const tp1 = side === "BUY" ? entry + riskDist * 1.5 : entry - riskDist * 1.5;
  const tp2 = side === "BUY" ? entry + riskDist * 2.6 : entry - riskDist * 2.6;
  const contextAgreement = [a4h, a1h, a15].filter((x) => x.bias === side).length;
  const confidence = clamp(Math.round(55 + Math.abs(net) * 0.35 + contextAgreement * 5), 55, 95);
  const risk = riskAssessment(entry, finalStop, tp1, tp2, config, "DAILY", baseAction, standardSaturdayClosed());
  const status = risk.action === "ENTER_NOW"
    ? `DAILY ${side} · ENTER ZONE`
    : risk.action === "WAIT"
      ? `DAILY ${side} · WAIT AREA`
      : risk.action === "SKIP_RISK"
        ? "DAILY · NO ENTRY (RISK)"
        : "SATURDAY PLAN · MARKET CLOSED";

  return {
    kind: "DAILY",
    side,
    confidence,
    entry: round2(entry),
    stop: round2(finalStop),
    tp1: round2(tp1),
    tp2: round2(tp2),
    rr1: 1.5,
    rr2: 2.6,
    blendedRr: risk.blendedRewardR,
    status,
    reasons: [
      `Daily bias memakai 4H/1H/15M sebesar 85% bobot; 5M/1M hanya timing.` ,
      `4H ${a4h.bias} · 1H ${a1h.bias} · 15M ${a15.bias} · context agreement ${contextAgreement}/3.`,
      `Entry ${baseAction === "ENTER_NOW" ? "dekat value 15M" : "menunggu pullback ke value 15M"}; tidak chase harga yang terlalu extended.`,
      "SL daily berada di luar 15M structure + volatility buffer; lebih lebar daripada scalp sehingga lot risk gate menjadi penting.",
      risk.message,
    ],
    timeframeAnalysis: base.timeframe_analysis,
    marketRegime: base.market_regime,
    risk,
    beRule: "Daily: jangan pindah BE sebelum minimal +1R dan 15M structure tetap valid; setelah itu lindungi posisi #2 secara bertahap.",
  };
}

function linearSlope(values: number[]) {
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

export function buildPredictions(frames: MarketFrames, currentSetup: TradeSetup): HorizonPrediction[] {
  const c1 = frames.c1.slice(-40);
  const c5 = frames.c5.slice(-20);
  const current = c1.at(-1)?.close ?? currentSetup.entry;
  const atr1 = Math.max(atr(c1), 0.1);
  const slope1 = linearSlope(c1.slice(-20).map((c) => c.close));
  const slope5PerMin = linearSlope(c5.slice(-10).map((c) => c.close)) / 5;
  const blendedSlope = slope1 * 0.72 + slope5PerMin * 0.28;

  return ([1, 5, 10] as const).map((minutes) => {
    const projectedMove = blendedSlope * minutes;
    const projectedMid = current + projectedMove;
    const width = atr1 * Math.sqrt(minutes) * 0.55;
    const bias: "BUY" | "SELL" = projectedMove >= 0 ? "BUY" : "SELL";
    const normalized = Math.abs(projectedMove) / Math.max(width, 0.01);
    const alignment = bias === currentSetup.side ? "ALIGNED" : "CONFLICT";
    const edgeScore = clamp(Math.round(52 + normalized * 18 + (alignment === "ALIGNED" ? 7 : -4)), 50, 88);
    return {
      minutes,
      bias,
      edgeScore,
      projectedLow: round2(projectedMid - width),
      projectedHigh: round2(projectedMid + width),
      projectedMid: round2(projectedMid),
      alignment,
      note: `${minutes}m projection memakai slope 1M + 5M dan ATR band; ini scenario bias, bukan probabilitas terkalibrasi.`,
    };
  });
}

export const DEFAULT_ACCOUNT: AccountConfig = {
  balanceIdr: 1_000_000,
  positions: 2,
  lotPerPosition: 0.01,
  contractSizeOz: 100,
  usdIdr: 16_000,
  scalpMaxRiskPct: 2,
  dailyMaxRiskPct: 3,
};
