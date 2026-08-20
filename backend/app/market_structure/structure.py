from __future__ import annotations

from dataclasses import dataclass

from app.data.provider import Candle


@dataclass(frozen=True)
class Structure:
    direction: str
    swing_high: float
    swing_low: float
    breakout: bool
    retest: bool


def analyze_structure(candles: list[Candle], lookback: int = 30) -> Structure:
    if len(candles) < lookback + 3:
        raise ValueError("Not enough candles for structure")
    window = candles[-lookback - 1:-1]
    recent = candles[-1]
    midpoint = len(window) // 2
    old = window[:midpoint]
    new = window[midpoint:]
    old_high = max(c.high for c in old)
    old_low = min(c.low for c in old)
    new_high = max(c.high for c in new)
    new_low = min(c.low for c in new)

    if new_high > old_high and new_low > old_low:
        direction = "BULLISH"
    elif new_high < old_high and new_low < old_low:
        direction = "BEARISH"
    else:
        direction = "RANGE"

    swing_high = max(c.high for c in window)
    swing_low = min(c.low for c in window)
    bullish_break = recent.close > swing_high
    bearish_break = recent.close < swing_low
    breakout = bullish_break or bearish_break

    prev = candles[-2]
    retest = False
    if direction == "BULLISH":
        level = max(c.high for c in candles[-lookback - 2:-2])
        retest = prev.close > level and recent.low <= level * 1.0008 and recent.close > level
    elif direction == "BEARISH":
        level = min(c.low for c in candles[-lookback - 2:-2])
        retest = prev.close < level and recent.high >= level * 0.9992 and recent.close < level

    return Structure(direction, swing_high, swing_low, breakout, retest)
