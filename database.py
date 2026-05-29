"""
database.py — Render-safe DB layer
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("⚠️ Using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False} if USING_SQLITE else {}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready")
    except Exception as e:
        print("DB init error:", str(e))


def get_db():
    return SessionLocal()


def ping_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except:
        return False
