import asyncio

from app.data.provider import MockMarketDataProvider
from app.signals.engine import generate_signal


def test_engine_returns_allowed_signal():
    async def run():
        provider = MockMarketDataProvider()
        c5, c15, c1h = await asyncio.gather(
            provider.candles("XAU/USD", "5min", 300),
            provider.candles("XAU/USD", "15min", 300),
            provider.candles("XAU/USD", "1h", 300),
        )
        return generate_signal(c5, c15, c1h)

    decision = asyncio.run(run())
    assert decision.signal in {"BUY", "SELL", "NO_TRADE"}
    assert 0 <= decision.confidence <= 100
