import os
from sqlalchemy import create_engine, text as sa_text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

engine = None
SessionLocal = None

if DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
    )

    SessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine
    )
else:
    print("⚠️ DATABASE_URL not set (DB features disabled)")


Base = declarative_base()


def get_db():
    if not SessionLocal:
        raise RuntimeError("DATABASE_URL missing or DB not configured")

    db = SessionLocal()
    try:
        return db
    finally:
        pass


def init_db():
    if engine:
        Base.metadata.create_all(bind=engine)


def ping_db():
    if not engine:
        return False

    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
        return True
    except Exception:
        return False
