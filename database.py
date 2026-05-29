"""
database.py — Render-safe DB layer (stable version)
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

# ------------------------------
# SAFE FALLBACK
# ------------------------------
if not DATABASE_URL:
    print("⚠️ No DATABASE_URL → using SQLite fallback")
    DATABASE_URL = "sqlite:///local.db"
    USING_SQLITE = True
else:
    USING_SQLITE = DATABASE_URL.startswith("sqlite")

# ------------------------------
# ENGINE
# ------------------------------
connect_args = {}

if USING_SQLITE:
    connect_args = {"check_same_thread": False}

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

# ------------------------------
# SESSION
# ------------------------------
def get_db():
    return SessionLocal()

# ------------------------------
# INIT
# ------------------------------
def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        print("✅ DB ready")
    except Exception as e:
        print("⚠️ DB init failed:", e)

# ------------------------------
# HEALTH
# ------------------------------
def ping_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        print("DB ping failed:", e)
        return False
