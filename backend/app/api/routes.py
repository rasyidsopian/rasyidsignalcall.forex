from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.services.signal_service import signal_service

router = APIRouter(prefix="/api")


@router.get("/market/XAUUSD")
async def market(timeframe: str = Query("15min", pattern="^(5min|15min|1h)$"), outputsize: int = Query(300, ge=50, le=500)):
    candles = signal_service.market_cache.get(timeframe)
    if candles is None or len(candles) < outputsize:
        candles = await signal_service.provider.candles("XAU/USD", timeframe, outputsize)
    return {"symbol": "XAU/USD", "timeframe": timeframe, "candles": [c.to_dict() for c in candles[-outputsize:]]}


@router.get("/signals/current/XAUUSD")
async def current_signal():
    if signal_service.current is None:
        try:
            await signal_service.refresh()
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return signal_service.current.to_dict()


@router.get("/signals/history")
def signal_history(limit: int = Query(50, ge=1, le=200)):
    return {"items": signal_service.history(limit)}


@router.get("/performance")
def performance():
    items = signal_service.history(500)
    return {
        "tracked_signals": len(items),
        "wins": None,
        "losses": None,
        "win_rate": None,
        "note": "Outcome tracking is intentionally not fabricated. Connect the evaluator/backtest pipeline before showing win rate.",
    }


@router.websocket("/ws/signals")
async def ws_signals(websocket: WebSocket):
    await websocket.accept()
    signal_service.clients.add(websocket)
    if signal_service.current:
        await websocket.send_json(signal_service.current.to_dict())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        signal_service.clients.discard(websocket)
