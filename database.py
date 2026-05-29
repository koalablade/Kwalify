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

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False
)

Base = declarative_base()


# =========================
# SINGLE SAFE SESSION API
# =========================
@contextmanager
def get_session():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# =========================
# INIT DB
# =========================
def init_db():
    try:
        from models import Base as ModelsBase
        ModelsBase.metadata.create_all(bind=engine)
        print("✅ DB ready (v2 stable)")
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
