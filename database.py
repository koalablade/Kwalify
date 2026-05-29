"""
database.py — Production-grade DB layer for Render + Flask + Spotify sync system
Safe for:
- Render sleep/wake
- Postgres + SQLite fallback
- concurrent requests
- session leakage prevention
"""

import os
import time
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

# ---------------------------------------------------------------------------
# ENV SETUP (Render-safe)
# ---------------------------------------------------------------------------

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ DATABASE_URL missing — using local SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    _USING_SQLITE = True
else:
    _USING_SQLITE = "sqlite" in DATABASE_URL

# ---------------------------------------------------------------------------
# ENGINE (Render-safe pooling + reconnect stability)
# ---------------------------------------------------------------------------

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,          # prevents stale connections (IMPORTANT on Render sleep)
    pool_recycle=300,            # avoids Postgres timeout disconnects
    pool_size=5,
    max_overflow=10,
    connect_args=(
        {"check_same_thread": False} if _USING_SQLITE else {"sslmode": "require"}
    ),
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


# ---------------------------------------------------------------------------
# SESSION SAFETY WRAPPER
# ---------------------------------------------------------------------------

def get_db():
    """
    Always returns a fresh DB session.
    Safe for Flask request lifecycle.
    """
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise


def close_db(db):
    """Safe close helper (prevents leaks in long Render runs)."""
    try:
        db.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# INITIALISATION (safe on cold start)
# ---------------------------------------------------------------------------

def init_db():
    """
    Safe table creation.
    Won’t crash app if DB is temporarily unavailable.
    """
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ Database initialised")
    except Exception as e:
        print("⚠️ DB init skipped (will retry on next request):", str(e))


# ---------------------------------------------------------------------------
# HEALTH CHECK (used by /health route)
# ---------------------------------------------------------------------------

def ping_db():
    """
    Lightweight connection test (useful for Render health checks)
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", str(e))
        return False


# ---------------------------------------------------------------------------
# RETRY HELPER (important for Render cold starts)
# ---------------------------------------------------------------------------

def with_retry(fn, retries=3, delay=1.5):
    """
    Runs DB operations safely with retry logic.
    Helps with:
    - Render wake-up lag
    - Postgres reconnect delay
    """
    last_error = None

    for _ in range(retries):
        try:
            return fn()
        except Exception as e:
            last_error = e
            time.sleep(delay)

    raise last_error
