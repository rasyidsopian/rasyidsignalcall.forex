from __future__ import annotations

from math import sqrt
from typing import Sequence


def ema(values: Sequence[float], period: int) -> list[float]:
    if period <= 0 or len(values) < period:
        raise ValueError("Not enough values for EMA")
    k = 2 / (period + 1)
    seed = sum(values[:period]) / period
    out = [seed]
    previous = seed
    for value in values[period:]:
        previous = value * k + previous * (1 - k)
        out.append(previous)
    return out


def rsi(values: Sequence[float], period: int = 14) -> float:
    if len(values) <= period:
        raise ValueError("Not enough values for RSI")
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(x, 0.0) for x in changes]
    losses = [max(-x, 0.0) for x in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(changes)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14) -> float:
    if not (len(highs) == len(lows) == len(closes)) or len(closes) <= period:
        raise ValueError("Not enough values for ATR")
    tr: list[float] = []
    for i in range(1, len(closes)):
        tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    current = sum(tr[:period]) / period
    for value in tr[period:]:
        current = ((current * (period - 1)) + value) / period
    return current


def macd(values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[float, float, float]:
    if len(values) < slow + signal:
        raise ValueError("Not enough values for MACD")
    fast_series = ema(values, fast)
    slow_series = ema(values, slow)
    offset = len(fast_series) - len(slow_series)
    line = [fast_series[i + offset] - slow_series[i] for i in range(len(slow_series))]
    signal_series = ema(line, signal)
    macd_value = line[-1]
    signal_value = signal_series[-1]
    return macd_value, signal_value, macd_value - signal_value


def adx(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14) -> float:
    if len(closes) < period * 2 + 2:
        raise ValueError("Not enough values for ADX")
    trs: list[float] = []
    plus_dm: list[float] = []
    minus_dm: list[float] = []
    for i in range(1, len(closes)):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))

    tr_s = sum(trs[:period])
    plus_s = sum(plus_dm[:period])
    minus_s = sum(minus_dm[:period])
    dx: list[float] = []
    for i in range(period, len(trs)):
        tr_s = tr_s - tr_s / period + trs[i]
        plus_s = plus_s - plus_s / period + plus_dm[i]
        minus_s = minus_s - minus_s / period + minus_dm[i]
        plus_di = 100 * plus_s / tr_s if tr_s else 0
        minus_di = 100 * minus_s / tr_s if tr_s else 0
        denom = plus_di + minus_di
        dx.append(100 * abs(plus_di - minus_di) / denom if denom else 0)
    if len(dx) < period:
        return sum(dx) / max(len(dx), 1)
    current = sum(dx[:period]) / period
    for value in dx[period:]:
        current = ((current * (period - 1)) + value) / period
    return current


def bollinger_width(values: Sequence[float], period: int = 20, deviations: float = 2.0) -> float:
    if len(values) < period:
        raise ValueError("Not enough values for Bollinger width")
    sample = values[-period:]
    mean = sum(sample) / period
    variance = sum((x - mean) ** 2 for x in sample) / period
    sd = sqrt(variance)
    if mean == 0:
        return 0.0
    return ((mean + deviations * sd) - (mean - deviations * sd)) / mean
