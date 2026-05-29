"""
database.py — Production-grade DB layer for Render + Flask + Spotify sync system
Fixes:
- Render cold starts
- Missing psycopg2 crash (safe fallback)
- SQLite/Postgres compatibility
"""

import os
import time
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ DATABASE_URL missing — using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"

# ---------------------------------------------------------------------------
# DRIVER SAFETY (FIX FOR psycopg2 CRASH ON RENDER)
# ---------------------------------------------------------------------------

_is_postgres = DATABASE_URL.startswith("postgres")

if _is_postgres:
    try:
        import psycopg2  # noqa: F401
    except Exception:
        print("⚠️ psycopg2 missing — falling back to SQLite to prevent crash")
        DATABASE_URL = "sqlite:///local.db"
        _is_postgres = False

# ---------------------------------------------------------------------------
# ENGINE
# ---------------------------------------------------------------------------

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
    connect_args=(
        {"check_same_thread": False}
        if not _is_postgres
        else {}
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
# SESSION
# ---------------------------------------------------------------------------

def get_db():
    return SessionLocal()

def close_db(db):
    try:
        db.close()
    except Exception:
        pass

# ---------------------------------------------------------------------------
# INIT
# ---------------------------------------------------------------------------

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ Database ready")
    except Exception as e:
        print("⚠️ DB init skipped:", str(e))

# ---------------------------------------------------------------------------
# HEALTH
# ---------------------------------------------------------------------------

def ping_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", str(e))
        return False

# ---------------------------------------------------------------------------
# RETRY
# ---------------------------------------------------------------------------

def with_retry(fn, retries=3, delay=1.5):
    last = None
    for _ in range(retries):
        try:
            return fn()
        except Exception as e:
            last = e
            time.sleep(delay)
    raise last
