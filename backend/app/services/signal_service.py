from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from sqlalchemy import desc, select

from app.core.config import get_settings
from app.core.database import SessionLocal, SignalRecord
from app.data.provider import MarketDataProvider, MockMarketDataProvider, TwelveDataProvider
from app.signals.engine import SignalDecision, generate_signal


class SignalService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.provider: MarketDataProvider = self._build_provider()
        self.current: SignalDecision | None = None
        self.market_cache: dict[str, list] = {}
        self.clients: set = set()
        self._task: asyncio.Task | None = None

    def _build_provider(self) -> MarketDataProvider:
        if self.settings.market_data_provider.lower() == "twelve_data":
            return TwelveDataProvider(self.settings.twelve_data_api_key)
        return MockMarketDataProvider()

    async def refresh(self) -> SignalDecision:
        c5, c15, c1h = await asyncio.gather(
            self.provider.candles("XAU/USD", "5min", 300),
            self.provider.candles("XAU/USD", "15min", 300),
            self.provider.candles("XAU/USD", "1h", 300),
        )
        self.market_cache = {"5min": c5, "15min": c15, "1h": c1h}
        decision = generate_signal(c5, c15, c1h, self.settings.min_signal_score, self.settings.min_rr)
        previous_key = None if self.current is None else (self.current.signal, self.current.entry_price)
        new_key = (decision.signal, decision.entry_price)
        self.current = decision
        if decision.signal in {"BUY", "SELL"} and new_key != previous_key:
            self._persist(decision)
        await self.broadcast(decision.to_dict())
        return decision

    def _persist(self, decision: SignalDecision) -> None:
        with SessionLocal() as db:
            db.add(SignalRecord(
                symbol=decision.symbol,
                signal=decision.signal,
                confidence=decision.confidence,
                entry_price=decision.entry_price,
                stop_loss=decision.stop_loss,
                take_profit_1=decision.take_profit_1,
                take_profit_2=decision.take_profit_2,
                risk_reward=decision.risk_reward,
                market_regime=decision.market_regime,
                status=decision.status,
                reasons_json=json.dumps(decision.reasons),
                strategy_version=decision.strategy_version,
            ))
            db.commit()

    def history(self, limit: int = 50) -> list[dict]:
        with SessionLocal() as db:
            rows = db.scalars(select(SignalRecord).order_by(desc(SignalRecord.created_at)).limit(limit)).all()
            return [{
                "id": row.id,
                "symbol": row.symbol,
                "signal": row.signal,
                "confidence": row.confidence,
                "entry_price": row.entry_price,
                "stop_loss": row.stop_loss,
                "take_profit_1": row.take_profit_1,
                "take_profit_2": row.take_profit_2,
                "risk_reward": row.risk_reward,
                "market_regime": row.market_regime,
                "status": row.status,
                "created_at": row.created_at.replace(tzinfo=timezone.utc).isoformat(),
                "reasons": json.loads(row.reasons_json),
                "strategy_version": row.strategy_version,
            } for row in rows]

    async def broadcast(self, payload: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def loop(self) -> None:
        while True:
            try:
                await self.refresh()
            except Exception as exc:
                await self.broadcast({"type": "error", "message": str(exc)})
            await asyncio.sleep(max(self.settings.poll_seconds, 10))

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


signal_service = SignalService()
