from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,  # log every statement in development
    pool_size=5,  # steady-state connections
    max_overflow=10,  # burst capacity — 15 total ceiling
    pool_pre_ping=True,  # validate before use; a stale connection is refused, not handed out
    pool_recycle=1800,  # recycle at 30 min, under any proxy idle timeout
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attributes readable after commit
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Request-scoped session. One transaction per request.

    Commits if the route returns normally, rolls back if it raises. Every
    route in this app gets its session from here via FastAPI's Depends() —
    there is exactly one place a transaction begins and ends.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
