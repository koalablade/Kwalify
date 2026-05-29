"""
database.py — V2 safe DB layer (Render stable)
"""

import os
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///local.db")
USING_SQLITE = DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False} if USING_SQLITE else {}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


# =========================
# SAFE SESSION WRAPPER
# =========================
@contextmanager
def get_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================
# INIT DB
# =========================
def init_db():
    try:
        from models import Base  # avoid circular issues
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready (v2)")
    except Exception as e:
        print("❌ DB init failed:", e)


# =========================
# HEALTH CHECK
# =========================
def ping_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", e)
        return False
