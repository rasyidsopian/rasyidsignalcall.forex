import type { BacktestStats, BacktestTrade, Candle, Signal, TimeframeAnalysis } from "../types";

type Structure = {
  direction: "BULLISH" | "BEARISH" | "RANGE";
  swingHigh: number;
  swingLow: number;
  breakout: boolean;
  retest: boolean;
};

const TF_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  if (!dx.length) return 0;
  if (dx.length < period) return dx.reduce((a, b) => a + b, 0) / dx.length;
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

function completedBefore(candles: Candle[], timeframe: string, evaluationMs: number): Candle[] {
  const duration = (TF_MINUTES[timeframe] ?? 1) * 60_000;
  return candles.filter((c) => new Date(c.timestamp).getTime() + duration <= evaluationMs + 1000);
}

function analyzeStructure(candles: Candle[], lookback = 24): Structure {
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
  return "MIXED";
}

function analyzeTimeframe(candles: Candle[], timeframe: string): TimeframeAnalysis {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  if (closes.length < 205) throw new Error(`Not enough ${timeframe} candles`);

  const e20Series = ema(closes, 20);
  const e50Series = ema(closes, 50);
  const e200Series = ema(closes, 200);
  const e20 = e20Series.at(-1)!;
  const e50 = e50Series.at(-1)!;
  const e200 = e200Series.at(-1)!;
  const e20Prev = e20Series.at(-4) ?? e20;
  const currentRsi = rsi(closes);
  const currentAdx = adx(highs, lows, closes);
  const [macdLine, macdSignal, histogram] = macd(closes);
  const structure = analyzeStructure(candles);
  const last = closes.at(-1)!;

  let bull = 0;
  let bear = 0;
  if (e20 > e50 && e50 > e200) bull += 30;
  else if (e20 < e50 && e50 < e200) bear += 30;
  else if (e20 > e50) bull += 18;
  else if (e20 < e50) bear += 18;

  if (last > e200) bull += 10;
  else if (last < e200) bear += 10;

  if (e20 > e20Prev) bull += 10;
  else if (e20 < e20Prev) bear += 10;

  if (currentRsi >= 55 && currentRsi <= 72) bull += 15;
  else if (currentRsi > 72) bull += 8;
  else if (currentRsi <= 45 && currentRsi >= 28) bear += 15;
  else if (currentRsi < 28) bear += 8;

  if (macdLine > macdSignal && histogram > 0) bull += 15;
  else if (macdLine < macdSignal && histogram < 0) bear += 15;

  if (structure.direction === "BULLISH") bull += 15;
  else if (structure.direction === "BEARISH") bear += 15;

  if (structure.breakout || structure.retest) {
    if (last >= e20) bull += 5;
    else bear += 5;
  }

  if (currentAdx >= 25) {
    if (bull > bear) bull += 5;
    else if (bear > bull) bear += 5;
  }

  let directionalScore = clamp(bull - bear, -100, 100);
  // Never leave the execution stack directionless. Use price/EMA slope as a small tie-breaker.
  if (directionalScore === 0) directionalScore = last >= e50 ? 5 : -5;
  const bias: TimeframeAnalysis["bias"] = directionalScore > 0 ? "BUY" : "SELL";
  const score = clamp(Math.round(50 + Math.abs(directionalScore) * 0.5), 50, 100);
  const emaState = e20 > e50 && e50 > e200 ? "BULL_STACK" : e20 < e50 && e50 < e200 ? "BEAR_STACK" : e20 >= e50 ? "BULL_LEAN" : "BEAR_LEAN";

  return {
    timeframe,
    bias,
    score,
    directionalScore: Math.round(directionalScore),
    rsi: Math.round(currentRsi * 10) / 10,
    adx: Math.round(currentAdx * 10) / 10,
    structure: structure.direction,
    emaState,
  };
}

function riskLevels(c1: Candle[], side: "BUY" | "SELL") {
  const highs = c1.map((c) => c.high);
  const lows = c1.map((c) => c.low);
  const closes = c1.map((c) => c.close);
  const currentAtr = atr(highs, lows, closes);
  const entry = closes.at(-1)!;
  const recent = c1.slice(-18);
  const recentLow = Math.min(...recent.map((c) => c.low));
  const recentHigh = Math.max(...recent.map((c) => c.high));
  let risk: number;
  if (side === "BUY") {
    const structureRisk = Math.max(0, entry - recentLow + currentAtr * 0.12);
    risk = clamp(Math.max(currentAtr * 1.05, structureRisk), currentAtr * 0.8, currentAtr * 2.0);
  } else {
    const structureRisk = Math.max(0, recentHigh - entry + currentAtr * 0.12);
    risk = clamp(Math.max(currentAtr * 1.05, structureRisk), currentAtr * 0.8, currentAtr * 2.0);
  }
  const stop = side === "BUY" ? entry - risk : entry + risk;
  const tp1 = side === "BUY" ? entry + risk : entry - risk;
  const tp2 = side === "BUY" ? entry + risk * 1.5 : entry - risk * 1.5;
  const round = (x: number) => Math.round(x * 100) / 100;
  return { entry: round(entry), stop: round(stop), tp1: round(tp1), tp2: round(tp2), rr: 1.5 };
}

export function generateSignal(
  c1Raw: Candle[],
  c5Raw: Candle[],
  c15Raw: Candle[],
  c1hRaw: Candle[],
  c4hRaw: Candle[],
  evaluationMs?: number,
  liveIntrabar = false,
): Signal {
  const evalMs = evaluationMs ?? Date.now();
  const select = (rows: Candle[], tf: string) => liveIntrabar
    ? rows.filter((c) => new Date(c.timestamp).getTime() <= evalMs)
    : completedBefore(rows, tf, evalMs);
  const c1 = select(c1Raw, "1m");
  const c5 = select(c5Raw, "5m");
  const c15 = select(c15Raw, "15m");
  const c1h = select(c1hRaw, "1h");
  const c4h = select(c4hRaw, "4h");

  const analyses = [
    analyzeTimeframe(c4h, "4h"),
    analyzeTimeframe(c1h, "1h"),
    analyzeTimeframe(c15, "15m"),
    analyzeTimeframe(c5, "5m"),
    analyzeTimeframe(c1, "1m"),
  ];
  const [a4h, a1h, a15, a5, a1] = analyses;
  const weights = [0.12, 0.23, 0.27, 0.23, 0.15];
  const net = analyses.reduce((sum, a, i) => sum + a.directionalScore * weights[i], 0);
  const side: "BUY" | "SELL" = net >= 0 ? "BUY" : "SELL";
  const agreement = analyses.filter((a) => a.bias === side).length;
  let confidence = Math.round(50 + Math.abs(net) * 0.45 + Math.max(0, agreement - 3) * 2);
  confidence = clamp(confidence, 51, 97);
  const regime = classifyRegime(c15);
  const levels = riskLevels(c1, side);
  const last1 = c1.at(-1)!;

  const opposite = analyses.filter((a) => a.bias !== side).map((a) => a.timeframe.toUpperCase());
  const reasons = [
    `4H context ${a4h.bias} (${a4h.score}/100) · 1H bias ${a1h.bias} (${a1h.score}/100)`,
    `15M setup ${a15.bias} · structure ${a15.structure.toLowerCase()} · ADX ${a15.adx}`,
    `5M momentum ${a5.bias} · RSI ${a5.rsi} · ADX ${a5.adx}`,
    `1M trigger ${a1.bias} · RSI ${a1.rsi} · EMA ${a1.emaState.replaceAll("_", " ").toLowerCase()}`,
    `${agreement}/5 timeframe mendukung ${side}${opposite.length ? `; kontra: ${opposite.join(", ")}` : ""}`,
    `Regime 15M: ${regime}`,
  ];

  return {
    symbol: "XAU/USD",
    signal: side,
    confidence,
    entry_price: levels.entry,
    stop_loss: levels.stop,
    take_profit_1: levels.tp1,
    take_profit_2: levels.tp2,
    risk_reward: levels.rr,
    market_regime: regime,
    timestamp: liveIntrabar ? new Date(evalMs).toISOString() : new Date(new Date(last1.timestamp).getTime() + 60_000).toISOString(),
    status: liveIntrabar ? (confidence >= 75 ? "LIVE HIGH" : confidence >= 62 ? "LIVE VALID" : "LIVE LOW EDGE") : (confidence >= 75 ? "HIGH_CONVICTION" : confidence >= 62 ? "VALID" : "LOW_EDGE"),
    reasons,
    timeframe_analysis: analyses,
    strategy_name: "xau_mtf_scalper",
    strategy_version: liveIntrabar ? "2.0.0-live" : "2.0.0",
  };
}

function statsFromTrades(trades: BacktestTrade[]): BacktestStats {
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const sampleSize = wins + losses;
  return {
    winRate: sampleSize ? Math.round((wins / sampleSize) * 1000) / 10 : null,
    wins,
    losses,
    sampleSize,
    profitFactor: losses ? Math.round((wins / losses) * 100) / 100 : wins ? 99 : null,
    trades,
  };
}

export function backtestStrategy(
  c1: Candle[],
  c5: Candle[],
  c15: Candle[],
  c1h: Candle[],
  c4h: Candle[],
  maxTrades = 120,
): BacktestStats {
  const trades: BacktestTrade[] = [];
  const horizon = 20; // max holding time: 20 one-minute candles
  const start = Math.max(230, c1.length - 1100);

  for (let i = start; i < c1.length - horizon - 2; i += 5) {
    const evaluationMs = new Date(c1[i].timestamp).getTime() + 60_000;
    try {
      const signal = generateSignal(
        c1.slice(0, i + 1),
        c5,
        c15,
        c1h,
        c4h,
        evaluationMs,
      );
      const future = c1.slice(i + 1, i + 1 + horizon);
      let result: "WIN" | "LOSS" | null = null;
      for (const bar of future) {
        const slHit = signal.signal === "BUY" ? bar.low <= signal.stop_loss : bar.high >= signal.stop_loss;
        const tpHit = signal.signal === "BUY" ? bar.high >= signal.take_profit_1 : bar.low <= signal.take_profit_1;
        if (slHit && tpHit) { result = "LOSS"; break; } // conservative when intrabar order is unknown
        if (slHit) { result = "LOSS"; break; }
        if (tpHit) { result = "WIN"; break; }
      }
      if (result) {
        trades.push({
          timestamp: signal.timestamp,
          side: signal.signal,
          confidence: signal.confidence,
          regime: signal.market_regime,
          result,
        });
      }
    } catch {
      // Not enough synchronized history at this timestamp; skip without fabricating a result.
    }
  }

  return statsFromTrades(trades.slice(-maxTrades));
}

export function matchingSetupStats(stats: BacktestStats, signal: Signal): BacktestStats {
  const band = Math.floor(signal.confidence / 10) * 10;
  let matches = stats.trades.filter(
    (t) => t.side === signal.signal && t.regime === signal.market_regime && t.confidence >= band && t.confidence < band + 10,
  );
  if (matches.length < 12) {
    matches = stats.trades.filter((t) => t.side === signal.signal && Math.abs(t.confidence - signal.confidence) <= 10);
  }
  if (matches.length < 12) matches = stats.trades.filter((t) => t.side === signal.signal);
  return statsFromTrades(matches.slice(-60));
}
