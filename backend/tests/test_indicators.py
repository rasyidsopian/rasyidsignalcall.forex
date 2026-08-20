from app.indicators.technical import atr, ema, rsi


def test_ema_trends_up():
    values = [float(i) for i in range(1, 80)]
    series = ema(values, 20)
    assert series[-1] > series[0]


def test_rsi_strong_uptrend():
    values = [100 + i for i in range(40)]
    assert rsi(values) > 90


def test_atr_positive():
    closes = [100 + i * 0.2 for i in range(40)]
    highs = [x + 1 for x in closes]
    lows = [x - 1 for x in closes]
    assert atr(highs, lows, closes) > 0
