import type { Candle, Signal, TimeframeAnalysis } from "../types";

type Structure = {
  direction: "BULLISH" | "BEARISH" | "RANGE";
  swingHigh: number;
  swingLow: number;
  breakout: boolean;
  retest: boolean;
};

function ema(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) throw new Error("Not enough values for EMA");
  const k = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [previous];
  for (const value of values.slice(period)) {
    previous = value * k + previous * (1 - k);
    out.push(previous);
  }
  return out;
}

function rsi(values: number[], period = 14): number {
  if (values.length <= period) throw new Error("Not enough values for RSI");
  const changes = values.slice(1).map((v, i) => v - values[i]);
  const gains = changes.map((x) => Math.max(x, 0));
  const losses = changes.map((x) => Math.max(-x, 0));
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length <= period) throw new Error("Not enough values for ATR");
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let current = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const value of tr.slice(period)) current = (current * (period - 1) + value) / period;
  return current;
}

function macd(values: number[], fast = 12, slow = 26, signal = 9): [number, number, number] {
  if (values.length < slow + signal) throw new Error("Not enough values for MACD");
  const fastSeries = ema(values, fast);
  const slowSeries = ema(values, slow);
  const offset = fastSeries.length - slowSeries.length;
  const line = slowSeries.map((v, i) => fastSeries[i + offset] - v);
  const signalSeries = ema(line, signal);
  const macdValue = line.at(-1)!;
  const signalValue = signalSeries.at(-1)!;
  return [macdValue, signalValue, macdValue - signalValue];
}

function adx(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period * 2 + 2) throw new Error("Not enough values for ADX");
  const trs: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let trS = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plusS = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let minusS = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  const dx: number[] = [];
  for (let i = period; i < trs.length; i++) {
    trS = trS - trS / period + trs[i];
    plusS = plusS - plusS / period + plusDm[i];
    minusS = minusS - minusS / period + minusDm[i];
    const plusDi = trS ? (100 * plusS) / trS : 0;
    const minusDi = trS ? (100 * minusS) / trS : 0;
    const denom = plusDi + minusDi;
    dx.push(denom ? (100 * Math.abs(plusDi - minusDi)) / denom : 0);
  }
  if (dx.length < period) return dx.reduce((a, b) => a + b, 0) / Math.max(dx.length, 1);
  let current = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const value of dx.slice(period)) current = (current * (period - 1) + value) / period;
  return current;
}

function bollingerWidth(values: number[], period = 20, deviations = 2): number {
  const sample = values.slice(-period);
  if (sample.length < period) throw new Error("Not enough values for Bollinger width");
  const mean = sample.reduce((a, b) => a + b, 0) / period;
  const variance = sample.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return mean === 0 ? 0 : ((mean + deviations * sd) - (mean - deviations * sd)) / mean;
}

function analyzeStructure(candles: Candle[], lookback = 30): Structure {
  if (candles.length < lookback + 3) throw new Error("Not enough candles for structure");
  const window = candles.slice(-lookback - 1, -1);
  const recent = candles.at(-1)!;
  const midpoint = Math.floor(window.length / 2);
  const old = window.slice(0, midpoint);
  const newer = window.slice(midpoint);
  const oldHigh = Math.max(...old.map((c) => c.high));
  const oldLow = Math.min(...old.map((c) => c.low));
  const newHigh = Math.max(...newer.map((c) => c.high));
  const newLow = Math.min(...newer.map((c) => c.low));
  let direction: Structure["direction"] = "RANGE";
  if (newHigh > oldHigh && newLow > oldLow) direction = "BULLISH";
  else if (newHigh < oldHigh && newLow < oldLow) direction = "BEARISH";
  const swingHigh = Math.max(...window.map((c) => c.high));
  const swingLow = Math.min(...window.map((c) => c.low));
  const breakout = recent.close > swingHigh || recent.close < swingLow;
  const prev = candles.at(-2)!;
  let retest = false;
  if (direction === "BULLISH") {
    const level = Math.max(...candles.slice(-lookback - 2, -2).map((c) => c.high));
    retest = prev.close > level && recent.low <= level * 1.0008 && recent.close > level;
  } else if (direction === "BEARISH") {
    const level = Math.min(...candles.slice(-lookback - 2, -2).map((c) => c.low));
    retest = prev.close < level && recent.high >= level * 0.9992 && recent.close < level;
  }
  return { direction, swingHigh, swingLow, breakout, retest };
}

function classifyRegime(candles: Candle[]): string {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const ema20 = ema(closes, 20).at(-1)!;
  const ema50 = ema(closes, 50).at(-1)!;
  const strength = adx(highs, lows, closes);
  const volatility = atr(highs, lows, closes) / closes.at(-1)!;
  const bbWidth = bollingerWidth(closes);
  if (volatility > 0.0045) return "HIGH_VOLATILITY";
  if (strength >= 25 && ema20 > ema50) return "TRENDING_UP";
  if (strength >= 25 && ema20 < ema50) return "TRENDING_DOWN";
  if (strength < 18 && bbWidth < 0.01) return "LOW_VOLATILITY";
  if (strength < 22) return "RANGING";
  return "UNCERTAIN";
}

function analyzeTimeframe(candles: Candle[], timeframe: string): TimeframeAnalysis {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const e20 = ema(closes, 20).at(-1)!;
  const e50 = ema(closes, 50).at(-1)!;
  const e200 = ema(closes, 200).at(-1)!;
  const currentRsi = rsi(closes);
  const currentAdx = adx(highs, lows, closes);
  const [macdLine, macdSignal, histogram] = macd(closes);
  const structure = analyzeStructure(candles);
  const last = closes.at(-1)!;
  let bull = 0;
  let bear = 0;
  if (e20 > e50 && e50 > e200) bull += 30;
  else if (e20 < e50 && e50 < e200) bear += 30;
  if (last > e200) bull += 10;
  else if (last < e200) bear += 10;
  if (currentRsi >= 52 && currentRsi <= 72) bull += 15;
  else if (currentRsi >= 28 && currentRsi <= 48) bear += 15;
  if (macdLine > macdSignal && histogram > 0) bull += 15;
  else if (macdLine < macdSignal && histogram < 0) bear += 15;
  if (structure.direction === "BULLISH") bull += 20;
  else if (structure.direction === "BEARISH") bear += 20;
  if (currentAdx >= 25) {
    if (bull > bear) bull += 10;
    else if (bear > bull) bear += 10;
  }
  let bias: TimeframeAnalysis["bias"] = "NEUTRAL";
  let score = Math.max(bull, bear);
  if (bull >= 60 && bull > bear) { bias = "BUY"; score = Math.min(bull, 100); }
  else if (bear >= 60 && bear > bull) { bias = "SELL"; score = Math.min(bear, 100); }
  return {
    timeframe,
    bias,
    score,
    rsi: Math.round(currentRsi * 10) / 10,
    adx: Math.round(currentAdx * 10) / 10,
    structure: structure.direction,
  };
}

function riskLevels(candles: Candle[], structure: Structure, side: "BUY" | "SELL") {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const currentAtr = atr(highs, lows, closes);
  const entry = closes.at(-1)!;
  let stop: number;
  let tp1: number;
  let tp2: number;
  if (side === "BUY") {
    const structuralStop = Math.min(structure.swingLow, entry - 1.2 * currentAtr);
    stop = Math.max(structuralStop, entry - 2.2 * currentAtr);
    const risk = entry - stop;
    tp1 = entry + risk * 1.5;
    tp2 = entry + risk * 2;
  } else {
    const structuralStop = Math.max(structure.swingHigh, entry + 1.2 * currentAtr);
    stop = Math.min(structuralStop, entry + 2.2 * currentAtr);
    const risk = stop - entry;
    tp1 = entry - risk * 1.5;
    tp2 = entry - risk * 2;
  }
  const rr = Math.abs(tp2 - entry) / Math.max(Math.abs(entry - stop), 1e-9);
  const round = (x: number) => Math.round(x * 100) / 100;
  return { entry: round(entry), stop: round(stop), tp1: round(tp1), tp2: round(tp2), rr: round(rr) };
}

export function generateSignal(c5: Candle[], c15: Candle[], c1h: Candle[], minScore = 85, minRr = 1.5): Signal {
  const analyses = [analyzeTimeframe(c5, "5m"), analyzeTimeframe(c15, "15m"), analyzeTimeframe(c1h, "1h")];
  const [a5, a15, a1h] = analyses;
  const regime = classifyRegime(c15);
  const timestamp = new Date().toISOString();
  const noTrade = (confidence: number, reasons: string[], rr: number | null = null): Signal => ({
    symbol: "XAU/USD", signal: "NO_TRADE", confidence, entry_price: null, stop_loss: null,
    take_profit_1: null, take_profit_2: null, risk_reward: rr, market_regime: regime, timestamp,
    status: "WAITING", reasons, timeframe_analysis: analyses, strategy_name: "xau_confluence_client", strategy_version: "0.2.0",
  });

  const directional = a1h.bias !== "NEUTRAL" && a1h.bias === a15.bias && a15.bias === a5.bias;
  if (!directional) return noTrade(Math.max(...analyses.map((a) => a.score)), ["Multi-timeframe alignment belum lengkap"]);
  const side = a15.bias as "BUY" | "SELL";
  const weightedScore = Math.round(a1h.score * 0.35 + a15.score * 0.45 + a5.score * 0.2);
  const reasons: string[] = [];
  if (a1h.adx < 20 || a15.adx < 20) reasons.push("Trend strength belum cukup");
  if (["UNCERTAIN", "HIGH_VOLATILITY"].includes(regime)) reasons.push(`Market regime ${regime} difilter`);
  if (weightedScore < minScore) reasons.push(`Confluence score ${weightedScore} di bawah threshold ${minScore}`);
  if (reasons.length) return noTrade(weightedScore, reasons);
  const structure = analyzeStructure(c15);
  const levels = riskLevels(c15, structure, side);
  if (levels.rr < minRr) return noTrade(weightedScore, [`Risk/reward ${levels.rr} < ${minRr}`], levels.rr);
  return {
    symbol: "XAU/USD", signal: side, confidence: weightedScore, entry_price: levels.entry, stop_loss: levels.stop,
    take_profit_1: levels.tp1, take_profit_2: levels.tp2, risk_reward: levels.rr, market_regime: regime, timestamp,
    status: "ACTIVE", reasons: [
      `1H, 15M, dan 5M aligned ${side}`,
      `15M structure ${structure.direction.toLowerCase()}`,
      `15M ADX ${a15.adx} menunjukkan trend strength memadai`,
      `15M RSI ${a15.rsi} mendukung momentum`,
      `Market regime: ${regime}`,
      `Risk/reward ${levels.rr}:1`,
    ], timeframe_analysis: analyses, strategy_name: "xau_confluence_client", strategy_version: "0.2.0",
  };
}
