from __future__ import annotations

from app.data.provider import Candle
from app.indicators.technical import adx, atr, bollinger_width, ema


def classify_regime(candles: list[Candle]) -> str:
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    ema20 = ema(closes, 20)[-1]
    ema50 = ema(closes, 50)[-1]
    strength = adx(highs, lows, closes)
    volatility = atr(highs, lows, closes) / closes[-1]
    bb_width = bollinger_width(closes)

    if volatility > 0.0045:
        return "HIGH_VOLATILITY"
    if strength >= 25 and ema20 > ema50:
        return "TRENDING_UP"
    if strength >= 25 and ema20 < ema50:
        return "TRENDING_DOWN"
    if strength < 18 and bb_width < 0.01:
        return "LOW_VOLATILITY"
    if strength < 22:
        return "RANGING"
    return "UNCERTAIN"
