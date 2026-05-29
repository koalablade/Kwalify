"""
database.py — Render-safe DB layer (stable + production-safe)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base


# =========================================================
# ENV SETUP
# =========================================================

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ No DATABASE_URL → using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = DATABASE_URL.startswith("sqlite")


# =========================================================
# ENGINE CONFIG
# =========================================================

connect_args = {}

if USING_SQLITE:
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)


# =========================================================
# SESSION
# =========================================================

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


# =========================================================
# DB ACCESS
# =========================================================

def get_db():
    return SessionLocal()


# =========================================================
# INIT DB (SAFE FOR RENDER)
# =========================================================

def init_db():
    """
    IMPORTANT:
    Only call this ONCE at startup (not per request).
    """
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready")
    except Exception as e:
        print("⚠️ DB init failed:", str(e))


# =========================================================
# HEALTH CHECK
# =========================================================

def ping_db():
    """
    Lightweight Render-friendly DB check
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", str(e))
        return False
