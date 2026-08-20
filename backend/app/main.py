from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.database import init_db
from app.services.signal_service import signal_service

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    signal_service.start()
    yield
    await signal_service.stop()


app = FastAPI(title="Rasyid Signal Call API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "symbol": "XAU/USD", "provider": settings.market_data_provider}
