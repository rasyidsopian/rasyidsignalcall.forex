import type { BacktestStats, BacktestTrade, Candle, Signal, TimeframeAnalysis } from "../types";

type Structure = {
  direction: "BULLISH" | "BEARISH" | "RANGE";
  swingHigh: number;
  swingLow: number;
  breakout: boolean;
  retest: boolean;
};

type RiskPlan = {
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  rr: number;
  risk: number;
  executionMode: "ENTER_NOW" | "WAIT_PULLBACK";
  notes: string[];
};

const TF_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
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
  if (volatility > 0.0035) return "HIGH_VOLATILITY";
  if (strength >= 24 && ema20 > ema50) return "TRENDING_UP";
  if (strength >= 24 && ema20 < ema50) return "TRENDING_DOWN";
  if (strength < 18 && bbWidth < 0.006) return "LOW_VOLATILITY";
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
  if (e20 > e50 && e50 > e200) bull += 28;
  else if (e20 < e50 && e50 < e200) bear += 28;
  else if (e20 > e50) bull += 18;
  else if (e20 < e50) bear += 18;

  if (last > e200) bull += 8;
  else if (last < e200) bear += 8;

  if (e20 > e20Prev) bull += 12;
  else if (e20 < e20Prev) bear += 12;

  if (currentRsi >= 53 && currentRsi <= 70) bull += 16;
  else if (currentRsi > 70) bull += 7;
  else if (currentRsi <= 47 && currentRsi >= 30) bear += 16;
  else if (currentRsi < 30) bear += 7;

  if (macdLine > macdSignal && histogram > 0) bull += 16;
  else if (macdLine < macdSignal && histogram < 0) bear += 16;

  if (structure.direction === "BULLISH") bull += 15;
  else if (structure.direction === "BEARISH") bear += 15;

  if (structure.breakout || structure.retest) {
    if (last >= e20) bull += 5;
    else bear += 5;
  }

  if (currentAdx >= 24) {
    if (bull > bear) bull += 5;
    else if (bear > bull) bear += 5;
  }

  let directionalScore = clamp(bull - bear, -100, 100);
  if (directionalScore === 0) directionalScore = last >= e50 ? 4 : -4;
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

function confirmedPivots(candles: Candle[], side: "LOW" | "HIGH", lookback = 45): number[] {
  const rows = candles.slice(-lookback - 4);
  const out: number[] = [];
  for (let i = 2; i < rows.length - 2; i++) {
    if (side === "LOW") {
      const v = rows[i].low;
      if (v < rows[i - 1].low && v <= rows[i - 2].low && v < rows[i + 1].low && v <= rows[i + 2].low) out.push(v);
    } else {
      const v = rows[i].high;
      if (v > rows[i - 1].high && v >= rows[i - 2].high && v > rows[i + 1].high && v >= rows[i + 2].high) out.push(v);
    }
  }
  return out;
}

function liquiditySweep(c1: Candle[], side: "BUY" | "SELL") {
  if (c1.length < 14) return null;
  const recent = c1.at(-1)!;
  const prev = c1.slice(-11, -1);
  if (side === "BUY") {
    const low = Math.min(...prev.map((c) => c.low));
    return recent.low < low && recent.close > low ? recent.low : null;
  }
  const high = Math.max(...prev.map((c) => c.high));
  return recent.high > high && recent.close < high ? recent.high : null;
}

function nearestFiveMinuteTarget(c5: Candle[], side: "BUY" | "SELL", entry: number): number | null {
  const pivots = confirmedPivots(c5, side === "BUY" ? "HIGH" : "LOW", 60);
  if (side === "BUY") {
    const candidates = pivots.filter((x) => x > entry).sort((a, b) => a - b);
    return candidates[0] ?? null;
  }
  const candidates = pivots.filter((x) => x < entry).sort((a, b) => b - a);
  return candidates[0] ?? null;
}

function buildRiskPlan(c1: Candle[], c5: Candle[], side: "BUY" | "SELL", a1: TimeframeAnalysis, a5: TimeframeAnalysis): RiskPlan {
  const c1Highs = c1.map((c) => c.high);
  const c1Lows = c1.map((c) => c.low);
  const c1Closes = c1.map((c) => c.close);
  const c5Highs = c5.map((c) => c.high);
  const c5Lows = c5.map((c) => c.low);
  const c5Closes = c5.map((c) => c.close);
  const atr1 = atr(c1Highs, c1Lows, c1Closes);
  const atr5 = atr(c5Highs, c5Lows, c5Closes);
  const e20 = ema(c1Closes, 20).at(-1)!;
  const current = c1Closes.at(-1)!;
  const pivots = confirmedPivots(c1, side === "BUY" ? "LOW" : "HIGH");
  const sweep = liquiditySweep(c1, side);
  const notes: string[] = [];

  let executionMode: RiskPlan["executionMode"] = "ENTER_NOW";
  const extension = Math.abs(current - e20) / Math.max(atr1, 0.01);
  if (a1.bias !== side || a5.bias !== side || extension > 0.72) executionMode = "WAIT_PULLBACK";

  const fallbackWindow = c1.slice(-22, -2);
  const fallbackAnchor = side === "BUY"
    ? Math.min(...fallbackWindow.map((c) => c.low))
    : Math.max(...fallbackWindow.map((c) => c.high));
  const pivotAnchor = pivots.at(-1) ?? fallbackAnchor;
  let anchor = sweep == null ? pivotAnchor : (side === "BUY" ? Math.min(pivotAnchor, sweep) : Math.max(pivotAnchor, sweep));
  const buffer = Math.max(atr1 * 0.22, atr5 * 0.055);

  let entry = current;
  let stop = side === "BUY" ? anchor - buffer : anchor + buffer;
  let risk = Math.abs(entry - stop);
  const minRisk = Math.max(atr1 * 0.88, atr5 * 0.15);
  if (risk < minRisk) {
    stop = side === "BUY" ? entry - minRisk : entry + minRisk;
    risk = minRisk;
    notes.push("SL diperlebar sedikit di luar noise 1M/ATR agar tidak terlalu ketat.");
  }

  const maxComfortRisk = Math.max(atr1 * 1.45, atr5 * 0.72);
  if (risk > maxComfortRisk) {
    executionMode = "WAIT_PULLBACK";
    const ideal = side === "BUY" ? Math.min(current, e20 + atr1 * 0.12) : Math.max(current, e20 - atr1 * 0.12);
    entry = ideal;
    risk = Math.abs(entry - stop);
    notes.push("Harga terlalu jauh dari micro value; tunggu pullback untuk mengecilkan jarak SL.");
  }

  const minimumProtectedRisk = Math.max(atr1 * 0.82, atr5 * 0.13);
  if ((side === "BUY" && entry <= stop) || (side === "SELL" && entry >= stop)) {
    entry = side === "BUY" ? stop + minimumProtectedRisk : stop - minimumProtectedRisk;
    executionMode = "WAIT_PULLBACK";
  }
  risk = Math.abs(entry - stop);
  if (risk < minimumProtectedRisk) {
    stop = side === "BUY" ? entry - minimumProtectedRisk : entry + minimumProtectedRisk;
    risk = minimumProtectedRisk;
  }

  const target1R = 1.6;
  const target2R = 2.2;
  let tp1 = side === "BUY" ? entry + risk * target1R : entry - risk * target1R;
  let tp2 = side === "BUY" ? entry + risk * target2R : entry - risk * target2R;

  const structuralTarget = nearestFiveMinuteTarget(c5, side, entry);
  if (structuralTarget != null) {
    const availableR = Math.abs(structuralTarget - entry) / Math.max(risk, 0.01);
    if (availableR < 1.45) {
      executionMode = "WAIT_PULLBACK";
      notes.push("Ruang ke liquidity 5M terlalu sempit; tunggu entry lebih baik sebelum eksekusi.");
    } else if (availableR < target2R) {
      const cushion = Math.max(atr1 * 0.12, 0.08);
      tp2 = side === "BUY" ? structuralTarget - cushion : structuralTarget + cushion;
      notes.push("TP2 dipasang sebelum liquidity/swing 5M terdekat agar lebih realistis.");
    }
  }

  const actualRr = Math.abs(tp2 - entry) / Math.max(risk, 0.01);
  if (actualRr < 1.55) executionMode = "WAIT_PULLBACK";
  if (sweep != null) notes.push("SL diletakkan di luar wick liquidity sweep terbaru + ATR buffer.");
  else notes.push("SL diletakkan di luar confirmed micro swing + ATR buffer, bukan tepat di swing.");

  return {
    entry: round2(entry),
    stop: round2(stop),
    tp1: round2(tp1),
    tp2: round2(tp2),
    rr: Math.round(actualRr * 10) / 10,
    risk: round2(risk),
    executionMode,
    notes,
  };
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

  // Scalping V4: 80% of directional decision comes from 1M/5M/15M. Higher TFs are context only.
  const weights = [0.03, 0.05, 0.12, 0.38, 0.42];
  const net = analyses.reduce((sum, a, i) => sum + a.directionalScore * weights[i], 0);
  const side: "BUY" | "SELL" = net >= 0 ? "BUY" : "SELL";
  const microAgreement = Number(a1.bias === side) + Number(a5.bias === side);
  const setupAgreement = Number(a15.bias === side);
  const contextAgreement = Number(a1h.bias === side) + Number(a4h.bias === side);

  let confidence = Math.round(
    48 + Math.abs(net) * 0.38 + microAgreement * 7 + setupAgreement * 4 + contextAgreement * 1.5,
  );
  if (a1.bias !== a5.bias) confidence -= 8;
  confidence = clamp(confidence, 51, 96);

  const regime = classifyRegime(c5);
  const levels = buildRiskPlan(c1, c5, side, a1, a5);
  if (levels.executionMode === "ENTER_NOW") confidence = clamp(confidence + 3, 51, 96);
  else confidence = clamp(confidence - 4, 51, 96);

  const setupGrade: Signal["setup_grade"] = levels.executionMode === "ENTER_NOW" && confidence >= 80 && levels.rr >= 1.8
    ? "A"
    : levels.executionMode === "ENTER_NOW" && confidence >= 68
      ? "B"
      : "C";

  const last1 = c1.at(-1)!;
  const reasons = [
    `Micro focus: 1M ${a1.bias} (${a1.score}/100) + 5M ${a5.bias} (${a5.score}/100) menyumbang 80% bobot arah.`,
    `15M hanya setup context ${a15.bias}; 1H/4H dipakai sebagai filter, bukan penentu utama entry scalp.`,
    `5M regime ${regime.replaceAll("_", " ")} · 5M RSI ${a5.rsi} · ADX ${a5.adx}.`,
    `1M trigger ${a1.bias} · RSI ${a1.rsi} · EMA ${a1.emaState.replaceAll("_", " ").toLowerCase()}.`,
    ...levels.notes,
    `Execution ${levels.executionMode === "ENTER_NOW" ? "ENTER NOW" : "WAIT PULLBACK"} · planned TP2 R:R ${levels.rr.toFixed(1)}R.`,
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
    status: levels.executionMode === "ENTER_NOW" ? `${side} NOW · GRADE ${setupGrade}` : `${side} BIAS · WAIT PULLBACK`,
    execution_mode: levels.executionMode,
    setup_grade: setupGrade,
    current_price: round2(c1Raw.at(-1)?.close ?? levels.entry),
    risk_distance: levels.risk,
    reasons,
    timeframe_analysis: analyses,
    strategy_name: "xau_microstructure_scalper",
    strategy_version: liveIntrabar ? "3.0.0-live" : "3.0.0",
  };
}

function statsFromTrades(trades: BacktestTrade[]): BacktestStats {
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const sampleSize = wins + losses;
  const averageRiskReward = trades.length
    ? Math.round((trades.reduce((s, t) => s + t.riskReward, 0) / trades.length) * 100) / 100
    : null;
  return {
    winRate: sampleSize ? Math.round((wins / sampleSize) * 1000) / 10 : null,
    wins,
    losses,
    sampleSize,
    profitFactor: losses ? Math.round((wins * 1.6 / losses) * 100) / 100 : wins ? 99 : null,
    averageRiskReward,
    trades,
  };
}

export function backtestStrategy(
  c1: Candle[],
  c5: Candle[],
  c15: Candle[],
  c1h: Candle[],
  c4h: Candle[],
  maxTrades = 160,
): BacktestStats {
  const trades: BacktestTrade[] = [];
  const horizon = 15; // scalp test: max holding time 15 one-minute candles
  const start = Math.max(230, c1.length - 1300);

  for (let i = start; i < c1.length - horizon - 2; i += 2) {
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
      // Win-rate is only reported for entries the engine itself marked executable.
      if (signal.execution_mode !== "ENTER_NOW") continue;

      const future = c1.slice(i + 1, i + 1 + horizon);
      let result: "WIN" | "LOSS" | null = null;
      for (const bar of future) {
        const slHit = signal.signal === "BUY" ? bar.low <= signal.stop_loss : bar.high >= signal.stop_loss;
        const tpHit = signal.signal === "BUY" ? bar.high >= signal.take_profit_1 : bar.low <= signal.take_profit_1;
        if (slHit && tpHit) { result = "LOSS"; break; }
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
          riskReward: signal.risk_reward,
        });
      }
    } catch {
      // Skip timestamps without enough synchronized closed history.
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
  return statsFromTrades(matches.slice(-80));
}
