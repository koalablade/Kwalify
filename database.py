"""
database.py — FIXED (Render + SQLite + auto table registration)
"""

import os
import time
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ DATABASE_URL missing — using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = "sqlite" in DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
    connect_args={"check_same_thread": False} if USING_SQLITE else {}
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()

# ---------------------------------------------------------
# CRITICAL FIX: ensure models are imported BEFORE create_all
# ---------------------------------------------------------

def init_db():
    """
    Ensures all models are loaded before table creation.
    Prevents 'no such table' errors.
    """

    try:
        # 🔥 IMPORTANT: import models so they register with Base
        import models  # noqa: F401

        Base.metadata.create_all(bind=engine)

        print("✅ Database initialised (tables ready)")

    except Exception as e:
        print("⚠️ DB init failed:", str(e))


def get_db():
    db = SessionLocal()
    return db


def ping_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", e)
        return False


def close_db(db):
    try:
        db.close()
    except:
        pass


def with_retry(fn, retries=3, delay=1.5):
    last = None
    for _ in range(retries):
        try:
            return fn()
        except Exception as e:
            last = e
            time.sleep(delay)
    raise last
