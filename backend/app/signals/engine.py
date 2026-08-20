from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from app.data.provider import Candle
from app.indicators.technical import adx, ema, macd, rsi
from app.market_structure.structure import analyze_structure
from app.regime.classifier import classify_regime
from app.risk.levels import calculate_levels


@dataclass
class TimeframeAnalysis:
    timeframe: str
    bias: str
    score: int
    rsi: float
    adx: float
    structure: str


@dataclass
class SignalDecision:
    symbol: str
    signal: str
    confidence: int
    entry_price: float | None
    stop_loss: float | None
    take_profit_1: float | None
    take_profit_2: float | None
    risk_reward: float | None
    market_regime: str
    timestamp: str
    status: str
    reasons: list[str]
    timeframe_analysis: list[dict]
    strategy_name: str = "xau_confluence"
    strategy_version: str = "0.1.0"

    def to_dict(self) -> dict:
        return asdict(self)


def analyze_timeframe(candles: list[Candle], timeframe: str) -> TimeframeAnalysis:
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    e20 = ema(closes, 20)[-1]
    e50 = ema(closes, 50)[-1]
    e200 = ema(closes, 200)[-1]
    current_rsi = rsi(closes)
    current_adx = adx(highs, lows, closes)
    macd_line, macd_signal, histogram = macd(closes)
    structure = analyze_structure(candles)
    last = closes[-1]

    bull = 0
    bear = 0
    if e20 > e50 > e200:
        bull += 30
    elif e20 < e50 < e200:
        bear += 30
    if last > e200:
        bull += 10
    elif last < e200:
        bear += 10
    if 52 <= current_rsi <= 72:
        bull += 15
    elif 28 <= current_rsi <= 48:
        bear += 15
    if macd_line > macd_signal and histogram > 0:
        bull += 15
    elif macd_line < macd_signal and histogram < 0:
        bear += 15
    if structure.direction == "BULLISH":
        bull += 20
    elif structure.direction == "BEARISH":
        bear += 20
    if current_adx >= 25:
        if bull > bear:
            bull += 10
        elif bear > bull:
            bear += 10

    if bull >= 60 and bull > bear:
        bias = "BUY"
        score = min(bull, 100)
    elif bear >= 60 and bear > bull:
        bias = "SELL"
        score = min(bear, 100)
    else:
        bias = "NEUTRAL"
        score = max(bull, bear)
    return TimeframeAnalysis(timeframe, bias, score, round(current_rsi, 1), round(current_adx, 1), structure.direction)


def generate_signal(
    candles_5m: list[Candle],
    candles_15m: list[Candle],
    candles_1h: list[Candle],
    min_score: int = 85,
    min_rr: float = 1.5,
) -> SignalDecision:
    analyses = [
        analyze_timeframe(candles_5m, "5m"),
        analyze_timeframe(candles_15m, "15m"),
        analyze_timeframe(candles_1h, "1h"),
    ]
    a5, a15, a1h = analyses
    regime = classify_regime(candles_15m)
    reasons: list[str] = []

    directional = a1h.bias in {"BUY", "SELL"} and a1h.bias == a15.bias == a5.bias
    if not directional:
        reasons.append("Multi-timeframe alignment belum lengkap")
        return SignalDecision("XAU/USD", "NO_TRADE", max(a.score for a in analyses), None, None, None, None, None, regime, datetime.now(timezone.utc).isoformat(), "WAITING", reasons, [asdict(a) for a in analyses])

    side = a15.bias
    weighted_score = round(a1h.score * 0.35 + a15.score * 0.45 + a5.score * 0.20)
    structure = analyze_structure(candles_15m)

    if a1h.adx < 20 or a15.adx < 20:
        reasons.append("Trend strength belum cukup")
    if regime in {"UNCERTAIN", "HIGH_VOLATILITY"}:
        reasons.append(f"Market regime {regime} difilter")
    if weighted_score < min_score:
        reasons.append(f"Confluence score {weighted_score} di bawah threshold {min_score}")

    critical_fail = bool(reasons)
    if critical_fail:
        return SignalDecision("XAU/USD", "NO_TRADE", weighted_score, None, None, None, None, None, regime, datetime.now(timezone.utc).isoformat(), "WAITING", reasons, [asdict(a) for a in analyses])

    levels = calculate_levels(candles_15m, structure, side)
    if levels.risk_reward < min_rr:
        return SignalDecision("XAU/USD", "NO_TRADE", weighted_score, None, None, None, None, levels.risk_reward, regime, datetime.now(timezone.utc).isoformat(), "WAITING", [f"Risk/reward {levels.risk_reward} < {min_rr}"], [asdict(a) for a in analyses])

    reasons = [
        f"1H, 15M, dan 5M aligned {side}",
        f"15M structure {structure.direction.lower()}",
        f"15M ADX {a15.adx} menunjukkan trend strength memadai",
        f"15M RSI {a15.rsi} mendukung momentum",
        f"Market regime: {regime}",
        f"Risk/reward {levels.risk_reward}:1",
    ]
    return SignalDecision(
        "XAU/USD", side, weighted_score, levels.entry, levels.stop_loss,
        levels.take_profit_1, levels.take_profit_2, levels.risk_reward,
        regime, datetime.now(timezone.utc).isoformat(), "ACTIVE", reasons,
        [asdict(a) for a in analyses]
    )
