from __future__ import annotations

from dataclasses import dataclass

from app.data.provider import Candle
from app.indicators.technical import atr
from app.market_structure.structure import Structure


@dataclass(frozen=True)
class RiskLevels:
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_reward: float


def calculate_levels(candles: list[Candle], structure: Structure, side: str, target_rr: float = 2.0) -> RiskLevels:
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    closes = [c.close for c in candles]
    current_atr = atr(highs, lows, closes)
    entry = closes[-1]

    if side == "BUY":
        structural_stop = min(structure.swing_low, entry - 1.2 * current_atr)
        stop = max(structural_stop, entry - 2.2 * current_atr)
        risk = entry - stop
        tp1 = entry + risk * 1.5
        tp2 = entry + risk * target_rr
    else:
        structural_stop = max(structure.swing_high, entry + 1.2 * current_atr)
        stop = min(structural_stop, entry + 2.2 * current_atr)
        risk = stop - entry
        tp1 = entry - risk * 1.5
        tp2 = entry - risk * target_rr

    rr = abs(tp2 - entry) / max(abs(entry - stop), 1e-9)
    return RiskLevels(round(entry, 2), round(stop, 2), round(tp1, 2), round(tp2, 2), round(rr, 2))
