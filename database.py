import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker

from log import log
from models import Base

DATABASE_URL = "sqlite:///kwalah.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

_Session = scoped_session(
    sessionmaker(bind=engine, autocommit=False, autoflush=False)
)


_db_ready = False  # set once; prevents repeated PRAGMA checks on hot-reload


def init_db():
    """Create all tables and run additive migrations. Safe to call multiple times."""
    global _db_ready
    if _db_ready:
        return
    Base.metadata.create_all(engine)
    _apply_migrations()
    _db_ready = True


def _apply_migrations():
    """
    Add columns missing from older schema versions.
    SQLite has no ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info first.
    """
    with engine.connect() as conn:
        cols = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
        }
        if "sync_retry_after" not in cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN sync_retry_after DATETIME")
            )
            conn.commit()
            log("INFO", "db", "Migration applied: added users.sync_retry_after")


def get_db():
    """Return a new scoped DB session. Caller must call .close() when done."""
    return _Session()
