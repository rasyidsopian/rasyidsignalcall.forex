from __future__ import annotations

import math
import random
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx


@dataclass(frozen=True)
class Candle:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["timestamp"] = self.timestamp.isoformat()
        return payload


class MarketDataProvider(ABC):
    @abstractmethod
    async def candles(self, symbol: str, interval: str, outputsize: int = 300) -> list[Candle]:
        raise NotImplementedError


class MockMarketDataProvider(MarketDataProvider):
    """Deterministic synthetic XAU/USD feed for development only."""

    async def candles(self, symbol: str, interval: str, outputsize: int = 300) -> list[Candle]:
        if symbol != "XAU/USD":
            raise ValueError("This build supports XAU/USD only")
        minutes = {"5min": 5, "15min": 15, "1h": 60}[interval]
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        seed = int(now.timestamp() // (minutes * 60))
        rng = random.Random(seed)
        base = 3320.0
        candles: list[Candle] = []
        prev = base
        for i in range(outputsize):
            idx = outputsize - i
            ts = now - timedelta(minutes=minutes * idx)
            trend = (outputsize - idx) * 0.06
            cyc = math.sin((outputsize - idx) / 11) * 3.2
            noise = rng.uniform(-1.8, 1.8)
            close = base + trend + cyc + noise
            op = prev
            high = max(op, close) + rng.uniform(0.2, 2.2)
            low = min(op, close) - rng.uniform(0.2, 2.2)
            candles.append(Candle(ts, round(op, 2), round(high, 2), round(low, 2), round(close, 2), 1000 + rng.random() * 500))
            prev = close
        return candles


class TwelveDataProvider(MarketDataProvider):
    BASE_URL = "https://api.twelvedata.com/time_series"

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("TWELVE_DATA_API_KEY is required when MARKET_DATA_PROVIDER=twelve_data")
        self.api_key = api_key

    async def candles(self, symbol: str, interval: str, outputsize: int = 300) -> list[Candle]:
        params = {
            "symbol": symbol,
            "interval": interval,
            "outputsize": min(max(outputsize, 50), 5000),
            "apikey": self.api_key,
            "format": "JSON",
            "timezone": "UTC",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(self.BASE_URL, params=params)
            response.raise_for_status()
            data = response.json()
        if data.get("status") == "error":
            raise RuntimeError(data.get("message", "Twelve Data error"))
        values = data.get("values", [])
        result = [
            Candle(
                timestamp=datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row.get("volume") or 0.0),
            )
            for row in reversed(values)
        ]
        if not result:
            raise RuntimeError("No XAU/USD candles returned by market data provider")
        return result
